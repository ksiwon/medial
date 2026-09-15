"""The community, as data (26번 C01).

Until 2026-09-15 four different files knew things about 은점마을 in code: the
village head was ``VILLAGE_HEAD_ID = "P6"`` in the engine, the relation graph
was a literal list of P-numbers, the persona compiler had a ``P12`` special
case, and the ledger's fallback assumed the head knew everybody's day. Loading
another community meant editing all four, and a community that happened to use
the same P-numbers would have inherited 은점's relations.

A :class:`CaseBundle` is the one object that says who the people are, what
roles exist, who is recorded as knowing or helping whom, what was asked of
them, and which scenarios and resource assumptions this case runs. The engine
reads the bundle; nothing in the engine names a resident.

What this is not: a general case editor. A bundle is assembled from the files
the loaders already read (village registry, relations revision, elicitation
ledger, persona provenance) and validated. Changing one is a research act
performed on the data, not a knob in the product - ``FIXED_INPUT_PREFIXES``
refuses a Change Set that reaches for any of it.

Two rules the loader enforces, because both were silent before:

* **no role is invented.** A bundle whose community has no village head keeps
  ``roleAssignments`` empty rather than picking the first resident, and a plan
  that needs the role is refused for that case with the reason
  (:func:`unsupported_reason`);
* **no knowledge is inherited.** Relations, routine knowledge and elicitation
  status come from the bundle's own files. A new community with new ids gets
  whatever its own ledger says - by default, that nothing was asked.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Literal

from pydantic import Field

from .contracts import Base, ContactStrategy, RelationRevision
from .ledger import ElicitationLedger, legacy_ledger, load_ledger
from .relations import REL_NONE, get_relations
from .village import Village, load_village

#: Roles a service plan may require of a community. Deliberately short: a role
#: here is one the engine actually routes work through.
Role = Literal["village_head", "health_staff"]

#: Which contact orders need which role. A community without the role cannot
#: run those plans, and the researcher is told which role is missing rather
#: than being shown a run where the order silently did something else.
STRATEGY_ROLES: dict[str, Role | None] = {
    ContactStrategy.head_first.value: "village_head",
    ContactStrategy.relation_first.value: None,
    ContactStrategy.neighbour_first.value: None,
    ContactStrategy.retry_then_clinic.value: "health_staff",
}


class ResidentRef(Base):
    """Who is in this community, by this community's own ids."""

    actorId: str
    displayName: str
    group: str = ""
    #: ``source`` when the registry came from imported material, ``synthetic``
    #: for a fixture. Carried per bundle, not per resident claim.
    provenance: str = "unknown"


class CaseBundle(Base):
    schemaVersion: Literal["case/1"] = "case/1"
    caseId: str
    label: str
    version: str
    #: ``source-adapted`` when this came from imported interview material;
    #: ``synthetic`` for a fixture. Never mixed in one bundle.
    sourceKind: Literal["source-adapted", "synthetic", "unknown"] = "unknown"
    residents: list[ResidentRef] = Field(default_factory=list)
    #: ``{role: actorId}``. Empty is a valid community.
    roleAssignments: dict[str, str] = Field(default_factory=dict)
    relationRevisionId: str
    ledgerRevisionId: str
    personaRevisionId: str = "none"
    #: Scenario decks this case can run, and the resource assumptions it uses.
    scenarioIds: list[str] = Field(default_factory=list)
    resourceRevisionId: str | None = None
    #: Where each part came from, so a claim can be traced without reopening
    #: the files. Paths are server-side; no raw material travels in here.
    evidenceIndex: dict[str, str] = Field(default_factory=dict)
    assumptions: list[str] = Field(default_factory=list)

    @property
    def village_head_id(self) -> str | None:
        """``None`` when this community has no such role. Not a default."""
        return self.roleAssignments.get("village_head")

    @property
    def resident_ids(self) -> list[str]:
        return [r.actorId for r in self.residents]

    def has_role(self, role: str) -> bool:
        return role in self.roleAssignments

    def content_hash(self) -> str:
        payload = json.dumps(self.model_dump(mode="json"), ensure_ascii=False, sort_keys=True)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


class CaseValidationError(ValueError):
    """A bundle that cannot be run, with the reason a person can act on."""


def validate(bundle: CaseBundle, relations: RelationRevision,
             ledger: ElicitationLedger) -> None:
    """Ids, roles, duplicates and cross-references. Nothing is repaired here:
    a bundle that names somebody who is not in the community is a data error to
    fix in the data, not a resident for the loader to substitute."""
    ids = bundle.resident_ids
    duplicates = sorted({i for i in ids if ids.count(i) > 1})
    if duplicates:
        raise CaseValidationError("같은 주민 id가 두 번 있다: %s" % duplicates)
    if not ids:
        raise CaseValidationError("주민이 없는 사례는 실행할 수 없다.")
    # The institution desk is modelled, not a resident, so it is a legitimate
    # role holder that will never appear in the resident list.
    known = set(ids) | {"HC_NURSE", "HC_DIRECTOR"}
    for role, actor_id in bundle.roleAssignments.items():
        if actor_id not in known:
            raise CaseValidationError(
                "역할 %s에 이 사례에 없는 사람(%s)이 배정되어 있다. 임의의 주민으로 "
                "대체하지 않는다." % (role, actor_id))
    stray_edges = sorted({a for e in relations.edges for a in (e.a, e.b)} - set(ids))
    if stray_edges:
        raise CaseValidationError(
            "관계 기록이 이 사례에 없는 사람을 가리킨다: %s. 다른 공동체의 관계가 "
            "섞였을 수 있다." % stray_edges)
    stray_ledger = sorted({e.actorId for e in ledger.entries} - set(ids))
    if stray_ledger:
        raise CaseValidationError(
            "채록 장부가 이 사례에 없는 사람을 가리킨다: %s" % stray_ledger)
    stray_knowers = sorted(
        {x for k in ledger.routineKnowledge for x in (k.knowerId, k.subjectId)} - set(ids))
    if stray_knowers:
        raise CaseValidationError(
            "'누가 누구의 일과를 아는가'가 이 사례에 없는 사람을 가리킨다: %s" % stray_knowers)


