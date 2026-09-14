"""The village on models: MEDial's head and every resident answered by a model.

No provider is called here. A scripted stand-in answers each role the way a
model would, so what is pinned is the *plumbing* and the *fence*:

* two tiers - the head's calls are recorded under the head model, residents'
  under the resident model, and neither recording is disturbed by the other;
* what MEDial says travels to the person asked, and what they say back is in
  the head's next prompt - the exchange is the events, not a side channel;
* the designer's conditions are checked *after* the head chooses. A choice
  that breaks them is sent back once with the reason; a second one is a
  failure, and MEDial does nothing rather than falling back to the rules;
* the decline table is written beside a model resident's answer, and never
  applied to it (D082).

    python -m pytest server/tests/simulation/test_llm_village.py -q
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))

from app.simulation.contracts import MEDIAL, EventType, ModelPolicy  # noqa: E402
from app.simulation.persistence.store import Store  # noqa: E402
from app.simulation.runner import run_attempt  # noqa: E402
from app.simulation.service import SimulationService  # noqa: E402
from app.simulation.village import load_village  # noqa: E402

SYNTHETIC = str(REPO_ROOT / "fixtures" / "synthetic" / "village.synthetic.json")
PERSONAS = str(REPO_ROOT / "fixtures" / "synthetic" / "personas.synthetic.json")
DECK = "deck-p1-no-response-v1"
RES = "assumed-resources-v1"

POLICY = ModelPolicy(provider="fake", headModelId="fake-head", residentModelId="fake-lite",
                     temperature=0.0, mode="record")


class Village:
    """A scripted model for both tiers.

    ``head_orders`` are the ask orders the head answers with, one per decision,
    so a test can make the first answer break the fence and the second keep it.
    ``resident_reply`` decides what every resident says.
    """

    def __init__(self, head_orders=None, resident_reply=None):
        self.head_orders = list(head_orders or [["P6"]])
        self.resident_reply = resident_reply or (lambda prompt: {"action": "accept"})
        self.calls: list[tuple[str, dict]] = []
        self.available = True

    def verify_models(self, policy):
        return []

    def __call__(self, prompt, policy, spec):
        self.calls.append((spec.role, prompt))
        if spec.role == "head":
            return json.dumps(self._head(prompt), ensure_ascii=False)
        return json.dumps(self._resident(prompt), ensure_ascii=False)

    def _head(self, prompt):
        if prompt["stage"] == "read":
            return {"summary": "%s 어르신이 안내 시계에 응답하지 않았다." % prompt["subjectId"],
                    "locationStatus": "unconfirmed", "clinicalStatus": "unconfirmed",
                    "evidenceEventIds": [], "emergencyEvidenceEventIds": [],
                    "rationale": "응답이 없다는 것 외에는 아는 것이 없다."}
        if prompt["stage"] == "absent":
            return {"action": "continue_check", "rationale": "이장이 제안한 곳을 보자.",
                    "message": "말씀하신 곳도 한번 봐 주시겠어요?"}
        order = self.head_orders.pop(0) if len(self.head_orders) > 1 else self.head_orders[0]
        people = [p["actorId"] for p in prompt["people"]]
        return {
            "action": "offer_request" if order else "wait",
            "candidates": [{"actorId": p, "included": p in order,
                            "reason": "부탁할 사람" if p in order else "지금은 아니다"}
                           for p in people],
            "askOrder": order,
            "waitMinutes": None if order else 30,
            "rationale": "가까이 있을 사람에게 먼저 부탁한다." if order else "30분 뒤에 다시 본다.",
            "message": "%s 어르신이 오늘 안내 시계에 응답이 없으셨어요. 잠깐 들러 봐 주실 수 있을까요?"
                       % prompt["subjectId"],
        }

    def _resident(self, prompt):
        offer = next((o for o in reversed(prompt["observations"])
                      if o["kind"] in ("request.offered", "request.relayed")), None)
        if "report_observation" in prompt["allowedActions"]:
            # Been to the house, nobody there: say where they usually are.
            known = prompt.get("localKnowledge") or []
            return {"action": "report_observation", "requestId": offer["payload"]["requestId"],
                    "targetActorId": None,
                    "suggestedPlace": known[0]["place"] if known else "NOWHERE",
                    "utterance": "이 시간이면 밭에 계실 겁니다. 가 보지요.",
                    "usedObservationIds": [prompt["observations"][-1]["id"]],
                    "uncertainty": "평소 일과로 미루어 짐작"}
        reply = self.resident_reply(prompt)
        return {"action": reply["action"], "requestId": offer["payload"]["requestId"] if offer else None,
                "targetActorId": reply.get("targetActorId"), "suggestedPlace": None,
                "utterance": reply.get("utterance", "네, 제가 가 볼게요."),
                "usedObservationIds": [offer["id"]] if offer else [],
                "uncertainty": None}


def _run(village: Village, policy_id="policy-A-v1", attempt_id="att-llm"):
    return run_attempt(attempt_id, policy_id, DECK, RES, adapter="llm",
                       village=load_village(SYNTHETIC), persona_path=PERSONAS,
                       environment_id="env-v3-fixed", model_policy=POLICY,
                       provider=village)


def _of(result, etype):
    return [e for e in result.events if e.type is etype]


# --------------------------------------------------------------- two tiers
def test_only_someone_who_knows_the_persons_day_is_asked_where_they_would_be():
    # Live run, 2026-09-15: P9 went to the house, found it empty, and was
    # offered "say where they would be" with an empty localKnowledge. The model
    # answered with no place and the run failed as if it had invented one.
    # The question belongs to the person who holds that knowledge.
    village = Village(head_orders=[["P9"], ["P9"], ["P9"]])
    result = _run(village, policy_id="policy-C-v1")
    asked = [c for role, c in village.calls if role == "resident" and c["actorId"] == "P9"]
    # Asked once, to go; not asked again to guess a place he has no knowledge of.
    assert len(asked) == 1
    assert "report_observation" not in asked[0]["allowedActions"]
    failures = [e for e in _of(result, EventType.medial_waiting)
                if e.payload.get("reason") == "adapter_error"]
    assert failures == []
    assert result.metrics["requests"]["unresolved"] == 1


def test_the_head_and_the_residents_are_asked_on_their_own_models():
    village = Village()
    result = _run(village)
    roles = {r.role: r.modelId for r in result.model_calls}
    assert roles == {"head": "fake-head", "resident": "fake-lite"}
    # Read the situation, decide, and decide again when the house was empty.
    assert [r.actorId for r in result.model_calls if r.role == "head"] == [MEDIAL] * 3
    assert result.metrics["requests"]["resolved"] == 1


def test_what_medial_says_reaches_the_person_asked_and_their_answer_comes_back():
    village = Village()
    result = _run(village)
    offered = _of(result, EventType.request_offered)[0]
    assert "응답이 없으셨어요" in offered.payload["message"]
    # The resident's prompt carried MEDial's words and nothing else about P1.
    resident_prompt = next(p for role, p in village.calls if role == "resident")
    offer = resident_prompt["observations"][-1]
    assert offer["payload"]["message"] == offered.payload["message"]
    # And the resident's reply is on the event MEDial reads.
    accepted = _of(result, EventType.request_accepted)[0]
    assert accepted.payload["utterance"] == "네, 제가 가 볼게요."


def test_the_resident_prompt_never_carries_another_actors_view():
    village = Village()
    _run(village)
    for role, prompt in village.calls:
        if role != "resident":
            continue
        blob = json.dumps(prompt, ensure_ascii=False)
        assert "eventsSoFar" not in prompt
        assert "people" not in prompt
        assert "routineSaysHomeNow" not in blob


# ----------------------------------------------------------------- the fence
def test_a_choice_outside_the_designers_conditions_is_sent_back_once():
    """First answer asks the subject to check on themselves; second is fine."""
    village = Village(head_orders=[["P1"], ["P6"]])
    result = _run(village)
    decide_prompts = [p for role, p in village.calls if role == "head" and p["stage"] == "decide"]
    assert len(decide_prompts) == 2
    assert "rejected" in decide_prompts[1]
    assert any("본인" in line for line in decide_prompts[1]["rejected"]["problems"])
    assert _of(result, EventType.request_offered)[0].payload["toActorId"] == "P6"
    assert result.metrics["adapterFailures"] == 0


def test_a_second_bad_choice_is_a_failure_and_nothing_falls_back_to_the_rules():
    village = Village(head_orders=[["P1"], ["P1"], ["P1"]])
    result = _run(village)
    assert not _of(result, EventType.request_offered)
    failures = [e for e in _of(result, EventType.medial_waiting)
                if e.payload.get("reason") == "adapter_error"]
    assert failures and failures[0].payload["actorId"] == MEDIAL
    assert "두 번" in failures[0].payload["detail"]
    assert result.metrics["requests"]["unresolved"] == 1


@pytest.mark.parametrize(("policy_id", "order", "expect"), [
    ("policy-C-v1", ["P2", "P3", "P4", "P5"], "neighbourAskLimit"),
    ("policy-A-v1", ["P2"], "head_first"),
])
def test_each_knob_is_a_line_the_head_cannot_cross(policy_id, order, expect):
    village = Village(head_orders=[order, order, order])
    result = _run(village, policy_id=policy_id)
    failure = next(e for e in _of(result, EventType.medial_waiting)
                   if e.payload.get("reason") == "adapter_error")
    assert expect in failure.payload["detail"]


def test_a_reading_that_claims_more_than_the_evidence_is_sent_back():
    class Overclaiming(Village):
        def __init__(self):
            super().__init__()
            self.readings = 0

        def _head(self, prompt):
            if prompt["stage"] == "read":
                self.readings += 1
                if "rejected" not in prompt:
                    return {"summary": "쓰러진 것 같다", "locationStatus": "confirmed_home",
                            "clinicalStatus": "concern", "evidenceEventIds": [],
                            "emergencyEvidenceEventIds": ["ev-999"],
                            "rationale": "느낌이 그렇다"}
            return super()._head(prompt)

    village = Overclaiming()
    result = _run(village)
    assert village.readings == 2
    classified = _of(result, EventType.medial_classified)[0]
    assert classified.payload["locationStatus"] == "unconfirmed"
    assert classified.payload["emergencyEvidence"] == []


def test_waiting_is_a_decision_with_a_clock_on_it_not_an_end():
    """The head may wait, but the question comes back, and not forever."""
    village = Village(head_orders=[[], ["P6"]])
    result = _run(village)
    waited = [e for e in _of(result, EventType.medial_waiting)
              if e.payload.get("reason") == "head_wait"]
    assert len(waited) == 1
    offered = _of(result, EventType.request_offered)[0]
    assert offered.simTimeMs == waited[0].payload["untilMs"]
    assert offered.simTimeMs - waited[0].simTimeMs == 30 * 60_000
    assert result.metrics["requests"]["resolved"] == 1


def test_the_head_cannot_wait_a_third_time():
    village = Village(head_orders=[[], [], [], []])
    result = _run(village)
    waited = [e for e in _of(result, EventType.medial_waiting)
              if e.payload.get("reason") == "head_wait"]
    assert len(waited) == 2
    failure = next(e for e in _of(result, EventType.medial_waiting)
                   if e.payload.get("reason") == "adapter_error")
    assert "두 번 기다렸다" in failure.payload["detail"]


# ------------------------------------------------------------- the yardstick
def test_a_model_residents_refusal_is_their_own_and_the_table_is_beside_it():
    village = Village(resident_reply=lambda p: {"action": "decline",
                                                "utterance": "오늘은 허리가 아파서 못 가겠네요."})
    result = _run(village)
    declined = _of(result, EventType.request_declined)[0]
    assert declined.payload["rule"] == "llm_judgement"
    assert declined.payload["reason"] == "오늘은 허리가 아파서 못 가겠네요."
    # The table, from the same view, would have said yes: recorded, not applied.
    assert declined.payload["ruleTableSaid"]["action"] == "accept"
    assert declined.payload["agreesWithRuleTable"] is False
    assert result.metrics["refusals"]["byRule"] == {"llm_judgement": 1}


def test_a_model_resident_may_hand_the_request_on_only_along_a_recorded_relation():
    def reply(prompt):
        if prompt["actorId"] == "P6" and prompt["relations"]:
            return {"action": "relay", "targetActorId": prompt["relations"][0]["actorId"],
                    "utterance": "내가 지금 못 가니 자네가 좀 들러 봐 주게."}
        return {"action": "accept"}

    village = Village(resident_reply=reply)
    result = _run(village)
    relayed = _of(result, EventType.request_relayed)
    assert len(relayed) == 1 and relayed[0].actorId == "P6"
    # The relayer's words are what the next person is asked with.
    target_prompt = next(p for role, p in village.calls
                         if role == "resident" and p["actorId"] == relayed[0].payload["toActorId"])
    assert target_prompt["observations"][-1]["payload"]["message"] == "내가 지금 못 가니 자네가 좀 들러 봐 주게."
    assert result.metrics["handovers"]["count"] == 1


def test_handing_it_to_a_stranger_is_rejected_for_a_model_too():
    village = Village(resident_reply=lambda p: (
        {"action": "relay", "targetActorId": "P3", "utterance": "P3가 가 보게."}
        if p["actorId"] == "P6" else {"action": "accept"}))
    result = _run(village)
    assert not _of(result, EventType.request_relayed)
    assert result.metrics["rejectedProposals"] >= 1


# ------------------------------------------------------------------- replay
def test_a_fork_replays_both_tiers_without_asking_again():
    store = Store(":memory:")
    village = Village()
    svc = SimulationService(store=store, village=load_village(SYNTHETIC),
                            persona_path=PERSONAS, environment_id="env-v3-fixed",
                            model_policy=POLICY, provider=village)
    parent = svc.create_attempt("policy-A-v1", DECK, RES, adapter="llm")
    live = len(village.calls)
    assert live > 0
    # Fork after the head has read, decided and been answered (events 5-9):
    # those three calls are the shared prefix and must come from the recording.
    forked = svc.fork_attempt(parent["attempt"]["id"], 9, {}, "같은 정책으로 분기")
    rows = store.attempt_model_calls(forked["attempt"]["id"])
    rows.sort(key=lambda r: (r["simTimeMs"], r["callIndex"]))
    prefix = [r for r in rows if r["origin"] == "replayed"]
    assert {(r["role"], r["actorId"]) for r in prefix} >= {("head", MEDIAL), ("resident", "P6")}
    assert len(prefix) >= 3
    assert len(village.calls) > live, "after the checkpoint the fork asks afresh"


# --------------------------------------------------------------- the switch
def test_the_llm_adapter_cannot_be_chosen_without_a_key():
    svc = SimulationService(store=Store(":memory:"), village=load_village(SYNTHETIC),
                            persona_path=PERSONAS)
    assert "llm" in svc.catalog()["adapters"]["unavailable"]
    with pytest.raises(ValueError):
        svc.create_attempt("policy-A-v1", DECK, RES, adapter="llm")


def test_a_model_the_provider_does_not_offer_stops_the_run_before_it_starts():
    village = Village()
    village.verify_models = lambda policy: ["fake-lite"]
    svc = SimulationService(store=Store(":memory:"), village=load_village(SYNTHETIC),
                            persona_path=PERSONAS, model_policy=POLICY, provider=village)
    with pytest.raises(ValueError) as exc:
        svc.create_attempt("policy-A-v1", DECK, RES, adapter="llm")
    assert "fake-lite" in str(exc.value)
    assert village.calls == []
