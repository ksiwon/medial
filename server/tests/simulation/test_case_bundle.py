"""Loading a *second* community must not inherit the first one's village.

Each test names the thing that would otherwise happen quietly: a community whose ids
happen to overlap picking up 은점's relation edges, a missing village head
being filled in by whoever sorted first, an empty ledger being read as "this
community has nobody", or a plan that needs a role running anyway and showing a
difference of zero.

    python -m pytest server/tests/simulation/test_case_bundle.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))

from app.simulation.case_bundle import (  # noqa: E402
    CaseValidationError,
    build_case,
    empty_ledger_for,
    load_case,
    unsupported_reason,
)
from app.simulation.relations import get_relations  # noqa: E402
from app.simulation.runner import run_attempt  # noqa: E402
from app.simulation.village import load_village  # noqa: E402

SYN = REPO_ROOT / "fixtures" / "synthetic"
EUNJEOM_LIKE = SYN / "village.synthetic.json"
SMALL = SYN / "village.small-case.json"
PERSONAS = str(SYN / "personas.synthetic.json")


def small():
    return load_case(SMALL)


# ------------------------------------------------- the bundle says who this is
def test_the_second_community_has_its_own_ids_and_no_village_head():
    bundle, village = small()
    assert sorted(bundle.resident_ids) == ["R1", "R2", "R3", "R4", "R5"]
    assert bundle.village_head_id is None, "이장 역할이 없는 공동체다"
    assert not any(r["isVillageHead"] for r in village.residents)
    # Nothing was substituted: the role simply is not there.
    assert "village_head" not in bundle.roleAssignments


def test_no_relation_edge_from_the_other_community_comes_along():
    bundle, _ = small()
    relations = get_relations(bundle.relationRevisionId)
    assert relations.edges == [], (
        "다른 공동체의 P번호 관계가 새 사례에 들어오면 안 된다")


def test_the_ledger_belongs_to_this_community_and_assumes_nothing():
    bundle, _ = small()
    from app.simulation.ledger import load_ledger

    ledger = load_ledger(SMALL, bundle.resident_ids, bundle.village_head_id)
    assert ledger.id == "ledger-small-case-v1"
    assert {e.actorId for e in ledger.entries} == set(bundle.resident_ids)
    assert ledger.routineKnowledge == [], (
        "이장이 전원의 일과를 안다는 가정이 새 사례에 자동 생성되면 안 된다")
    # Four of the five topics were never asked, and the ledger says so rather
    # than reading as "this person has nobody".
    assert ledger.status("R3", "help_contacts").value == "not_asked"
    assert ledger.status("R1", "companions").value == "asked_none"


def test_a_missing_ledger_on_a_headless_community_invents_no_informant():
    bundle, _ = small()
    fallback = empty_ledger_for(bundle)
    assert fallback.routineKnowledge == []
    assert all(e.status.value == "not_asked" for e in fallback.entries)


def test_a_missing_ledger_on_a_community_with_a_head_keeps_the_old_assumption():
    """Stored runs were made under it, so the fallback still reproduces it -
    with the assumption written down rather than hidden in code."""
    bundle = build_case(load_village(EUNJEOM_LIKE))
    fallback = empty_ledger_for(bundle)
    assert bundle.village_head_id is not None
    assert {k.knowerId for k in fallback.routineKnowledge} == {bundle.village_head_id}
    assert all(k.provenance == "researcher-assumption" for k in fallback.routineKnowledge)


# ----------------------------------------------------- a plan the case can run
def test_a_plan_that_needs_the_head_is_refused_for_this_case_with_a_reason():
    bundle, _ = small()
    reason = unsupported_reason(bundle, "head_first")
    assert reason is not None
    assert "이장" in reason and "임의의 주민을 그 자리에 앉히지 않는다" in reason


def test_a_plan_that_needs_no_role_is_supported():
    bundle, _ = small()
    assert unsupported_reason(bundle, "neighbour_first") is None
    assert unsupported_reason(bundle, "relation_first") is None


def test_the_other_community_still_supports_the_head_plan():
    bundle = build_case(load_village(EUNJEOM_LIKE))
    assert unsupported_reason(bundle, "head_first") is None


# ------------------------------------------------------------ validation rules
def test_a_role_assigned_to_somebody_outside_the_case_is_refused():
    bundle, _ = small()
    broken = bundle.model_copy(update={"roleAssignments": {"village_head": "P6"}})
    with pytest.raises(CaseValidationError):
        from app.simulation.ledger import legacy_ledger

        from app.simulation.case_bundle import validate

        validate(broken, get_relations("rel-none"),
                 legacy_ledger(bundle.resident_ids, ""))


def test_relations_naming_strangers_are_refused_rather_than_merged():
    bundle, _ = small()
    from app.simulation.case_bundle import validate
    from app.simulation.ledger import legacy_ledger

    with pytest.raises(CaseValidationError) as excinfo:
        validate(bundle, get_relations("rel-v1"), legacy_ledger(bundle.resident_ids, ""))
    assert "다른 공동체의 관계가" in str(excinfo.value)


# ------------------------------------------------- the same loop, on this case
def test_the_headless_community_runs_and_says_it_had_nobody_to_ask():
    """The point is not that it succeeds. It is that the result is this
    community's own - a day where there was nobody recorded to ask - rather
    than 은점's head quietly stepping in."""
    from app.simulation.decks.registry import POLICIES

    policy = POLICIES["policy-C-v1"]  # neighbour-first: needs no role
    result = run_attempt("att-small", policy.id, "deck-r1-no-response-v1",
                         "assumed-resources-v1", policy=policy,
                         village=load_village(SMALL), persona_path=PERSONAS,
                         environment_id="env-v3-fixed")
    assert result.events, "이 사례에서도 하루가 돌아야 한다"
    # No P-number from the other community appears anywhere in the log.
    actors = {e.actorId for e in result.events} | {
        str(e.payload.get("toActorId")) for e in result.events}
    assert not any(a.startswith("P") and a[1:].isdigit() for a in actors if a), actors
    assert result.metrics["elicitation"]["ledgerId"] == "ledger-small-case-v1"


def test_the_head_plan_is_refused_before_it_runs_on_the_headless_community():
    from app.simulation.decks.registry import POLICIES

    bundle, _ = small()
    policy = POLICIES["policy-A-v1"]
    assert policy.contactStrategy.value == "head_first"
    assert unsupported_reason(bundle, policy.contactStrategy.value) is not None
    # And if it is forced through anyway, the engine refuses rather than
    # picking somebody: a run that quietly asked a substitute would be the
    # dangerous outcome, not the loud one.
    with pytest.raises(Exception):
        run_attempt("att-small-head", policy.id, "deck-r1-no-response-v1",
                    "assumed-resources-v1", policy=policy,
                    village=load_village(SMALL), persona_path=PERSONAS,
                    environment_id="env-v3-fixed")
