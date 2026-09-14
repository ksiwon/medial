"""Regressions for the failures found in the 2026-09-10 implementation review.

Every test here reproduces something that actually went wrong (R01-R08 in
docs/research/IMPLEMENTATION_REVIEW_20260910.md), or locks in a boundary that
the review found being crossed. They run on the synthetic fixtures only.

    python server/tests/simulation/test_regressions.py
    python -m pytest server/tests/simulation -q
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))

from app.simulation.contracts import (  # noqa: E402
    HEALTH_STAFF,
    MEDIAL,
    RESEARCHER,
    EventType,
    PolicyParams,
    ProposalAction,
    ResourceRevision,
)
from app.simulation.decks.p1_no_response import CHECKIN_MS  # noqa: E402
from app.simulation.environment import FIXED_ENVIRONMENT_ID  # noqa: E402
from app.simulation.institution import Desk, ShiftExhausted  # noqa: E402
from app.simulation.persistence.store import AttemptExists, CommandConflict, Store  # noqa: E402
from app.simulation.persona import load_personas  # noqa: E402
from app.simulation.service import (  # noqa: E402
    SimulationService,
    UnsupportedPolicyField,
    build_comparison,
)
from app.simulation.transport import TransportBook  # noqa: E402
from app.simulation.village import load_village  # noqa: E402

SYNTHETIC = REPO_ROOT / "fixtures" / "synthetic" / "village.synthetic.json"
SYNTHETIC_PERSONAS = str(REPO_ROOT / "fixtures" / "synthetic" / "personas.synthetic.json")
DECK_ID = "deck-p1-no-response-v1"
RES_ID = "assumed-resources-v1"
T_DECK_ID = "deck-p9-transport-v1"
T_RES_ID = "assumed-resources-transport-v1"
MIN_MS = 60_000
HOUR_MS = 60 * MIN_MS

_village = None


def village():
    global _village
    if _village is None:
        _village = load_village(SYNTHETIC)
    return _village


def service(store: Store | None = None) -> SimulationService:
    """Scenario mechanics, on the recorded day.
    The day-to-day draw is switched off here. These tests ask whether a
    mechanism works given a situation; whether a given day produces that
    situation is a separate question with its own tests in test_day.py.
    """
    return SimulationService(store=store or Store(":memory:"), village=village(),
                             persona_path=SYNTHETIC_PERSONAS,
                             environment_id=FIXED_ENVIRONMENT_ID)


def temp_db() -> Path:
    return Path(tempfile.mkdtemp()) / "runs.sqlite3"


# ============================================================ R01 · research record
def test_restarting_never_rewrites_an_earlier_attempt():
    """The exact failure from the review, reproduced and then fixed.

    Before: ``itertools.count(1)`` restarted at 1 on every boot and
    ``INSERT OR REPLACE`` overwrote the earlier run, so creating policy A twice
    across a restart left one row whose label and seed had silently changed.
    """
    db = temp_db()
    first = service(Store(db))
    before = first.create_attempt("policy-A-v1", DECK_ID, RES_ID,
                                  label="before", seed=17)
    first_id = before["attempt"]["id"]
    first_events = first.events(first_id)
    first.store.close()

    second = service(Store(db))
    after = second.create_attempt("policy-A-v1", DECK_ID, RES_ID,
                                  label="after", seed=99)

    assert after["attempt"]["id"] != first_id, "restart must not reuse an id"
    stored = {r["attempt"]["id"]: r for r in second.store.list_attempts()}
    assert len(stored) == 2, "both runs must survive"
    assert stored[first_id]["attempt"]["label"] == "before"
    assert stored[first_id]["attempt"]["seed"] == 17
    assert stored[first_id]["metrics"] == before["metrics"]
    assert second.events(first_id) == first_events
    second.store.close()


def test_forking_after_a_restart_keeps_the_whole_lineage():
    db = temp_db()
    first = service(Store(db))
    parent_id = first.create_attempt("policy-A-v1", DECK_ID, RES_ID)["attempt"]["id"]
    parent_events = first.events(parent_id)
    parent_decisions = first.store.decisions(parent_id)
    first.store.close()

    second = service(Store(db))
    at_seq = next(e["seq"] for e in parent_events
                  if e["type"] == EventType.request_offered.value)
    child = second.fork_attempt(parent_id, at_seq, {"params": {"helperContactCap": 0}},
                                reason="재시작 후 분기")
    rerun = second.rerun_attempt(parent_id, {"params": {"retryCount": 1}},
                                 reason="재시작 후 재실행")

    assert child["attempt"]["parentId"] == parent_id
    assert rerun["attempt"]["parentId"] == parent_id
    assert second.events(parent_id) == parent_events, "the parent log is immutable"
    assert second.store.decisions(parent_id) == parent_decisions
    assert len({parent_id, child["attempt"]["id"], rerun["attempt"]["id"]}) == 3
    second.store.close()


def test_writing_the_same_attempt_id_twice_fails_and_leaves_nothing_partial():
    """A conflict must abort, not overwrite - and not leave orphan child rows."""
    svc = service()
    created = svc.create_attempt("policy-A-v1", DECK_ID, RES_ID)
    attempt_id = created["attempt"]["id"]
    result = svc._runs[attempt_id]
    policy = svc.policies[result.attempt.policyId]

    events_before = len(svc.events(attempt_id))
    decisions_before = len(svc.store.decisions(attempt_id))
    try:
        svc.store.save_run(result, policy, "fingerprint")
    except AttemptExists:
        assert len(svc.events(attempt_id)) == events_before
        assert len(svc.store.decisions(attempt_id)) == decisions_before
        return
    raise AssertionError("storing an existing attempt id must raise")


def test_the_same_command_id_with_different_arguments_is_a_conflict():
    """Idempotency and a client bug are different things (R08)."""
    svc = service()
    attempt_id = svc.create_attempt("policy-A-v1", DECK_ID, RES_ID)["attempt"]["id"]
    svc.command(attempt_id, "cmd-x", "seek", seq=4)
    assert svc.command(attempt_id, "cmd-x", "seek", seq=4)["deduplicated"] is True
    try:
        svc.command(attempt_id, "cmd-x", "seek", seq=9)
    except CommandConflict:
        assert svc.store.get_attempt(attempt_id)["attempt"]["cursorSeq"] == 4
        return
    raise AssertionError("reusing a commandId with other arguments must raise")


# ==================================================================== R05 · replay
def test_one_step_shows_one_event_even_when_ten_share_a_timestamp():
    """The review's R05: seq was converted to a time and back, so stepping onto
    the first of several events at 09:30 displayed all of them."""
    svc = service()
    attempt_id = svc.create_attempt("policy-A-v1", DECK_ID, RES_ID)["attempt"]["id"]
    events = svc.events(attempt_id)

    by_time: dict[int, list[int]] = {}
    for event in events:
        by_time.setdefault(event["simTimeMs"], []).append(event["seq"])
    crowded = max(by_time.values(), key=len)
    assert len(crowded) > 1, "this deck should produce simultaneous events"

    svc.command(attempt_id, "seek-0", "seek", seq=crowded[0] - 1)
    for index, seq in enumerate(crowded):
        state = svc.command(attempt_id, "step-%d" % index, "step")
        assert state["cursorSeq"] == seq
        snap = svc.snapshot(attempt_id, seq=seq)
        assert snap["cursorSeq"] == seq
        assert snap["atMs"] == events[seq - 1]["simTimeMs"]


def test_the_replay_cursor_survives_a_restart():
    db = temp_db()
    first = service(Store(db))
    attempt_id = first.create_attempt("policy-A-v1", DECK_ID, RES_ID)["attempt"]["id"]
    first.command(attempt_id, "seek-restart", "seek", seq=7)
    first.store.close()

    second = service(Store(db))
    assert second.store.get_attempt(attempt_id)["attempt"]["cursorSeq"] == 7
    assert second.snapshot(attempt_id, seq=7)["cursorSeq"] == 7
    second.store.close()


def test_reviews_are_marked_retrospective_rather_than_shown_at_0930():
    svc = service()
    attempt_id = svc.create_attempt("policy-A-v1", DECK_ID, RES_ID)["attempt"]["id"]
    reviews = svc.get_attempt(attempt_id)["reviews"]
    assert reviews
    for review in reviews:
        assert review["scope"] == "day_end_retrospective"


# ================================================= R06 · conditions that do something
def test_a_condition_the_engine_does_not_read_is_refused():
    svc = service()
    try:
        svc.create_policy("policy-A-v1", {"params": {"telepathy": True}},
                          reason="지원하지 않는 필드")
    except UnsupportedPolicyField as exc:
        assert "telepathy" in str(exc)
        return
    raise AssertionError("an unsupported policy field must be refused, not stored")


def test_the_policy_editor_records_before_and_after():
    svc = service()
    revision = svc.create_policy("policy-B-v1", {"params": {"retryCount": 4}},
                                 reason="재연락을 더 해 보면 어떻게 되는가")
    assert revision.parentId == "policy-B-v1"
    assert revision.params.retryCount == 4
    assert "재연락을 더 해 보면 어떻게 되는가" in revision.changes
    assert any("retryCount: 2 → 4" in c for c in revision.changes)
    # and it outlives the process
    assert any(p["id"] == revision.id for p in svc.store.list_policies())


def test_quiet_window_pushes_the_retry_and_shows_up_in_the_log():
    svc = service()
    base = svc.create_attempt("policy-B-v1", DECK_ID, RES_ID)["attempt"]["id"]
    quiet = svc.rerun_attempt(base, {"params": {"quietWindowMin": 90}},
                              reason="연락 간격 하한을 90분으로")["attempt"]["id"]

    def first_retry(attempt_id: str) -> int:
        return next(e["simTimeMs"] for e in svc.events(attempt_id)
                    if e["type"] == EventType.contact_attempted.value
                    and e["payload"].get("attemptNumber") == 2)

    assert first_retry(quiet) - first_retry(base) == 50 * MIN_MS


def test_escalation_after_a_deadline_overrides_the_strategy():
    """The deadline has to fire on its own, not only when something else asks.

    Before, ``escalateToInstitutionAfterMin`` was only consulted inside a
    decision that some other event triggered, so under ``head_first`` - where
    the only decision happens at 09:30 with zero minutes elapsed - it could
    never fire at all.
    """
    svc = service()
    base = svc.create_attempt("policy-A-v1", DECK_ID, RES_ID)
    base_id = base["attempt"]["id"]
    escalating = svc.rerun_attempt(
        base_id, {"params": {"escalateToInstitutionAfterMin": 5}},
        reason="접수 5분이 지나면 무조건 기관으로")
    child_id = escalating["attempt"]["id"]
    events = svc.events(child_id)
    types = {e["type"] for e in events}

    assert EventType.handoff_requested.value in types, \
        "escalateToInstitutionAfterMin must change what happens"
    # the head was asked at 09:30, before the deadline; the escalation is extra
    assert EventType.request_offered.value in types
    handoff = next(e for e in events
                   if e["type"] == EventType.handoff_requested.value)
    assert handoff["simTimeMs"] == CHECKIN_MS + 5 * MIN_MS

    assert base["metrics"]["institutionBurden"]["staffMinutes"] == 0
    assert escalating["metrics"]["institutionBurden"]["staffMinutes"] > 0


def test_a_dead_end_waits_for_the_escalation_deadline_instead_of_closing():
    """R06. Found in the browser: cap the helper contacts at 0 *and* set a 90
    minute escalation deadline, and the request was closed as unresolved at 09:30
    - before the deadline could fire. The condition was on screen, was read, and
    still could not take effect in the one case it exists for: nobody local could
    go. A dead end now leaves the case open with MEDial until the deadline."""
    svc = service()
    base_id = svc.create_attempt("policy-A-v1", DECK_ID, RES_ID)["attempt"]["id"]
    child = svc.rerun_attempt(
        base_id,
        {"params": {"helperContactCap": 0, "escalateToInstitutionAfterMin": 90}},
        reason="갈 사람이 없을 때 기한이 실제로 작동하는지")
    events = svc.events(child["attempt"]["id"])
    types = [e["type"] for e in events]

    declined = next(e for e in events if e["type"] == EventType.request_declined.value)
    # ``rule`` is the stable key; ``reason`` is the sentence a reader sees. The
    # two are kept apart so the screen can show plain words without the log
    # losing a thing to match on.
    assert declined["payload"]["rule"] == "asked_too_often"
    assert declined["payload"]["reason"] == "오늘 이미 여러 번 불렸다."

    # the decline must not close the case while the deadline is still ahead
    waiting = [e for e in events
               if e["type"] == EventType.medial_waiting.value
               and e["payload"].get("reason") == "awaiting_escalation_deadline"]
    assert waiting, "a dead end before the deadline must wait, not close"
    assert waiting[0]["payload"]["untilMs"] == CHECKIN_MS + 90 * MIN_MS

    assert EventType.handoff_requested.value in types,         "the deadline must still hand the case to the institution"
    handoff = next(e for e in events
                   if e["type"] == EventType.handoff_requested.value)
    assert handoff["simTimeMs"] == CHECKIN_MS + 90 * MIN_MS
    # and the unresolved close, if any, comes after the deadline - never before
    for event in events:
        if event["type"] == EventType.need_unresolved.value:
            assert event["simTimeMs"] >= handoff["simTimeMs"]

    assert child["metrics"]["institutionBurden"]["staffMinutes"] > 0


def test_a_dead_end_without_a_deadline_still_closes():
    """The waiting rule must not turn every dead end into an open case."""
    svc = service()
    base_id = svc.create_attempt("policy-A-v1", DECK_ID, RES_ID)["attempt"]["id"]
    child = svc.rerun_attempt(base_id, {"params": {"helperContactCap": 0}},
                              reason="기한 없이 갈 사람만 없을 때")
    events = svc.events(child["attempt"]["id"])
    unresolved = [e for e in events if e["type"] == EventType.need_unresolved.value]
    assert unresolved, "with no deadline a dead end is still an unresolved case"
    assert child["metrics"]["requests"]["unresolved"] == 1


def test_disclosure_setting_changes_what_the_centre_can_do():
    """R04/R06. ``named`` hands over the consented routine; ``minimal`` does not,
    and the centre then cannot pick a call-back hour."""
    svc = service()
    named = svc.create_attempt("policy-B-v1", DECK_ID, RES_ID)["attempt"]["id"]
    minimal = svc.rerun_attempt(named, {"params": {"disclosure": "minimal"}},
                                reason="공개를 최소로")["attempt"]["id"]

    def review(attempt_id: str) -> dict:
        return next(e["payload"] for e in svc.events(attempt_id)
                    if e["type"] == EventType.institution_review_completed.value)

    assert review(named)["routineDisclosed"] is True
    assert review(named)["outcome"] == "call_when_routine_says_home"
    assert review(minimal)["routineDisclosed"] is False
    assert review(minimal)["outcome"] == "call_at_next_free_slot"

    named_fields = svc.get_attempt(named)["metrics"]["disclosure"]
    minimal_fields = svc.get_attempt(minimal)["metrics"]["disclosure"]
    assert (named_fields["institution"]["fieldCount"]
            > minimal_fields["institution"]["fieldCount"])


def test_comparison_refuses_to_call_a_mismatched_pair_controlled():
    svc = service()
    a = svc.create_attempt("policy-A-v1", DECK_ID, RES_ID)["attempt"]["id"]
    b = svc.create_attempt("policy-B-v1", DECK_ID, RES_ID)["attempt"]["id"]
    same = build_comparison(svc, [a, b])
    assert same["controlled"] is True
    assert same["differingInputs"] == []
    fields = {row["field"] for row in same["policyDifference"]}
    assert "contactStrategy" in fields and "retryCount" in fields

    t = svc.create_attempt("policy-T-A-v1", T_DECK_ID, T_RES_ID)["attempt"]["id"]
    mixed = build_comparison(svc, [a, t])
    assert mixed["controlled"] is False
    assert "deck" in mixed["differingInputs"]
    assert "통제 비교가 아니다" in mixed["claim"]


# ============================================== R07 · institution time and capacity
def test_a_visit_bills_travel_one_way_twice_and_stays_inside_the_shift():
    resources = ResourceRevision(
        id="t", label="t", staffCount=1, shiftStartMs=9 * HOUR_MS,
        shiftEndMs=18 * HOUR_MS, reviewMinutes=20, callMinutes=5,
        visitTravelMinutes=25, visitMinutes=20, initialQueueDepth=0)
    desk = Desk(resources)
    visit = desk.schedule("visit", "r1", 10 * HOUR_MS,
                          (25 * 2 + 20) * MIN_MS)
    assert visit.end_ms - visit.start_ms == 70 * MIN_MS
    assert visit.end_ms <= resources.shiftEndMs

    report = desk.report()
    assert report["staffMinutes"] == 70.0
    assert "편도" in report["travelBasis"]


def test_work_that_does_not_fit_the_shift_is_refused_not_absorbed():
    resources = ResourceRevision(
        id="t", label="t", staffCount=1, shiftStartMs=9 * HOUR_MS,
        shiftEndMs=18 * HOUR_MS, reviewMinutes=20, callMinutes=5,
        visitTravelMinutes=25, visitMinutes=20, initialQueueDepth=0)
    desk = Desk(resources)
    try:
        desk.schedule("visit", "r1", 17 * HOUR_MS + 30 * MIN_MS, 70 * MIN_MS)
    except ShiftExhausted:
        return
    raise AssertionError("the centre cannot work past the end of its shift")


def test_staff_count_actually_changes_the_queue():
    """``staffCount`` was declared and never read."""
    def backlog_end(staff: int) -> int:
        resources = ResourceRevision(
            id="t", label="t", staffCount=staff, shiftStartMs=9 * HOUR_MS,
            shiftEndMs=18 * HOUR_MS, reviewMinutes=20, initialQueueDepth=4)
        desk = Desk(resources)
        return desk.schedule("review", "r", 9 * HOUR_MS, 20 * MIN_MS).start_ms

    assert backlog_end(1) == 9 * HOUR_MS + 80 * MIN_MS
    assert backlog_end(2) == 9 * HOUR_MS + 40 * MIN_MS


def test_the_run_reports_the_desk_schedule_rather_than_a_product():
    svc = service()
    attempt_id = svc.create_attempt("policy-B-v1", DECK_ID, RES_ID)["attempt"]["id"]
    burden = svc.get_attempt(attempt_id)["metrics"]["institutionBurden"]
    assert burden["items"], "every piece of institution work is itemised"
    kinds = {i["kind"] for i in burden["items"]}
    assert "review" in kinds and "queued_backlog" in kinds
    for item in burden["items"]:
        assert item["startMs"] >= burden["shiftStartMs"]
        assert item["endMs"] <= burden["shiftEndMs"]
    # the pre-existing backlog is somebody else's work and is counted apart
    assert burden["preexistingBacklogMinutes"] > 0
    assert burden["staffMinutes"] > 0


# ============================================================ R04 · what MEDial holds
def test_medial_holds_home_or_away_and_the_head_holds_places():
    from app.simulation.decks.p1_no_response import DECK, POLICY_A, RESOURCES
    from app.simulation.engine import Engine
    from app.simulation.runner import build_attempt

    attempt = build_attempt("att-routines", "routines", POLICY_A, DECK, RESOURCES,
                            village())
    engine = Engine(attempt, POLICY_A, DECK, RESOURCES, village())

    medial = engine.routines[MEDIAL]["P1"]
    assert medial["granularity"] == "home_or_away"
    assert all(w["place"] is None for w in medial["windows"])
    assert medial["consent"] == "assumed", "the source records no such consent"
    assert medial["consentBasis"]

    head = engine.routines["P6"]["P1"]
    assert head["granularity"] == "place_level"
    assert any(w["place"] == "FARM" for w in head["windows"])
    assert "P6" not in engine.routines["P6"], "he does not hold a routine about himself"
    assert engine.routines[HEALTH_STAFF] == {}, "the centre starts knowing nothing"


def test_a_persons_review_never_cites_what_they_could_not_know():
    svc = service()
    attempt_id = svc.create_attempt("policy-B-v1", DECK_ID, RES_ID)["attempt"]["id"]
    detail = svc.get_attempt(attempt_id)
    events = {e["id"]: e for e in svc.events(attempt_id)}

    for review in detail["reviews"]:
        for event_id in review["experiencedEventIds"]:
            assert review["actorId"] in events[event_id]["visibility"]
        blob = json.dumps(review, ensure_ascii=False)
        if review["actorId"] != "P1":
            assert "공개 동의된 평소 일과" not in blob, \
                "%s cannot know what was disclosed about somebody else" % review["actorId"]


def test_the_llm_prompt_cites_resolvable_observation_ids():
    from app.simulation.agents.llm import build_prompt_payload
    from app.simulation.contracts import Observation
    from app.simulation.observations import ActorView

    obs = Observation(id="obs-1", attemptId="a", actorId="P6", simTimeMs=0,
                      kind="request.offered", sourceEventId="ev-1")
    view = ActorView(actor_id="P6", sim_time_ms=0, observations=[obs])
    payload = build_prompt_payload(view, [ProposalAction.accept])
    assert payload["observations"][0]["id"] == "obs-1"
    assert "usedObservationIds" in payload["responseSchema"]


# ================================================================ R08 · validation
def test_a_proposal_claiming_to_be_someone_else_is_rejected():
    from app.simulation.contracts import ProposalRejection, validate_proposal
    from app.simulation.agents.base import ProposalFactory

    factory = ProposalFactory("att-1")
    proposal = factory.make("P4", 0, ProposalAction.accept, requestId="req-1")
    try:
        validate_proposal(proposal, actor_id="P6", attempt_id="att-1",
                          allowed={ProposalAction.accept},
                          open_request_ids={"req-1"}, known_observation_ids=set())
    except ProposalRejection as exc:
        assert "P4" in str(exc)
    else:
        raise AssertionError("an actor id mismatch must be rejected")

    cited = factory.make("P6", 0, ProposalAction.accept, requestId="req-1",
                         observationIds=["obs-999"])
    try:
        validate_proposal(cited, actor_id="P6", attempt_id="att-1",
                          allowed={ProposalAction.accept},
                          open_request_ids={"req-1"}, known_observation_ids=set())
    except ProposalRejection as exc:
        assert "obs-999" in str(exc)
        return
    raise AssertionError("citing an unseen observation must be rejected")


def test_a_payload_with_the_wrong_value_type_does_not_validate():
    from pydantic import ValidationError

    from app.simulation.contracts import DomainEvent

    try:
        DomainEvent(id="x", attemptId="a", seq=1, simTimeMs=0,
                    type=EventType.task_travel_started, actorId="P6",
                    correlationId="c", visibility=[MEDIAL],
                    payload={"requestId": "r", "from": "A", "to": "B", "mode": "walk",
                             "distanceM": 100, "durationMs": "25분"})
    except ValidationError:
        return
    raise AssertionError("durationMs='25분' should not validate")


# ==================================================================== T004 · rides
def test_a_ride_is_arranged_rather_than_assumed():
    """P9's baseline keeps him at home because the ride is a coordination
    outcome. The need survives; the ride has to be produced again."""
    svc = service()
    attempt_id = svc.create_attempt("policy-T-A-v1", T_DECK_ID,
                                    T_RES_ID)["attempt"]["id"]
    events = svc.events(attempt_id)
    types = [e["type"] for e in events]

    assert EventType.transport_need_raised.value in types
    assert EventType.transport_reservation_made.value in types
    assert EventType.transport_pickup.value in types
    assert EventType.transport_dropoff.value in types

    resolved = [e for e in events if e["type"] == EventType.need_resolved.value]
    assert resolved and all(e["payload"]["outcome"] == "ride_completed"
                            for e in resolved)
    # arriving is not a medical result
    assert "진료의 결과가 아니다" in next(
        e["payload"]["note"] for e in events
        if e["type"] == EventType.transport_dropoff.value)

    # the need is P9's own, and the baseline still has him home all day
    baseline = svc.get_attempt(attempt_id)["timeline"]["actors"]["P9"]["baseline"]
    assert all(s["origin"] == "baseline" for s in baseline)
    assert {s.get("place") for s in baseline} == {"HOME:P9"}
    realized = svc.get_attempt(attempt_id)["timeline"]["actors"]["P9"]["realized"]
    assert any(s["origin"] == "task" for s in realized), "the ride changed his day"


def test_a_decision_states_the_evidence_of_its_own_need():
    """Found in the browser: a transport decision recorded 'P9에게 0회 연락했고
    응답이 없다' as the fact it rested on. Nobody had failed to answer - the person
    needs a ride. A decision record that misstates its evidence is worse than one
    with none, because it is the artefact the research reads back."""
    svc = service()
    ride = svc.create_attempt("policy-T-A-v1", "deck-p9-transport-v1",
                              "assumed-resources-transport-v1")
    facts = " ".join(f for d in ride["decisions"] for f in d["knownFacts"])
    assert "응답이 없다" not in facts, "a ride request is not an unanswered call"
    assert "이동할 일이 있다" in facts
    assert "누가 운전할 수 있는지" in facts, "the unknowns must travel with the decision"

    checkin = svc.create_attempt("policy-A-v1", DECK_ID, RES_ID)
    checkin_facts = " ".join(f for d in checkin["decisions"] for f in d["knownFacts"])
    assert "응답이 없다" in checkin_facts, "the check-in wording must not regress"


def test_a_shared_ride_puts_both_people_in_the_same_vehicle():
    """Found in the browser: for one physical trip the driver's leg was
    ``offmap`` and the passenger's was ``drive``, so the map put them in two
    different places for the same thirty minutes and the car never showed a
    passenger in it."""
    svc = service()
    ride = svc.create_attempt("policy-T-A-v1", "deck-p9-transport-v1",
                              "assumed-resources-transport-v1")
    actors = ride["timeline"]["actors"]
    pickup = next(e for e in svc.events(ride["attempt"]["id"])
                  if e["type"] == EventType.transport_pickup.value)
    driver, rider = pickup["payload"]["driverId"], pickup["payload"]["riderId"]

    def leg_at(actor_id, at_ms):
        return next(s for s in actors[actor_id]["realized"]
                    if s["startMs"] <= at_ms < s["endMs"] and s["kind"] == "travel")

    during = pickup["simTimeMs"] + MIN_MS
    driver_leg = leg_at(driver, during)
    rider_leg = leg_at(rider, during)

    assert driver_leg["mode"] == rider_leg["mode"],         "one trip, one mode: a passenger travels however the car travels"
    assert driver_leg["toPlace"] == rider_leg["toPlace"]
    assert rider in driver_leg["riders"], "the vehicle has to know who is aboard"
    assert rider_leg["riders"] == [], "a passenger is not carrying anyone"


def test_the_way_home_still_shows_who_is_in_the_car():
    """Reported from the browser: the outbound leg drew a passenger in the car
    and the return leg drew an empty one, while the reservation and the events
    both said somebody was being driven home.

    Two things were wrong. The return leg never recorded its rider, and the
    *same* Segment object was handed to both the driver and the passenger, so
    they shared one ``riders`` list."""
    svc = service()
    ride = svc.create_attempt("policy-T-A-v1", T_DECK_ID, T_RES_ID)
    actors = ride["timeline"]["actors"]
    events = svc.events(ride["attempt"]["id"])

    home = [e for e in events
            if e["type"] == EventType.transport_dropoff.value
            and e["payload"].get("leg") == "return"]
    assert home, "귀가 하차 사건이 있어야 한다"

    for dropoff in home:
        driver = dropoff["payload"]["driverId"]
        rider = dropoff["payload"]["riderId"]
        during = dropoff["simTimeMs"] - MIN_MS

        def leg_at(actor_id, at_ms):
            return next(s for s in actors[actor_id]["realized"]
                        if s["startMs"] <= at_ms < s["endMs"] and s["kind"] == "travel")

        driver_leg = leg_at(driver, during)
        rider_leg = leg_at(rider, during)
        assert rider in driver_leg["riders"],             "귀가 구간에서도 차량이 탑승자를 기록해야 한다"
        assert rider_leg["riders"] == [], "탑승자가 자기 자신을 태우고 있으면 안 된다"
        assert driver_leg["toPlace"] == rider_leg["toPlace"]
        assert driver_leg["mode"] == rider_leg["mode"]


def test_copying_a_segment_does_not_share_its_passenger_list():
    from app.simulation.world import Segment

    original = Segment(0, 10, "travel", "task", "동승", riders=["P9"])
    copy = original.clone(riders=[])
    copy.riders.append("P11")
    assert original.riders == ["P9"], "복사본이 원본의 탑승자 목록을 건드렸다"


def test_a_second_request_conflicts_instead_of_double_booking():
    svc = service()
    attempt_id = svc.create_attempt("policy-T-A-v1", T_DECK_ID,
                                    T_RES_ID)["attempt"]["id"]
    events = svc.events(attempt_id)
    conflicts = [e for e in events
                 if e["type"] == EventType.transport_conflict_detected.value]
    assert conflicts, "the injected second request must hit the first driver"
    assert conflicts[0]["payload"]["reason"] == "driver_double_booked"
    assert conflicts[0]["payload"]["conflictWith"]

    # and the second rider is still served, by somebody else
    made = [e for e in events
            if e["type"] == EventType.transport_reservation_made.value]
    assert len({e["payload"]["driverId"] for e in made}) == 2
    assert len({e["payload"]["riderId"] for e in made}) == 2


def test_nobody_teleports_into_a_pickup():
    svc = service()
    attempt_id = svc.create_attempt("policy-T-A-v1", T_DECK_ID,
                                    T_RES_ID)["attempt"]["id"]
    timeline = svc.get_attempt(attempt_id)["timeline"]
    for entry in timeline["actors"].values():
        for previous, current in zip(entry["realized"], entry["realized"][1:]):
            assert previous["endMs"] <= current["startMs"]
            if previous.get("toPlace") and current.get("fromPlace"):
                assert previous["toPlace"] == current["fromPlace"] or \
                    current["kind"] != "travel"


def test_a_cancelled_reservation_gives_the_seat_back():
    book = TransportBook(seat_assumption="테스트 가정", seats_per_vehicle=1)
    first = book.hold("req-1", "P3", "P9", 0, "HOME:P9", "TOWN")
    assert book.conflicts("P3", "P4", 10 * MIN_MS, 30 * MIN_MS, "MIGA") is not None
    book.cancel(first.id)
    assert book.conflicts("P3", "P4", 10 * MIN_MS, 30 * MIN_MS, "MIGA") is None
    assert book.held_for("P3") == []


def test_a_rider_who_is_not_there_cancels_rather_than_rides():
    """A held seat is not a person in a car."""
    from app.simulation.contracts import (
        Channel,
        ContactStrategy,
        PolicyRevision,
        ScenarioDeck,
        ScenarioEvent,
    )
    from app.simulation.decks.p9_transport import RESOURCES_T
    from app.simulation.engine import Engine
    from app.simulation.runner import build_attempt

    # P1 is out in the field from 09:00; a ride booked to leave his house at
    # 09:30 finds nobody there.
    deck = ScenarioDeck(
        id="deck-noshow-test", label="픽업 불발", classification="stress_test",
        horizonMs=20 * HOUR_MS,
        assumptions=["테스트용 deck이다."],
        events=[ScenarioEvent(
            id="exo-noshow", simTimeMs=9 * HOUR_MS + 30 * MIN_MS,
            type=EventType.transport_need_raised, subjectId="P1",
            initiallyVisibleTo=[MEDIAL, "P1"],
            payload={"requestId": "req-P1-transport", "subjectId": "P1",
                     "destination": "TOWN", "need": "transport",
                     "departByMs": 9 * HOUR_MS + 30 * MIN_MS,
                     "returnAfterMin": 60, "purpose": "테스트"})])
    policy = PolicyRevision(
        id="policy-noshow", parentId=None, coreItem="테스트", label="테스트",
        contactStrategy=ContactStrategy.head_first,
        params=PolicyParams(rideCandidateOrder="closest_first", maxRideDetourMin=60))

    from app.simulation.runner import personas as compiled
    profiles, _ = compiled(SYNTHETIC_PERSONAS)
    attempt = build_attempt("att-noshow", "no show", policy, deck, RESOURCES_T,
                            village())
    engine = Engine(attempt, policy, deck, RESOURCES_T, village(), personas=profiles)
    result = engine.run()

    cancelled = [e for e in result.events
                 if e.type is EventType.transport_reservation_cancelled]
    assert cancelled, "the ride must be cancelled, not silently completed"
    assert cancelled[0].payload["reason"] == "rider_not_at_pickup"
    assert not [e for e in result.events if e.type is EventType.transport_dropoff]
    assert engine.book.held_for(cancelled[0].payload["driverId"]) == []
    assert result.metrics["transport"]["cancelled"] == 1
    assert result.metrics["transport"]["ridesCompleted"] == 0


def test_the_rides_metric_shows_its_denominator():
    svc = service()
    attempt_id = svc.create_attempt("policy-T-A-v1", T_DECK_ID,
                                    T_RES_ID)["attempt"]["id"]
    transport = svc.get_attempt(attempt_id)["metrics"]["transport"]
    assert transport["needsRaised"] == 2
    assert transport["peopleAsked"] >= transport["reservationsHeld"]
    assert transport["ridesCompleted"] <= transport["reservationsHeld"]
    assert "원자료에 없다" in transport["seatAssumption"]


def test_the_two_transport_policies_really_differ():
    svc = service()
    a = svc.create_attempt("policy-T-A-v1", T_DECK_ID, T_RES_ID)["attempt"]["id"]
    b = svc.create_attempt("policy-T-B-v1", T_DECK_ID, T_RES_ID)["attempt"]["id"]
    report = build_comparison(svc, [a, b])
    assert report["controlled"] is True
    fields = {row["field"] for row in report["policyDifference"]}
    assert fields >= {"rideCandidateOrder", "maxRideDetourMin"}
    asked = {row["attemptId"]: row["transport"]["peopleAsked"]
             for row in report["outcomeDifference"]}
    assert asked[a] != asked[b], "a tighter detour budget must cost more asking"


# ================================================================== personas
def test_persona_compiler_keeps_pointers_and_refuses_to_invent():
    profiles, provenance = load_personas(SYNTHETIC_PERSONAS)
    assert provenance["dataSource"] == "synthetic"
    assert len(profiles) == 12

    for profile in profiles.values():
        assert profile.evidence, "every profile must carry its evidence"
        for card in profile.evidence:
            assert card.pointer.startswith("/")
            assert card.kind in ("fact", "interpretation", "assumption", "unknown")
        # the seat count the ride flow depends on is never invented
        assert profile.seatCapacity is None
        assert "차량 좌석 수" in profile.unknowns

    blob = json.dumps([p.model_dump() for p in profiles.values()], ensure_ascii=False)
    raw = json.loads(Path(SYNTHETIC_PERSONAS).read_text(encoding="utf-8"))
    for person in raw["페르소나"]:
        assert person["이름"] not in blob, "names must not reach the compiled profile"
        assert person["system_prompt"] not in blob
        for quote in person["대표_발언"]:
            assert quote not in blob


def test_the_joint_interview_and_the_missing_one_survive_compilation():
    profiles, provenance = load_personas(SYNTHETIC_PERSONAS)
    assert provenance["jointInterview"] == ["P10", "P11"]
    assert provenance["noInterview"] == ["P12"]

    for pid in ("P10", "P11"):
        assert profiles[pid].interviewBasis == "joint_interview"
        assert all(c.confidence != "high" for c in profiles[pid].evidence)
    assert profiles["P12"].interviewBasis == "none"
    assert all(c.confidence == "low" for c in profiles["P12"].evidence)
    assert "본인 확인(인터뷰 없음)" in profiles["P12"].unknowns


def test_a_decline_carries_the_evidence_it_came_from():
    svc = service()
    attempt_id = svc.create_attempt("policy-T-B-v1", T_DECK_ID,
                                    T_RES_ID)["attempt"]["id"]
    declines = [e for e in svc.events(attempt_id)
                if e["type"] == EventType.request_declined.value]
    assert declines
    for event in declines:
        assert event["payload"]["evidenceRefs"], \
            "a rule that speaks for a resident must say what it read"
        assert event["payload"]["rule"] in (
            "does_not_drive", "driving_status_unknown", "detour_too_long",
            "cannot_leave_post", "no_route",
            "asked_too_often", "persona_condition", "too_far")


def test_persona_provenance_travels_with_the_attempt():
    svc = service()
    attempt = svc.create_attempt("policy-A-v1", DECK_ID, RES_ID)
    assert attempt["attempt"]["inputHashes"]["personaSource"] == "synthetic"
    assert attempt["attempt"]["personaRevisionId"].startswith("persona-synthetic-")


# ==================================================================== findings
def test_a_finding_links_a_comparison_to_the_next_attempt():
    """Doc 05's loop: condition → decision → outcome → finding → next condition."""
    svc = service()
    a = svc.create_attempt("policy-A-v1", DECK_ID, RES_ID)["attempt"]["id"]
    b = svc.create_attempt("policy-B-v1", DECK_ID, RES_ID)["attempt"]["id"]
    finding = svc.create_finding(
        core_item="응답이 없는 안부 확인을 누구의 시간으로 해결할 것인가",
        compared=[a, b],
        observation="B는 대기가 길고 공개 항목이 많다",
        interpretation="기관 경로는 시간과 공개를 함께 늘린다",
        next_change="이웃 연락 상한을 0으로 두고 다시 본다",
        from_policy_id="policy-A-v1")
    child = svc.apply_finding(finding["id"], a, {"params": {"helperContactCap": 0}})

    stored = {f["id"]: f for f in svc.list_findings()}[finding["id"]]
    assert stored["resultingAttemptId"] == child["attempt"]["id"]
    assert stored["resultingPolicyId"] == child["attempt"]["policyId"]
    assert child["attempt"]["lineage"] == "rerun"
    assert finding["id"] in child["policy"]["changes"][0]


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = []
    for test in tests:
        try:
            test()
            print("  ok   %s" % test.__name__)
        except Exception as exc:  # noqa: BLE001
            failed.append((test.__name__, exc))
            print("  FAIL %s: %s" % (test.__name__, exc))
    print("\n%d/%d passed" % (len(tests) - len(failed), len(tests)))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
