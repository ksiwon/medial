"""Saying no, one reason at a time.

Until now a resident who could go, went. A village where nobody can refuse has no
burden to report, so a policy comparison measured routing and never the cost of
asking.

The tempting fix is a score: rate how busy they are, how close they are to the
asker, how often they have been called, add it up, refuse above a threshold.
These tests pin the reasons it is a list instead.

* **Nothing is added together.** The first line that fires is the reason, so a
  refusal can always be traced to one statement a reader can agree or disagree
  with - never to a number whose parts are no longer separable.
* **The lines are not equally grounded and do not pretend to be.** One comes from
  an interview; the rest are researcher settings and say so.
* **A line can be switched off on its own**, which is the only way to show which
  one actually changed the day. A sum cannot be taken apart like that.

    python -m pytest server/tests/simulation/test_decline_rules.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))

from app.simulation.agents.decline_rules import RULE_ORDER, assess  # noqa: E402
from app.simulation.contracts import EventType, InteractionRules  # noqa: E402
from app.simulation.environment import ENV_V1, ENV_V2  # noqa: E402
from app.simulation.observations import ActorView, Observation  # noqa: E402
from app.simulation.runner import run_attempt  # noqa: E402
from app.simulation.village import load_village  # noqa: E402

SYNTHETIC = str(REPO_ROOT / "fixtures" / "synthetic" / "village.synthetic.json")
PERSONAS = str(REPO_ROOT / "fixtures" / "synthetic" / "personas.synthetic.json")
RULES = InteractionRules()


def _view(*, persona=None, interruptible=True, contacts=0, cap=2,
          travel_minutes=5.0, relations=None, requester="MEDial"):
    offer = Observation(
        id="obs-1", attemptId="att-1", actorId="P4", simTimeMs=0,
        kind="request.offered", subjectId="P1",
        payload={"requestId": "req-1", "need": "welfare_check",
                 "fromActorId": requester, "travelMinutes": travel_minutes},
        sourceEventId="ev-1")
    return ActorView(
        actor_id="P4", sim_time_ms=0, observations=[offer],
        own_place="HOME:P4", own_activity="집", own_interruptible=interruptible,
        contacts_received_today=contacts, persona=persona or {},
        relations=relations or [], policy={"helperContactCap": cap})


# ------------------------------------------------------- nothing is summed
def test_only_one_line_ever_answers():
    """Three reasons to refuse at once still produce one reason, not a total."""
    view = _view(persona={"declineConditions": ["영업 중 가게를 비울 수 없다"]},
                 interruptible=False, contacts=9, travel_minutes=400)
    verdict = assess(view, RULES)
    assert verdict.rule == "persona_condition"
    assert verdict.reason == "영업 중 가게를 비울 수 없다"
    # No number anywhere in the answer that could be read as a strength.
    assert not any(isinstance(v, (int, float)) and k.endswith(("Score", "score"))
                   for k, v in verdict.detail.items())


def test_the_best_evidenced_line_is_asked_first():
    """When several could fire, the reason given is the one from an interview."""
    assert RULE_ORDER[0] == "persona_condition"


def test_a_line_says_where_its_number_came_from():
    view = _view(travel_minutes=400)
    verdict = assess(view, RULES)
    assert verdict.rule == "too_far"
    assert verdict.provenance == "researcher-assumption"
    assert "연구자 설정" in verdict.detail["note"]
    assert verdict.detail["distanceBasis"] == "road-graph-shortest-path"


def test_the_interview_line_is_the_only_one_that_claims_the_source():
    view = _view(persona={"declineConditions": ["영업 중 가게를 비울 수 없다"]})
    assert assess(view, RULES).provenance == "source-adapted"
    for other in (_view(travel_minutes=400), _view(contacts=9),
                  _view(interruptible=False)):
        assert assess(other, RULES).provenance == "researcher-assumption"


# ----------------------------------------------------------- the lines work
def test_somebody_free_and_close_simply_goes():
    verdict = assess(_view(), RULES)
    assert verdict.action == "accept"
    assert verdict.rule is None


def test_being_tied_up_is_not_a_refusal():
    """It means "not from here", and the caller tries a neighbour first."""
    verdict = assess(_view(interruptible=False), RULES)
    assert verdict.action == "step_aside"
    assert verdict.rule == "cannot_leave_here"


def test_being_called_too_often_uses_the_condition_the_designer_already_has():
    assert assess(_view(contacts=3, cap=2), RULES).rule == "asked_too_often"
    assert assess(_view(contacts=2, cap=2), RULES).action == "accept"
    # And it reports the cap it read, so the number on screen is the one used.
    assert assess(_view(contacts=3, cap=2), RULES).detail["capFromPolicy"] == 2


def test_a_walk_just_inside_the_limit_is_still_made():
    assert assess(_view(travel_minutes=RULES.maxErrandMinutes), RULES).action == "accept"
    assert assess(_view(travel_minutes=RULES.maxErrandMinutes + 1), RULES).rule == "too_far"


def test_a_missing_distance_does_not_become_a_refusal():
    """Not knowing how far it is is not a reason to say no."""
    assert assess(_view(travel_minutes=None), RULES).action == "accept"


# ------------------------------------------- the exception that was unknown
KIN_PERSONA = {"acceptanceConditions": ["가까운 친척의 부탁이면 경로 효율과 무관하게 간다"]}


def test_a_relatives_request_overrides_the_distance_for_the_person_who_said_so():
    """This was recorded as ``unknown`` until the relation graph existed."""
    far = _view(persona=KIN_PERSONA, travel_minutes=400, requester="P6",
                relations=[{"actorId": "P6", "kind": "kin"}])
    assert assess(far, RULES, requester_id="P6", relation_kind="kin").action == "accept"


def test_the_exception_belongs_to_the_person_who_stated_it():
    """Somebody without that interview line does not get it."""
    far = _view(travel_minutes=400, requester="P6",
                relations=[{"actorId": "P6", "kind": "kin"}])
    assert assess(far, RULES, requester_id="P6", relation_kind="kin").rule == "too_far"


def test_the_exception_does_not_stretch_to_other_kinds_of_tie():
    far = _view(persona=KIN_PERSONA, travel_minutes=400, requester="P7",
                relations=[{"actorId": "P7", "kind": "companion"}])
    verdict = assess(far, RULES, requester_id="P7", relation_kind="companion")
    assert verdict.rule == "too_far"
    assert verdict.detail["kinExceptionExists"] is True
    assert verdict.detail["kinExceptionApplies"] is False


# --------------------------------------------------- one line at a time off
@pytest.mark.parametrize("off", RULE_ORDER)
def test_any_single_line_can_be_switched_off(off):
    """The point of a list. A summed score cannot be taken apart this way."""
    rules = InteractionRules(
        enabledDeclineRules=[k for k in RULE_ORDER if k != off])
    view = {
        "persona_condition": _view(persona={"declineConditions": ["가게를 못 비운다"]}),
        "cannot_leave_here": _view(interruptible=False),
        "asked_too_often": _view(contacts=9),
        "too_far": _view(travel_minutes=400),
    }[off]
    assert assess(view, rules).rule != off


def test_with_every_line_off_everybody_goes():
    rules = InteractionRules(enabledDeclineRules=[])
    view = _view(persona={"declineConditions": ["가게를 못 비운다"]},
                 interruptible=False, contacts=9, travel_minutes=400)
    assert assess(view, rules).action == "accept"


# --------------------------------------------------------------- end to end
def _run(policy_id, environment_id, attempt_id):
    return run_attempt(attempt_id, policy_id, "deck-p1-no-response-v1",
                       "assumed-resources-v1", village=load_village(SYNTHETIC),
                       persona_path=PERSONAS, environment_id=environment_id)


def _declines(result):
    return [e for e in result.events if e.type is EventType.request_declined]


def test_the_restaurant_couple_refuse_for_the_reason_they_gave():
    result = _run("policy-C-v1", "env-v2-fixed", "att-c")
    declined = _declines(result)
    assert [e.actorId for e in declined] == ["P10", "P11"]
    for event in declined:
        assert event.payload["rule"] == "persona_condition"
        assert event.payload["reason"] == "영업 중 가게를 비울 수 없다"
        assert event.payload["evidenceRefs"], "an interview reason must cite it"


def test_the_log_carries_both_a_key_and_a_sentence():
    """The screen shows plain words; a test or a metric still has an exact match."""
    event = _declines(_run("policy-C-v1", "env-v2-fixed", "att-c2"))[0]
    assert event.payload["rule"] in RULE_ORDER
    assert event.payload["reason"] != event.payload["rule"]


def test_the_refusals_are_counted_by_the_rule_that_fired():
    """What the comparison screen reads: a count per rule, and each sentence."""
    refusals = _run("policy-C-v1", "env-v2-fixed", "att-c3").metrics["refusals"]
    assert refusals["count"] == 2
    assert refusals["byRule"] == {"persona_condition": 2}
    assert [(r["actorId"], r["kind"], r["seenByMedial"]) for r in refusals["rows"]] == [
        ("P10", "declined", True), ("P11", "declined", True)]
    assert all(r["reason"] == "영업 중 가게를 비울 수 없다" for r in refusals["rows"])
    # Asking each neighbour in turn is not a hand-off between neighbours.
    assert _run("policy-C-v1", "env-v2-fixed", "att-c4").metrics["handovers"]["count"] == 0


def test_asking_the_neighbours_first_touches_more_people_than_asking_the_head():
    """The trade-off the policy exists to show, not a winner."""
    head = _run("policy-A-v1", "env-v2-fixed", "att-head")
    neighbours = _run("policy-C-v1", "env-v2-fixed", "att-nb")

    def touched(result):
        return {a for a, b in result.metrics["residentBurden"].items()
                if b["contactsReceived"]}

    assert touched(head) == {"P6"}
    assert len(touched(neighbours)) > len(touched(head))
    # And it is not free. Both days close - since 0.4.0 an empty house sends
    # MEDial to the head for where to look - but the neighbour-first day asked
    # the head anyway, after three neighbours had been asked and one had walked.
    assert head.metrics["requests"]["resolved"] == 1
    assert neighbours.metrics["requests"]["resolved"] == 1
    assert "P6" in touched(neighbours)


def test_the_same_policy_reaches_different_people_in_the_two_worlds():
    """env-v1 could not let anybody at home go, so the day ran out of people."""
    old = _run("policy-C-v1", "env-v1-fixed", "att-old")
    new = _run("policy-C-v1", "env-v2-fixed", "att-new")

    def touched(result):
        return {a for a, b in result.metrics["residentBurden"].items()
                if b["contactsReceived"]}

    assert touched(old) != touched(new)
    # Under v1 nobody ever reached the house; under v2 somebody did.
    assert not [e for e in old.events if e.type is EventType.task_check_performed]
    assert [e for e in new.events if e.type is EventType.task_check_performed]


def test_a_policy_that_names_one_person_still_ends_when_they_say_no():
    """Asking the next person is the neighbour-first policy's doing, not a default."""
    result = _run("policy-A-v1", "env-v2-fixed", "att-single")
    offered = [e for e in result.events if e.type is EventType.request_offered]
    assert [e.payload["toActorId"] for e in offered] == ["P6"]


def test_both_environments_read_the_same_refusal_table():
    assert ENV_V1.interaction.enabledDeclineRules == list(RULE_ORDER)
    assert ENV_V2.interaction.enabledDeclineRules == list(RULE_ORDER)
