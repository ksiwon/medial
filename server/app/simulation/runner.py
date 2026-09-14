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
from .contracts import (
    ENGINE_VERSION,
    Attempt,
    AttemptLineage,
    AttemptMode,
    AttemptStatus,
    PolicyRevision,
    ResourceRevision,
    ScenarioDeck,
)
from .decks.registry import DECK_DEFAULTS, DECKS, POLICIES, RESOURCE_SETS
from .engine import Engine, RunResult
from .persona import load_personas
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
                  day: Any | None = None) -> Attempt:
    environment = environment or get_environment()
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
        environmentRevisionId=environment.id,
        dayRealizationId=day.id if day is not None else None,
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
                environment_id: str | None = None) -> RunResult:
    """``policy`` overrides the built-in registry so that an edited revision,
    which only exists in the service, can be executed without being registered
    globally."""
    village = village or load_village()
    policy = policy or POLICIES[policy_id]
    deck = DECKS[deck_id]
    resources = RESOURCE_SETS[resource_id]
    profiles, provenance = personas(persona_path)
    env = get_environment(environment_id)
    # The day is drawn before anything runs, from (village, environment, seed)
    # alone. A rerun and a fork inherit the parent's seed, so they land on this
    # same day without copying it.
    day = realize_day(village, env, seed, deck.horizonMs)
    village = apply_realization(village, day)
    attempt = build_attempt(attempt_id, label or policy.label, policy, deck, resources,
                            village, seed=seed, adapter=adapter,
                            parent_id=parent_id, parent_seq=parent_seq,
                            lineage=lineage,
                            persona_revision=provenance.get("revisionId"),
                            persona_source=provenance.get("dataSource"),
                            environment=env, day=day)
    engine = Engine(attempt, policy, deck, resources, village, script=script,
                    personas=profiles, policy_switch=policy_switch, environment=env)
    result = engine.run()
    result.attempt.status = AttemptStatus.completed
    result.attempt.eventCount = len(result.events)
    result.attempt.cursorSeq = 0
    result.metrics["personaProvenance"] = provenance
    result.metrics["dayRealization"] = day.model_dump(mode="json")
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
        "adapters": {
            "available": ["rule", "scripted"],
            "unavailable": ["llm"],
            "note": "LLM 어댑터는 인터페이스만 있고 모델을 호출하지 않는다. API 키가 필요 없다.",
        },
    }


def _policy_field_spec() -> dict[str, Any]:
    """What the policy editor may offer, straight from the contract.

    The screen builds its form from this, so a field the engine does not read
    cannot appear as an editable condition.
    """
    from .contracts import PolicyParams

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
        "strategies": ["head_first", "retry_then_clinic"],
        "note": ("여기 없는 조건은 API가 400으로 거절한다. 화면에 있는데 엔진이 읽지 않는 "
                 "조건은 두지 않는다."),
    }
