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
    ENV_V2,
    LEGACY_ENVIRONMENT_ID,
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
    assert base.environmentRevisionId == "env-v2"
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
    assert get_environment().id == "env-v2"
    assert get_environment(LEGACY_ENVIRONMENT_ID).id == "env-v1"


# ----------------------------------------------------- who can be asked to go
#: Exactly what ``world.INTERRUPTIBLE_PLACES`` produced before availability
#: became data - including the home rule that never matched.
LEGACY_AVAILABLE = {
    "PATROL": True, "HALL": True, "FARM": True,
    "HOME:P1": False, "HOME:P9": False,
    "SEA": False, "PORT": False, "FOOD": False, "TOWN": False, "EN_ROUTE": False,
}


@pytest.mark.parametrize(("place", "expected"), sorted(LEGACY_AVAILABLE.items()))
def test_env_v1_reproduces_what_the_old_constant_actually_did(place, expected):
    """Not what it was written to do - what it did. Stored runs ran on this."""
    rule = ENV_V1.available(place)
    assert rule.available is expected
    assert rule.reason


def test_v1_says_out_loud_that_the_home_rule_was_not_intended():
    rule = ENV_V1.available("HOME:P1")
    assert rule.available is False
    assert "구현상 결과" in rule.reason


def test_v2_changes_exactly_one_rule():
    """A revision that quietly changed several things would not be readable."""
    differ = [(a.place, a.available, b.available)
              for a, b in zip(ENV_V1.availability, ENV_V2.availability)
              if a.available != b.available]
    assert differ == [("HOME:*", False, True)]
    assert ENV_V1.reachability == ENV_V2.reachability
    assert ENV_V1.scheduling == ENV_V2.scheduling


def test_v2_lets_somebody_at_home_be_asked():
    assert ENV_V2.available("HOME:P9").available is True
    # And says nothing new about being out at work.
    assert ENV_V2.available("SEA").available is False


def test_a_place_with_no_rule_still_has_an_answer():
    assert ENV_V2.available("SOMEWHERE_NEW").available is False


def test_the_two_revisions_are_not_a_controlled_pair():
    """Changing the world is not MEDial improving, and the screen must say so."""
    from app.simulation.persistence.store import Store
    from app.simulation.service import SimulationService, build_comparison
    from app.simulation.village import load_village

    store = Store(":memory:")

    def run_on(environment_id, label):
        service = SimulationService(
            store=store, village=load_village(SYNTHETIC),
            persona_path=str(REPO_ROOT / "fixtures" / "synthetic"
                             / "personas.synthetic.json"),
            environment_id=environment_id)
        return service.create_attempt("policy-A-v1", "deck-p1-no-response-v1",
                                      "assumed-resources-v1", label=label)

    first = run_on("env-v1-fixed", "v1")
    second = run_on("env-v2-fixed", "v2")
    service = SimulationService(store=store, village=load_village(SYNTHETIC))
    report = build_comparison(service,
                              [first["attempt"]["id"], second["attempt"]["id"]])

    assert report["controlled"] is False
    assert "environment" in report["differingInputs"]
