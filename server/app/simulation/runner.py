"""Build an attempt and run it.

Rule and scripted adapters are deterministic and a whole day finishes in
milliseconds, so an attempt is executed once, on creation, and the log is what
the researcher then plays, steps and seeks through. Replay therefore never
re-invokes an adapter - a property the tests assert rather than assume.

``lineage`` says how an attempt relates to its parent, and the two cases are not
interchangeable:

* ``rerun`` - same initial state, different policy, the day runs again from 0;
* ``fork`` - the parent's rules run up to ``parentSeq`` and the new policy takes
  over there. Because the adapters are deterministic the prefix is reproduced
  exactly, and the service verifies that against the parent's stored log before
  the run is allowed to be saved.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from .day import apply_realization, realize_day
from .environment import get_environment
from .ledger import load_ledger
from .relations import get_relations
from .contracts import (
    ENGINE_VERSION,
    Attempt,
    AttemptLineage,
    AttemptMode,
    AttemptStatus,
    ModelPolicy,
    PolicyRevision,
    ResourceRevision,
    ScenarioDeck,
)
from .decks.registry import DECK_DEFAULTS, DECKS, POLICIES, RESOURCE_SETS
from .agents.model_calls import ModelCallLog
from .case_bundle import CaseValidationError, build_case, empty_ledger_for, unsupported_reason
from .engine import Engine, RunResult
from .persona import apply_community_facts, load_personas
from .village import Village, load_village

_PERSONA_CACHE: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}


def personas(path: str | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    """Compiled personas plus provenance, memoised per source path."""
    key = str(path or "")
    if key not in _PERSONA_CACHE:
        _PERSONA_CACHE[key] = load_personas(path)
    return _PERSONA_CACHE[key]


def _hash(obj: Any) -> str:
    payload = json.dumps(obj, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def build_attempt(attempt_id: str, label: str, policy: PolicyRevision, deck: ScenarioDeck,
                  resources: ResourceRevision, village: Village, seed: int = 17,
                  adapter: str = "rule", parent_id: str | None = None,
                  parent_seq: int | None = None,
                  lineage: AttemptLineage = AttemptLineage.root,
                  persona_revision: str | None = None,
                  persona_source: str | None = None,
                  environment: Any | None = None,
                  day: Any | None = None,
                  model_policy: Any | None = None,
                  relations: Any | None = None,
                  ledger: Any | None = None,
                  institution_adapter: str = "rule") -> Attempt:
    environment = environment or get_environment()
    model_policy = model_policy or ModelPolicy()
    relations = relations or get_relations()
    case = build_case(village, relations=relations)
    ledger = ledger or load_ledger(village.path, [r["id"] for r in village.residents],
                                   case.village_head_id) or empty_ledger_for(case)
    return Attempt(
        id=attempt_id,
        parentId=parent_id,
        parentSeq=parent_seq,
        lineage=lineage,
        label=label,
        policyId=policy.id,
        scenarioDeckId=deck.id,
        personaRevisionId=persona_revision or ("village-registry-" + village.content_hash),
        baselineRevisionId="baseline-" + village.content_hash,
        resourceRevisionId=resources.id,
        seed=seed,
        mode=AttemptMode.experiment,
        status=AttemptStatus.created,
        engineVersion=ENGINE_VERSION,
        adapter=adapter,  # type: ignore[arg-type]
        institutionAdapter=institution_adapter,  # type: ignore[arg-type]
        environmentRevisionId=environment.id,
        dayRealizationId=day.id if day is not None else None,
        modelPolicy=model_policy,
        relationRevisionId=relations.id,
        ledgerRevisionId=ledger.id,
        createdAt=datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        dataSource=village.data_source,
        inputHashes={
            "village": village.content_hash,
            "policy": _hash(policy.model_dump()),
            "deck": _hash(deck.model_dump()),
            "resources": _hash(resources.model_dump()),
            # Without this, editing a world assumption - whether a phone is
            # answered in a field, say - produced two runs with identical input
            # hashes, and the difference read as a policy effect.
            "environment": _hash(environment.model_dump()),
            # The realized day. Two attempts are a controlled pair only when
            # this matches; a different seed is a different day, not a policy
            # effect, and the comparison screen has to be able to say so.
            "day": day.id if day is not None else "none",
            # Which model, at which temperature, under which prompt build. A
            # model swap changes answers as thoroughly as a policy edit does, and
            # without this the two are indistinguishable on the comparison
            # screen. The engine version already covers code changes.
            "modelPolicy": _hash(model_policy.model_dump()),
            # Who may hand work to whom. Adding one edge changes who ends up
            # carrying the day, so two runs that disagree about the village's
            # relations are not a controlled pair.
            "relations": _hash(relations.model_dump()),
            # What was asked of whom. A run under a ledger that marks P1's
            # help contacts "not asked" and one that marks them "asked, none"
            # reach different conclusions from the same events.
            "ledger": ledger.content_hash(),
            "persona": persona_revision or "none",
            "personaSource": persona_source or "none",
        },
    )


def run_attempt(attempt_id: str, policy_id: str, deck_id: str, resource_id: str,
                label: str | None = None, seed: int = 17, adapter: str = "rule",
                village: Village | None = None,
                script: list[dict[str, Any]] | None = None,
                parent_id: str | None = None,
                parent_seq: int | None = None,
                policy: PolicyRevision | None = None,
                lineage: AttemptLineage = AttemptLineage.root,
                policy_switch: dict[str, Any] | None = None,
                persona_path: str | None = None,
                environment_id: str | None = None,
                model_policy: Any | None = None,
                inherited_model_calls: Any | None = None,
                provider: Any | None = None,
                relation_id: str | None = None,
                ledger: Any | None = None,
                institution_adapter: str = "rule") -> RunResult:
    """``policy`` overrides the built-in registry so that an edited revision,
    which only exists in the service, can be executed without being registered
    globally."""
    village = village or load_village()
    policy = policy or POLICIES[policy_id]
    deck = DECKS[deck_id]
    resources = RESOURCE_SETS[resource_id]
    profiles, provenance = personas(persona_path)
    env = get_environment(environment_id)
    relations = get_relations(relation_id)
    # Who this community is, and which roles it has. A case whose ids the
    # shipped relation revision does not know keeps no relations rather than
    # inheriting another village's (26번 F04).
    if {a for e in relations.edges for a in (e.a, e.b)} - {r["id"] for r in village.residents}:
        relations = get_relations("rel-none")
    case = build_case(village, relations=relations,
                      persona_revision=provenance.get("revisionId", "none"),
                      scenario_ids=[deck.id], resource_id=resources.id)
    # A deck belongs to a community. Refused here, by name, rather than as a
    # KeyError from the world model three layers down.
    strangers = sorted({e.subjectId for e in deck.events} - set(case.resident_ids))
    if strangers:
        raise CaseValidationError(
            "시나리오 %s는 이 사례에 없는 사람(%s)에 대한 것이다. 다른 공동체의 사례를 "
            "그대로 돌릴 수 없다." % (deck.id, ", ".join(strangers)))
    reason = unsupported_reason(case, policy.contactStrategy.value)
    if reason is not None:
        raise CaseValidationError(reason)
    ledger = ledger or load_ledger(village.path, [r["id"] for r in village.residents],
                                   case.village_head_id) or empty_ledger_for(case)
    # What the researcher states about the community (who drives) sits on top
    # of what the interviews said. The ledger is in the input hashes, so a
    # changed statement is a changed input.
    profiles = apply_community_facts(profiles, ledger)
    model_policy = model_policy or ModelPolicy()
    # The day is drawn before anything runs, from (village, environment, seed)
    # alone. A rerun and a fork inherit the parent's seed, so they land on this
    # same day without copying it.
    day = realize_day(village, env, seed, deck.horizonMs)
    village = apply_realization(village, day)
    attempt = build_attempt(attempt_id, label or policy.label, policy, deck, resources,
                            village, seed=seed, adapter=adapter,
                            parent_id=parent_id, parent_seq=parent_seq,
                            lineage=lineage, institution_adapter=institution_adapter,
                            persona_revision=provenance.get("revisionId"),
                            persona_source=provenance.get("dataSource"),
                            environment=env, day=day, model_policy=model_policy,
                            relations=relations, ledger=ledger)
    # A fork is handed its parent's recorded calls. Along the shared prefix the
    # prompts are identical, so the keys match and the child replays the parent's
    # answers; after the checkpoint they diverge, and what diverges is the policy.
    log = ModelCallLog(attempt.id, model_policy, inherited=inherited_model_calls or [])
    engine = Engine(attempt, policy, deck, resources, village, script=script,
                    personas=profiles, policy_switch=policy_switch, environment=env,
                    model_calls=log, provider=provider, relations=relations,
                    ledger=ledger, case=case)
    result = engine.run()
    result.attempt.status = AttemptStatus.completed
    result.attempt.eventCount = len(result.events)
    result.attempt.cursorSeq = 0
    result.metrics["personaProvenance"] = provenance
    result.metrics["dayRealization"] = day.model_dump(mode="json")
    result.metrics["modelCalls"] = {
        "policy": model_policy.model_dump(mode="json"),
        "total": len(result.model_calls),
        "replayed": sum(1 for m in result.model_calls if m.origin == "replayed"),
        "failed": sum(1 for m in result.model_calls if m.status == "error"),
    }
    return result


def log_fingerprint(events: list[Any]) -> str:
    """Stable hash of a committed log, used to prove replay equality."""
    return _hash(log_rows(events))


def log_rows(events: list[Any]) -> list[dict[str, Any]]:
    return [
        {"seq": e.seq, "t": e.simTimeMs, "type": e.type.value, "actor": e.actorId,
         "corr": e.correlationId, "vis": e.visibility, "payload": e.payload}
        for e in events
    ]


def stored_log_rows(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The same rows, rebuilt from what the database returned."""
    return [
        {"seq": e["seq"], "t": e["simTimeMs"], "type": e["type"], "actor": e["actorId"],
         "corr": e["correlationId"], "vis": e["visibility"], "payload": e["payload"]}
        for e in events
    ]


