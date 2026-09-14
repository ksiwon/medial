"""Who is contacted, in what order: the retry comes first, then the strategy.

Two things pinned here, both found by running the review loop on real models
(2026-09-15):

* **``retryCount`` is a procedure under every contact order.** Before, only
  ``retry_then_clinic`` retried. A Change Set raising ``retryCount`` on the
  head-first start policy validated, was confirmed, and produced a log
  identical to its parent - so the comparison said "retrying made no
  difference" about a retry that never happened. Now the retry runs first, by
  phone, in code, for the rule head and the model head alike.
* **``relation_first`` asks only recorded relations, the head last.** P1's only
  recorded tie is the village head, so under this order P1's case goes to the
  head - and the decision says that is the record's doing, not the policy's.

    python -m pytest server/tests/simulation/test_contact_order.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.simulation.contracts import Channel, EventType  # noqa: E402
from app.simulation.decks.registry import POLICIES  # noqa: E402
from app.simulation.policies.rule_policies import MedialPolicy, PolicyContext  # noqa: E402
from app.simulation.runner import run_attempt  # noqa: E402
from app.simulation.village import load_village  # noqa: E402

from test_llm_village import POLICY as MODEL_POLICY  # noqa: E402
from test_llm_village import Village  # noqa: E402

SYNTHETIC = str(REPO_ROOT / "fixtures" / "synthetic" / "village.synthetic.json")
PERSONAS = str(REPO_ROOT / "fixtures" / "synthetic" / "personas.synthetic.json")
DECK = "deck-p1-no-response-v1"
RES = "assumed-resources-v1"


def _run(policy, adapter="rule", provider=None):
    return run_attempt("att-order", policy.id, DECK, RES, adapter=adapter, policy=policy,
                       village=load_village(SYNTHETIC), persona_path=PERSONAS,
                       environment_id="env-v3-fixed",
                       model_policy=MODEL_POLICY if adapter == "llm" else None,
                       provider=provider)


def _with(policy_id, **params):
    base = POLICIES[policy_id]
    return base.model_copy(update={"id": policy_id + "-test",
                                   "params": base.params.model_copy(update=params)})


def _sequence(result):
    out = []
    for e in result.events:
        if e.type is EventType.contact_attempted:
            out.append(("call", e.payload["channel"], e.payload.get("attemptNumber")))
        elif e.type is EventType.request_offered:
            out.append(("ask", e.payload["toActorId"]))
    return out


# ---------------------------------------------------- the retry comes first
def test_raising_retry_count_on_a_head_first_policy_changes_the_day():
    before = _run(_with("policy-IT-v0", retryCount=0))
    after = _run(_with("policy-IT-v0", retryCount=1))
    assert _sequence(before)[:2] == [("call", "home_device", 1), ("ask", "P6")]
    # One more call, by phone, before the head is asked.
    assert _sequence(after)[:3] == [("call", "home_device", 1), ("call", "phone", 2),
                                    ("ask", "P6")]
    ask_before = next(e for e in before.events if e.type is EventType.request_offered)
    ask_after = next(e for e in after.events if e.type is EventType.request_offered)
    assert ask_after.simTimeMs - ask_before.simTimeMs == 40 * 60_000


def test_every_contact_order_retries_first():
    for policy_id in ("policy-A-v1", "policy-C-v1", "policy-D-v1"):
        result = _run(_with(policy_id, retryCount=2))
        calls = [s for s in _sequence(result) if s[0] == "call"]
        first_ask = next(i for i, s in enumerate(_sequence(result)) if s[0] == "ask")
        assert [c[1] for c in calls[:3]] == ["home_device", "phone", "phone"], policy_id
        assert first_ask == 3, policy_id


def test_the_model_head_is_not_asked_whether_to_retry():
    village = Village(head_orders=[["P6"]])
    result = _run(_with("policy-A-v1", retryCount=1), adapter="llm", provider=village)
    decides = [p for role, p in village.calls if role == "head" and p["stage"] == "decide"]
    # The head's first decision comes after the retry, and knows it happened.
    assert decides and decides[0]["attemptNumber"] == 2
    assert decides[0]["policy"]["retriesAlreadyMade"] == 1
    assert "schedule_contact" not in decides[0]["allowedActions"]
    assert _sequence(result)[:3] == [("call", "home_device", 1), ("call", "phone", 2),
                                     ("ask", "P6")]


# ------------------------------------------------------- relation first
def test_p1s_only_recorded_tie_is_the_head_and_the_decision_says_so():
    result = _run(POLICIES["policy-D-v1"])
    asks = [s[1] for s in _sequence(result) if s[0] == "ask"]
    assert asks[0] == "P6"
    decided = next(e for e in result.events if e.type is EventType.medial_decided
                   and e.payload["chosen"] == "P6")
    assert "기록된 가까운 관계는 이장 한 사람뿐" in decided.payload["rationale"]


def test_relation_first_puts_recorded_ties_before_the_head_and_nobody_else():
    policy = MedialPolicy(POLICIES["policy-D-v1"])
    routines = {a: {} for a in ("P1", "P3", "P6", "P9", "P10", "P12")}
    ctx = PolicyContext(
        sim_time_ms=10 * 3_600_000, subject_id="P9", request_id="req-1", attempt_number=2,
        routines=routines, village_head_id="P6", horizon_ms=0,
        relations=[{"actorId": "P12", "kind": "ride", "reason": "Q1에서 태워 갔다"},
                   {"actorId": "P3", "kind": "ride", "reason": "Q5에서 태워 왔다"}])
    # Say everyone is home, so the order is only about the record.
    import app.simulation.policies.rule_policies as rp
    original = rp.routine_says_home
    rp.routine_says_home = lambda routine, at: True
    try:
        _decision, intents = policy.on_unanswered_checkin(ctx)
    finally:
        rp.routine_says_home = original
    order = [intents[0].payload["toActorId"], *intents[0].payload["fallbackOrder"]]
    assert order == ["P12", "P3", "P6"]


def test_the_model_head_may_not_ask_a_stranger_or_put_the_head_first_under_relation_first():
    village = Village(head_orders=[["P9"], ["P9"]])
    result = _run(POLICIES["policy-D-v1"], adapter="llm", provider=village)
    failure = next(e for e in result.events if e.type is EventType.medial_waiting
                   and e.payload.get("reason") == "adapter_error")
    assert "기록된 관계가 없다" in failure.payload["detail"]

    village = Village(head_orders=[["P6", "P9"], ["P6", "P9"]])
    result = _run(POLICIES["policy-D-v1"], adapter="llm", provider=village)
    failure = next(e for e in result.events if e.type is EventType.medial_waiting
                   and e.payload.get("reason") == "adapter_error")
    assert "마지막이어야 한다" in failure.payload["detail"]


def test_a_retry_is_a_phone_call():
    result = _run(POLICIES["policy-B-v1"])
    channels = [e.payload["channel"] for e in result.events
                if e.type is EventType.contact_attempted and e.actorId != "HC_NURSE"]
    assert channels == [Channel.home_device.value, Channel.phone.value, Channel.phone.value]


# ------------------------------------------------- an empty house, no lead
def _whereabouts_trace(result):
    out = []
    for e in result.events:
        if e.type is EventType.request_offered:
            out.append((e.payload.get("purpose", "check"), e.payload["toActorId"]))
        elif e.type is EventType.task_check_performed:
            out.append((e.actorId, e.payload["place"], e.payload["outcome"]))
    return out


def test_a_neighbour_finding_the_house_empty_sends_medial_to_the_head_for_where_to_look():
    result = _run(POLICIES["policy-C-v1"])
    trace = _whereabouts_trace(result)
    empty = trace.index(("P9", "HOME:P1", "subject_absent"))
    assert trace[empty + 1] == ("whereabouts", "P6")
    assert trace[empty + 2] == ("P6", "FARM", "subject_found_well")
    assert result.metrics["requests"]["resolved"] == 1
    decided = [e for e in result.events if e.type is EventType.medial_decided
               and e.payload["question"].startswith("자택에 없고")]
    assert decided and decided[0].payload["chosen"] == "P6"


def test_without_permission_to_ask_the_head_the_empty_house_is_where_it_ends():
    result = _run(_with("policy-C-v1", allowHeadContact=False))
    assert ("whereabouts", "P6") not in _whereabouts_trace(result)
    assert result.metrics["requests"]["unresolved"] == 1
    decided = next(e for e in result.events if e.type is EventType.medial_decided
                   and e.payload["question"].startswith("자택에 없고"))
    assert decided.payload["chosen"] is None
    assert "이장에게 묻지 않는다" in decided.payload["rationale"]


def test_the_head_who_already_went_is_not_asked_again():
    result = _run(POLICIES["policy-A-v1"])
    assert [t for t in _whereabouts_trace(result) if t[0] == "whereabouts"] == []
