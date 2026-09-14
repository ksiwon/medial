"""The world's rules are data, and they are not MEDial's to edit.

These tests pin two things that are easy to lose again:

* ``env-v1`` must reproduce, value for value, the module constants it replaced.
  If it does not, every stored attempt silently ran on different rules than the
  ones the comparison screen now shows;
* a Change Set must not be able to reach a fixed case input. Making the phone
  reach a field is not MEDial improving, it is the problem being deleted.

    python -m pytest server/tests/simulation/test_environment.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))

from app.simulation.contracts import Channel, EnvironmentRevision  # noqa: E402
from app.simulation.environment import (  # noqa: E402
    ENV_V1,
    get_environment,
    resolve_place,
)
from app.simulation.iteration.contracts import (  # noqa: E402
    ChangeSet,
    ChangeSetValidation,
    ExecutionBinding,
    RuleChange,
)
from app.simulation.iteration.service import SUPPORTED_CAPABILITIES  # noqa: E402
from app.simulation.iteration.validation import validate_change_set  # noqa: E402
from app.simulation.runner import build_attempt  # noqa: E402

SYNTHETIC = str(REPO_ROOT / "fixtures" / "synthetic" / "village.synthetic.json")

#: Exactly the table that used to live in ``agents/rule_agents.py``.
LEGACY_PHONE = {
    "FARM": (False, "source-adapted"),
    "SEA": (False, "researcher-assumption"),
    "PORT": (False, "researcher-assumption"),
    "FOOD": (False, "researcher-assumption"),
    "EN_ROUTE": (False, "researcher-assumption"),
    "HOME:P1": (True, "researcher-assumption"),
    "HALL": (True, "researcher-assumption"),
    "TOWN": (True, "researcher-assumption"),
    "PATROL": (True, "researcher-assumption"),
}

#: Exactly the dict that used to live in ``engine.PRIORITY``.
LEGACY_PRIORITY = {
    "scenario": 10, "contact": 20, "reaction": 30, "arrival": 40,
    "institution": 50, "transport": 60, "finalize": 90,
}


@pytest.mark.parametrize(("place", "expected"), sorted(LEGACY_PHONE.items()))
def test_env_v1_reproduces_the_old_phone_table(place, expected):
    reachable, provenance = expected
    rule = ENV_V1.reaches(place, Channel.phone)
    assert rule.reachable is reachable
    assert rule.provenance == provenance
    assert rule.reason


def test_only_the_field_rule_claims_to_come_from_the_source():
    """The one measured thing must not get lost among the assumptions."""
    sourced = [r.place for r in ENV_V1.reachability
               if r.channel is Channel.phone and r.provenance == "source-adapted"]
    assert sourced == ["FARM"]


def test_the_home_device_only_reaches_its_own_house():
    assert ENV_V1.reaches(resolve_place("HOME:P1", "P1"), Channel.home_device).reachable is True
    # The same house, a different listener: still out of reach.
    assert ENV_V1.reaches(resolve_place("HOME:P1", "P6"), Channel.home_device).reachable is False
    assert ENV_V1.reaches(resolve_place("FARM", "P1"), Channel.home_device).reachable is False


def test_env_v1_reproduces_the_old_scheduling_order():
    assert {kind: ENV_V1.priority(kind) for kind in LEGACY_PRIORITY} == LEGACY_PRIORITY


def test_an_unknown_scheduling_kind_fails_where_it_is_asked_for():
    with pytest.raises(KeyError):
        ENV_V1.priority("no-such-kind")


def test_the_environment_is_part_of_the_attempt_inputs():
    """Two runs that disagree about the world must not report the same inputs."""
    from app.simulation.decks.registry import DECKS, POLICIES, RESOURCE_SETS
    from app.simulation.village import load_village

    village = load_village(SYNTHETIC)
    policy = next(iter(POLICIES.values()))
    deck = DECKS["deck-p1-no-response-v1"]
    resources = RESOURCE_SETS["assumed-resources-v1"]

    base = build_attempt("att-1", "x", policy, deck, resources, village)
    assert base.environmentRevisionId == "env-v1"
    assert "environment" in base.inputHashes

    louder = ENV_V1.model_copy(deep=True)
    for rule in louder.reachability:
        if rule.place == "FARM" and rule.channel is Channel.phone:
            rule.reachable = True
    changed = build_attempt("att-2", "x", policy, deck, resources, village,
                            environment=louder)
    assert changed.inputHashes["environment"] != base.inputHashes["environment"]


def test_the_environment_is_declared_not_editable():
    assert EnvironmentRevision.EDITABLE_BY_CHANGE_SET is False
    assert get_environment().id == "env-v1"


@pytest.mark.parametrize("key", [
    "environment.reachability.FARM.phone",
    "reachability",
    "variation.departJitterMin",
    "scheduling.contact",
    "village.residents.P1.plan",
    "persona.P9.drivesSelf",
])
def test_a_change_set_cannot_edit_a_fixed_case_input(key):
    """MEDial must not be able to improve by stopping the problem from happening."""
    from app.simulation.decks.registry import ITERATION_START_POLICY, POLICIES

    policy = POLICIES[ITERATION_START_POLICY].model_dump(mode="json")
    change_set = ChangeSet(
        id="c1", sessionId="s", generationIndex=0, baseRevisionId=policy["id"],
        label="변경", reviewItemRefs=["rev-x#0"], mechanism="검증",
        changes=[RuleChange(
            scope="task", target="timing_burden",
            questId="quest:no-response-welfare-check",
            taskIds=["task:contact-subject"], field="retry",
            beforeRule="재연락하지 않는다.", afterRule="한 번 재연락한다.",
            executionBindings=[ExecutionBinding(key=key, before=False, after=True)])],
        createdAt="now")

    checked = validate_change_set(
        change_set, policy=policy,
        capabilities=SUPPORTED_CAPABILITIES,
        known_review_items={"rev-x#0"})

    assert checked.validationStatus is not ChangeSetValidation.valid
    assert any("고정 사례 입력" in error for error in checked.validationErrors), \
        checked.validationErrors