def catalog() -> dict[str, Any]:
    village = load_village()
    _, persona_provenance = personas()
    return {
        "engineVersion": ENGINE_VERSION,
        "village": {
            "dataSource": village.data_source,
            "isSynthetic": village.is_synthetic,
            "contentHash": village.content_hash,
            "residentCount": len(village.residents),
            "dataIssues": village.data_issues,
        },
        "personas": persona_provenance,
        "policies": [p.model_dump(mode="json") for p in POLICIES.values()],
        "decks": [
            {"id": d.id, "label": d.label, "classification": d.classification,
             "assumptions": d.assumptions, "horizonMs": d.horizonMs,
             "eventCount": len(d.events)}
            for d in DECKS.values()
        ],
        "resourceSets": [r.model_dump(mode="json") for r in RESOURCE_SETS.values()],
        "policyFields": _policy_field_spec(),
        # ``adapters`` is filled by the service, which knows whether a model
        # key is present.
    }


def _policy_field_spec() -> dict[str, Any]:
    """What the policy editor may offer, straight from the contract.

    The screen builds its form from this, so a field the engine does not read
    cannot appear as an editable condition.
    """
    from .contracts import ContactStrategy, PolicyParams

    schema = PolicyParams.model_json_schema()
    fields = []
    for name in PolicyParams.SUPPORTED:
        spec = schema["properties"].get(name, {})
        # An optional field arrives as anyOf[<real type>, null]. Reading `type`
        # straight off that gives None, which used to be reported as "enum" with
        # no options - an editor built from that renders an empty dropdown for
        # escalateToInstitutionAfterMin and loses its 5..600 bounds.
        branch = spec
        nullable = False
        if "anyOf" in spec:
            options = [b for b in spec["anyOf"] if b.get("type") != "null"]
            nullable = len(options) != len(spec["anyOf"])
            branch = options[0] if options else {}
        fields.append({
            "name": name,
            "type": branch.get("type") or spec.get("type") or "string",
            "nullable": nullable,
            "default": spec.get("default"),
            "minimum": branch.get("minimum"),
            "maximum": branch.get("maximum"),
            "enum": branch.get("enum"),
            "description": spec.get("description") or branch.get("description"),
        })
    return {
        "supported": list(PolicyParams.SUPPORTED),
        "fields": fields,
        # Every order the engine implements. Until the knob audit of 2026-09-15
        # this listed two of the four, so the editor could not offer the
        # neighbour-first or relation-first orders at all.
        "strategies": [s.value for s in ContactStrategy],
        "note": ("여기 없는 조건은 API가 400으로 거절한다. 화면에 있는데 엔진이 읽지 않는 "
                 "조건은 두지 않는다."),
    }