def unsupported_reason(bundle: CaseBundle, contact_strategy: str) -> str | None:
    """Why this plan cannot run on this community, or ``None``.

    Said as a missing role rather than as an invalid policy: the plan is fine,
    this community simply has nobody in that seat.
    """
    role = STRATEGY_ROLES.get(contact_strategy)
    if role is None or bundle.has_role(role):
        return None
    words = {"village_head": "이장", "health_staff": "보건소 담당자"}
    return ("이 운영안은 %s 역할을 거쳐 진행하는데 '%s' 사례에는 그 역할이 없다. "
            "임의의 주민을 그 자리에 앉히지 않는다. 역할이 필요 없는 연락 순서를 고르거나, "
            "이 사례의 자료에 역할을 채록해야 한다."
            % (words.get(role, role), bundle.label))


def build_case(village: Village, *, relations: RelationRevision | None = None,
               ledger: ElicitationLedger | None = None,
               persona_revision: str = "none",
               scenario_ids: list[str] | None = None,
               resource_id: str | None = None) -> CaseBundle:
    """One bundle from the loaders that already exist.

    The village head is read from the registry's own ``isVillageHead`` flag -
    the fact was always in the data; the engine simply had it written down in
    code as well.
    """
    residents = [
        ResidentRef(actorId=r["id"], displayName=r.get("displayName", r["id"]),
                    group=r.get("group", ""), provenance=village.data_source)
        for r in village.residents
    ]
    roles: dict[str, str] = {}
    heads = [r["id"] for r in village.residents if r.get("isVillageHead")]
    if len(heads) > 1:
        raise CaseValidationError("이장으로 표시된 사람이 둘 이상이다: %s" % heads)
    if heads:
        roles["village_head"] = heads[0]
    # The institution is a modelled desk rather than a resident; every case this
    # build runs has one, and a case that did not would refuse the plans that
    # need it through the same check.
    roles["health_staff"] = "HC_NURSE"

    relations = relations if relations is not None else get_relations()
    ledger = ledger if ledger is not None else load_ledger(
        village.path, [r["id"] for r in village.residents], roles.get("village_head"))
    synthetic = village.is_synthetic
    # Two synthetic communities now exist; the file's own name is what tells
    # them apart on screen, rather than both being called "합성 공동체".
    stem = getattr(village, "path", None)
    variant = ""
    if stem is not None:
        parts = Path(stem).name.split(".")
        variant = (" · " + ".".join(parts[1:-1])) if len(parts) > 2 else ""
    bundle = CaseBundle(
        caseId="case-%s" % village.content_hash[:10],
        label=(("합성 공동체" + variant) if synthetic else "은점마을"),
        version=village.content_hash,
        sourceKind="synthetic" if synthetic else "source-adapted",
        residents=residents,
        roleAssignments=roles,
        relationRevisionId=relations.id,
        ledgerRevisionId=ledger.id,
        personaRevisionId=persona_revision,
        scenarioIds=list(scenario_ids or []),
        resourceRevisionId=resource_id,
        evidenceIndex={
            "village": str(getattr(village, "path", "")),
            "relations": relations.id,
            "ledger": ledger.id,
        },
        assumptions=list(relations.assumptions) + list(ledger.assumptions),
    )
    validate(bundle, relations, ledger)
    return bundle


def load_case(village_path: str | Path | None = None, *,
              relation_id: str | None = None,
              persona_revision: str = "none") -> tuple[CaseBundle, Village]:
    """Load a community from disk as a validated bundle plus its village."""
    village = load_village(village_path)
    heads = [r["id"] for r in village.residents if r.get("isVillageHead")]
    ledger = load_ledger(village.path, [r["id"] for r in village.residents],
                         heads[0] if heads else None)
    relations = get_relations(relation_id)
    # A community whose ids the shipped relation revision does not know keeps
    # no relations at all rather than borrowing another village's.
    if {a for e in relations.edges for a in (e.a, e.b)} - {r["id"] for r in village.residents}:
        relations = REL_NONE
    return (build_case(village, relations=relations, ledger=ledger,
                       persona_revision=persona_revision), village)


def empty_ledger_for(bundle: CaseBundle) -> ElicitationLedger:
    """What a community with no ledger file starts from.

    For a community that has a village head this reproduces the legacy
    behaviour, assumption and all, so stored runs keep their meaning. For one
    that does not, nothing is assumed: no ``routineKnowledge`` at all, which
    makes "자택에 없고 물을 사람이 없다" that community's actual result rather
    than a silently invented informant (26번 F05).
    """
    head = bundle.village_head_id
    if head is None:
        base = legacy_ledger(bundle.resident_ids, "")
        return base.model_copy(update={
            "id": "ledger-none-%s" % bundle.caseId[-6:],
            "label": "채록 장부 없음 · 이 사례에는 이장 역할이 없어 아무 가정도 넣지 않는다",
            "routineKnowledge": [],
            "assumptions": ["장부가 없고 이장 역할도 없다. 평소 장소를 아는 사람은 "
                            "'없음'이 아니라 '묻지 않았다'이며, 자동으로 만들지 않는다."],
        })
    return legacy_ledger(bundle.resident_ids, head)
