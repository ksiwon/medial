"""Verification for the first vertical slice.

Runnable two ways:

    python server/tests/simulation/test_simulation.py
    python -m pytest server/tests/simulation -q

Every test uses the *synthetic* village fixture, so nothing here depends on the
interview-derived data in local-data/.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))

from app.simulation.agents.base import AdapterError, ProposalFactory  # noqa: E402
from app.simulation.agents.llm import LlmAdapter, build_prompt_payload  # noqa: E402
from app.simulation.contracts import (  # noqa: E402
    HEALTH_STAFF,
    MEDIAL,
    RESEARCHER,
    WORLD_TRUTH_EVENTS,
    EventType,
    ProposalAction,
)
from app.simulation.decks.p1_no_response import CHECKIN_MS, DECK  # noqa: E402
from app.simulation.environment import FIXED_ENVIRONMENT_ID  # noqa: E402
from app.simulation.observations import ActorView, ObservationLeak, visible_to  # noqa: E402
from app.simulation.persistence.store import Store  # noqa: E402
from app.simulation.runner import log_fingerprint, run_attempt  # noqa: E402
from app.simulation.service import SimulationService, build_comparison  # noqa: E402
from app.simulation.village import load_village  # noqa: E402

SYNTHETIC = REPO_ROOT / "fixtures" / "synthetic" / "village.synthetic.json"
#: Personas too: whether the git-ignored interview pack happens to exist on this
#: machine must not change what the tests assert.
SYNTHETIC_PERSONAS = str(REPO_ROOT / "fixtures" / "synthetic" / "personas.synthetic.json")
DECK_ID = "deck-p1-no-response-v1"
RES_ID = "assumed-resources-v1"
TRANSPORT_DECK_ID = "deck-p9-transport-v1"
TRANSPORT_RES_ID = "assumed-resources-transport-v1"
MIN_MS = 60_000

_village = None


def village():
    global _village
    if _village is None:
        _village = load_village(SYNTHETIC)
    return _village


def run(policy_id: str, attempt_id: str | None = None, adapter: str = "rule",
        script=None, deck_id: str = DECK_ID, resource_id: str = RES_ID,
        environment_id: str = FIXED_ENVIRONMENT_ID):
    """Scenario mechanics run on the recorded day, not a drawn one.

    These tests ask whether the engine does the right thing given a situation -
    P1 out in the field at 09:30, the centre reaching him once he is home. The
    day-to-day draw is a separate question with its own tests, and letting it
    run here would fail these for the wrong reason on some seeds.
    """
    return run_attempt(attempt_id or ("att-" + policy_id), policy_id, deck_id,
                       resource_id, village=village(), adapter=adapter, script=script,
                       persona_path=SYNTHETIC_PERSONAS, environment_id=environment_id)


def service(store: Store | None = None) -> SimulationService:
    """Scenario mechanics, on the recorded day.
    The day-to-day draw is switched off here. These tests ask whether a
    mechanism works given a situation; whether a given day produces that
    situation is a separate question with its own tests in test_day.py.
    """
    return SimulationService(store=store or Store(":memory:"), village=village(),
                             persona_path=SYNTHETIC_PERSONAS,
                             environment_id=FIXED_ENVIRONMENT_ID)


# ---------------------------------------------------------------- data import
def test_baseline_excludes_source_quest_outcomes():
    """P3, P9 and P12 must not start the experiment already carrying the original
    day pickups: doc 02 says copying them makes every policy comparison void."""
    by_id = {r["id"]: r for r in village().residents}
    for actor_id in ("P3", "P9", "P12"):
        overlay = by_id[actor_id]["plan"]["overlay"]
        assert overlay, "%s should have quest steps separated out" % actor_id
        for step in overlay:
            assert step["provenance"] == "source-quest-outcome"
        for step in by_id[actor_id]["plan"]["baseline"]:
            assert step["provenance"] == "source-baseline"

    # P9's whole trip was a coordination outcome, so the baseline keeps him home.
    assert [s["target"] for s in by_id["P9"]["plan"]["baseline"]] == ["HOME"]
    # And no baseline step is a ride or a pickup.
    for resident in village().residents:
        for step in resident["plan"]["baseline"]:
            assert step["targetKind"] == "place"


def test_recomputed_times_are_labelled():
    by_id = {r["id"]: r for r in village().residents}
    p3_home = [s for s in by_id["P3"]["plan"]["baseline"] if s["target"] == "HOME"][-1]
    assert p3_home["timeProvenance"] == "computed"


# ------------------------------------------------------------- geometry (DI-001)
def test_long_axis_is_north_south_not_east_west():
    """The analysis documents said the 1.11 km span was east-west. It is not.

    Locked here so the corrected wording cannot quietly regress: the registry
    measures the axis rather than restating a remembered direction.
    """
    checks = village().geometry["orientationChecks"]
    assert checks["longAxis"] == "north-south"
    assert checks["northSouthExtentM"] > checks["eastWestExtentM"] * 2

    axis = checks["pairs"]["P9자택→미가식당"]
    # bearing 0 = north; the whole-village axis must sit within a sector of north
    assert axis["bearingDeg"] < 30 or axis["bearingDeg"] > 330, axis
    assert axis["compass"].startswith("북")

    assert len(checks["crossChecks"]) >= 3
    # The coastal cross-checks only mean something on the real geography; they
    # are asserted in test_real_registry_matches_the_source_prose.


def test_data_issues_carry_a_status():
    issues = {i["id"]: i for i in village().data_issues}
    assert issues, "the importer should record what it could not settle"
    for issue in issues.values():
        assert issue["status"] in ("open", "resolved")
    assert issues["DI-001"]["status"] == "resolved"


# --------------------------------------------------------- road graph (DI-007)
def test_road_graph_invents_no_road():
    """Merging the named polylines must add no segment the source never drew."""
    data = json.loads(SYNTHETIC.read_text(encoding="utf-8"))

    def key(pt):
        return "%.1f,%.1f" % (round(pt[0], 1), round(pt[1], 1))

    source_pairs = set()
    for line in list(data["roads"].values()) + [data["patrol"]]:
        for a, b in zip(line, line[1:]):
            ka, kb = key(a), key(b)
            if ka != kb:
                source_pairs.add(tuple(sorted((ka, kb))))

    graph_pairs = set()
    for a, neighbours in data["roadGraph"]["adjacency"].items():
        for b, _ in neighbours:
            graph_pairs.add(tuple(sorted((a, b))))

    assert graph_pairs - source_pairs == set()
    provenance = data["roadGraphProvenance"]
    assert provenance["allEdgesFromSourcePolylines"] is True
    assert provenance["edgeCount"] == len(graph_pairs)


def test_both_route_distances_are_kept_and_never_averaged():
    data = json.loads(SYNTHETIC.read_text(encoding="utf-8"))
    table = data["namedRouteDistances"]
    assert table
    for name, row in table.items():
        assert set(row) == {"sourceM", "graphM", "deltaM"}
        # the graph may cut a corner the source route did not take, but it can
        # never be longer: that would mean a segment went missing.
        assert row["graphM"] <= row["sourceM"] + 0.5, name
        assert abs(row["deltaM"] - (row["sourceM"] - row["graphM"])) < 0.2


def test_travel_events_say_which_distance_they_report():
    result = run("policy-A-v1", "att-basis")
    legs = [e for e in result.events if e.type is EventType.task_travel_started]
    assert legs
    for leg in legs:
        assert leg.payload["distanceBasis"] == "road-graph-shortest-path"


def test_stale_registry_is_refused_with_a_fixable_message():
    """An older registry is missing blocks the map needs. Failing at load time
    with the command that fixes it beats a blank screen two layers away."""
    import tempfile

    from app.simulation.village import StaleRegistryError

    stale = json.loads(SYNTHETIC.read_text(encoding="utf-8"))
    stale["schemaVersion"] = "village/1"
    stale.pop("roadGraphProvenance")
    stale["geometry"].pop("orientationChecks")
    path = Path(tempfile.mkdtemp()) / "stale.json"
    path.write_text(json.dumps(stale, ensure_ascii=False), encoding="utf-8")

    try:
        load_village(path)
    except StaleRegistryError as exc:
        assert "import_village" in str(exc)
        assert "orientationChecks" in str(exc)
        return
    raise AssertionError("a stale registry should be refused")


def test_real_registry_matches_the_source_prose():
    """Only runs when the imported registry is present; it is git-ignored."""
    from app.simulation.village import IMPORTED

    if not IMPORTED.exists():
        return
    real = load_village(IMPORTED)
    checks = real.geometry["orientationChecks"]
    axis = checks["pairs"]["P9자택→미가식당"]
    assert axis["metres"] == 1111, "source prose says 1.11 km"
    assert axis["compass"] == "북"
    assert checks["longAxis"] == "north-south"

    # The two independent cross-checks the rotation was derived against:
    # the sea side must land east, and 남해읍 must land north-ish.
    port = checks["pairs"]["마을회관→은점항"]
    town = checks["pairs"]["마을회관→읍내방향"]
    assert 45 < port["bearingDeg"] < 135, port
    assert town["bearingDeg"] > 300 or town["bearingDeg"] < 45, town

    assert real.road_graph_provenance["allEdgesFromSourcePolylines"] is True
    p7p8 = real.named_route_distances["P7>P8"]
    assert round(p7p8["sourceM"]) == 838, "source prose says 838 m by road"
    assert p7p8["graphM"] < p7p8["sourceM"]


# ------------------------------------------------------------------ observation
def test_medial_never_sees_world_truth():
    """The engine knows P1 is in the field. MEDial must not, unless told."""
    result = run("policy-A-v1")
    for event in result.events:
        if event.type in WORLD_TRUTH_EVENTS:
            assert event.visibility == [RESEARCHER]
            assert not visible_to(MEDIAL, event)

    medial_obs = [o for o in result.observations if o.actorId == MEDIAL]
    # Before the head reports back, nothing MEDial holds may name the field.
    report_time = next(e.simTimeMs for e in result.events
                       if e.type is EventType.medial_observed)
    for obs in medial_obs:
        if obs.simTimeMs < report_time:
            blob = json.dumps(obs.model_dump(), ensure_ascii=False)
            assert "FARM" not in blob, "MEDial learned the field before being told: %s" % blob

    # And after the report it is marked as second-hand, not observed.
    farm_obs = [o for o in medial_obs if o.kind == "local_knowledge"]
    assert farm_obs and farm_obs[0].confidence == "reported"


def test_observation_log_refuses_to_leak():
    result = run("policy-A-v1")
    world_event = next(e for e in result.events if e.type in WORLD_TRUTH_EVENTS)
    from app.simulation.observations import ObservationLog

    log = ObservationLog()
    try:
        log.record("att", MEDIAL, world_event, "sneaky")
    except ObservationLeak:
        return
    raise AssertionError("recording a world-truth event for MEDial should raise")


def test_actor_views_are_isolated():
    """P6's local knowledge is his own; it must not appear in another actor view."""
    from app.simulation.engine import Engine
    from app.simulation.decks.p1_no_response import DECK as deck, POLICY_A, RESOURCES
    from app.simulation.runner import build_attempt

    attempt = build_attempt("att-view", "view", POLICY_A, deck, RESOURCES, village())
    engine = Engine(attempt, POLICY_A, deck, RESOURCES, village())
    engine.run()
    head_view = engine._view("P6", CHECKIN_MS)
    other_view = engine._view("P4", CHECKIN_MS)
    assert head_view.local_knowledge
    assert other_view.local_knowledge == []
    for obs in other_view.observations:
        assert obs.actorId == "P4"


# ---------------------------------------------------------------------- policy
def test_policies_produce_different_follow_up_events():
    a = run("policy-A-v1", "att-a")
    b = run("policy-B-v1", "att-b")

    a_types = [e.type for e in a.events]
    b_types = [e.type for e in b.events]

    # A spends a neighbour; B does not.
    assert EventType.request_offered in a_types
    assert EventType.request_offered not in b_types
    # B involves the health centre; A does not.
    assert EventType.handoff_requested in b_types
    assert EventType.handoff_requested not in a_types

    assert a.metrics["neighbourMinutes"] > 0
    assert b.metrics["neighbourMinutes"] == 0
    assert b.metrics["institutionBurden"]["staffMinutes"] > 0
    assert a.metrics["institutionBurden"]["staffMinutes"] == 0
    # Different real waiting times, not just different logs.
    assert a.metrics["waitMs"]["meanMinutesResolvedOnly"] < \
        b.metrics["waitMs"]["meanMinutesResolvedOnly"]
    # Different recipients of the same person information.
    assert set(a.metrics["disclosure"]) != set(b.metrics["disclosure"])


def test_no_response_leaves_location_and_condition_unconfirmed():
    """R03. A missed check-in establishes one thing: nobody answered.

    It does not establish that the person is out, that they are fine, or that an
    emergency has been ruled out. The last one is a different claim from "no
    emergency evidence arrived", and the log must never make it.
    """
    for policy_id in ("policy-A-v1", "policy-B-v1"):
        result = run(policy_id, "att-safety-" + policy_id)
        assert result.metrics["safety"]["emergencyClassifications"] == 0
        assert result.metrics["safety"]["emergencyRuleOutClaims"] == 0

        classified = [e for e in result.events
                      if e.type is EventType.medial_classified]
        assert classified
        for event in classified:
            assert "emergencyRuledOut" not in event.payload
            assert event.payload["classification"] == "unconfirmed_wellbeing"
            assert event.payload["clinicalStatus"] == "unconfirmed"
            assert event.payload["locationStatus"] == "unconfirmed"
            assert event.payload["emergencyEvidence"] == []

        # a missed contact must not be logged as the resident declining
        assert not [e for e in result.events
                    if e.type is EventType.request_declined
                    and e.payload.get("reason") == "no_response"]
        missed = [e for e in result.events if e.type is EventType.contact_no_response]
        assert missed


def test_the_world_reason_for_a_missed_call_stays_with_the_researcher():
    """R04. Why the phone was not answered is a fact about the world.

    It used to ride inside the MEDial-visible ``contact.no_response`` payload,
    so anything reading the event log learned that P1 was in the field.
    """
    result = run("policy-A-v1", "att-reason")
    resolved = [e for e in result.events
                if e.type is EventType.world_reachability_resolved]
    assert resolved, "the engine must record why, for the researcher"
    for event in resolved:
        assert event.visibility == [RESEARCHER]
        assert event.payload["worldReason"]

    for event in result.events:
        if event.type in (EventType.contact_no_response, EventType.contact_answered):
            assert "reachabilityBasis" not in event.payload
            blob = json.dumps(event.payload, ensure_ascii=False)
            assert "밭" not in blob and "FARM" not in blob, blob


def test_contact_is_not_counted_as_completion():
    b = run("policy-B-v1", "att-count")
    handoff = [e for e in b.events if e.type is EventType.handoff_accepted]
    assert handoff
    resolved_at = next(e.simTimeMs for e in b.events if e.type is EventType.need_resolved)
    assert resolved_at > handoff[0].simTimeMs, "handoff must not close the request"
    assert b.metrics["requests"]["resolved"] == 1
    assert b.metrics["contacts"]["attempts"] > b.metrics["requests"]["resolved"]


def test_reachability_follows_the_world_not_the_policy():
    """Policy B only resolves because P1 is genuinely home when the centre calls."""
    b = run("policy-B-v1", "att-reach")
    answered = next(e for e in b.events if e.type is EventType.contact_answered)
    from app.simulation.world import WorldState

    world = WorldState(village(), DECK.horizonMs)
    assert world.place_of("P1", answered.simTimeMs) == "HOME:P1"
    assert world.place_of("P1", CHECKIN_MS) == "FARM"


# ------------------------------------------------------------------- movement
def test_no_teleport():
    a = run("policy-A-v1", "att-move")
    head = a.timeline["actors"]["P6"]
    for previous, current in zip(head["realized"], head["realized"][1:]):
        assert current["startMs"] >= previous["endMs"], "segments must not overlap"
    for segment in head["realized"]:
        if segment["kind"] == "travel":
            assert segment["endMs"] > segment["startMs"], "travel takes time"
            assert segment["metres"] > 0 or segment["mode"] == "offmap"
            assert segment.get("polyline"), "travel follows a road polyline"


def test_actor_is_in_one_place_at_a_time():
    a = run("policy-A-v1", "att-single")
    for entry in a.timeline["actors"].values():
        for previous, current in zip(entry["realized"], entry["realized"][1:]):
            assert previous["endMs"] <= current["startMs"]


def test_plan_change_is_recorded_and_baseline_is_kept():
    a = run("policy-A-v1", "att-plan")
    head = a.timeline["actors"]["P6"]
    assert head["planChanged"] is True
    assert any(s["origin"] == "task" for s in head["realized"])
    assert all(s["origin"] == "baseline" for s in head["baseline"])
    # Someone who was not asked keeps an unchanged day.
    assert a.timeline["actors"]["P4"]["planChanged"] is False
    assert a.timeline["actors"]["P4"]["realized"] == a.timeline["actors"]["P4"]["baseline"]


# --------------------------------------------------------------------- replay
def test_rule_runs_are_deterministic_and_replay_matches():
    first = run("policy-A-v1", "att-det")
    second = run("policy-A-v1", "att-det")
    assert log_fingerprint(first.events) == log_fingerprint(second.events)

    svc = service()
    created = svc.create_attempt("policy-A-v1", DECK_ID, RES_ID)
    attempt_id = created["attempt"]["id"]
    stored = svc.events(attempt_id)
    assert [e["seq"] for e in stored] == list(range(1, len(stored) + 1))

    replayed = [
        {"seq": e["seq"], "t": e["simTimeMs"], "type": e["type"], "actor": e["actorId"],
         "corr": e["correlationId"], "vis": e["visibility"], "payload": e["payload"]}
        for e in stored
    ]
    live = json.loads(json.dumps([
        {"seq": e.seq, "t": e.simTimeMs, "type": e.type.value, "actor": e.actorId,
         "corr": e.correlationId, "vis": e.visibility, "payload": e.payload}
        for e in svc._runs[attempt_id].events
    ], ensure_ascii=False, default=str))
    assert replayed == live


def test_seek_does_not_invoke_an_adapter():
    svc = service()
    created = svc.create_attempt("policy-A-v1", DECK_ID, RES_ID)
    attempt_id = created["attempt"]["id"]
    before = log_fingerprint(svc._runs[attempt_id].events)

    svc.command(attempt_id, "cmd-seek-1", "seek", seq=5)
    svc.command(attempt_id, "cmd-step-1", "step")
    svc.command(attempt_id, "cmd-play-1", "play")

    after = log_fingerprint(svc._runs[attempt_id].events)
    assert before == after
    assert svc.store.get_attempt(attempt_id)["attempt"]["cursorSeq"] == 6


def test_attempt_survives_a_restart():
    """A stored attempt must reopen complete. The map, the trace and the
    comparison all read from the store, not from whatever is still in memory."""
    import tempfile

    db = Path(tempfile.mkdtemp()) / "runs.sqlite3"
    first = service(Store(db))
    attempt_id = first.create_attempt("policy-A-v1", DECK_ID, RES_ID)["attempt"]["id"]
    before = first.get_attempt(attempt_id)
    arrival = next(e for e in first._runs[attempt_id].events
                   if e.type is EventType.task_check_performed)
    first.store.close()

    # a fresh process: nothing cached, only the database
    second = service(Store(db))
    assert second._runs == {}
    after = second.get_attempt(attempt_id)

    assert after["timeline"] is not None, "the map would be empty after a restart"
    assert after["timeline"] == before["timeline"]
    assert after["trace"] == before["trace"]
    assert after["metrics"] == before["metrics"]

    snap = second.snapshot(attempt_id, arrival.simTimeMs)
    head = next(a for a in snap["actors"] if a["id"] == "P6")
    assert head["onTask"] is True

    report = build_comparison(second, [attempt_id, attempt_id])
    assert report["decisionDifference"][0]["steps"], "the trace must survive too"
    second.store.close()


def test_snapshot_agrees_with_the_event_log():
    svc = service()
    created = svc.create_attempt("policy-A-v1", DECK_ID, RES_ID)
    attempt_id = created["attempt"]["id"]
    arrival = next(e for e in svc._runs[attempt_id].events
                   if e.type is EventType.task_check_performed)
    snap = svc.snapshot(attempt_id, arrival.simTimeMs)
    head = next(a for a in snap["actors"] if a["id"] == "P6")
    assert head["onTask"] is True
    assert head["divergesFromBaseline"] is True
    p4 = next(a for a in snap["actors"] if a["id"] == "P4")
    assert p4["onTask"] is False


# ----------------------------------------------------------------- idempotency
def test_duplicate_commands_are_idempotent():
    svc = service()
    attempt_id = svc.create_attempt("policy-A-v1", DECK_ID, RES_ID)["attempt"]["id"]
    first = svc.command(attempt_id, "cmd-1", "step")
    second = svc.command(attempt_id, "cmd-1", "step")
    third = svc.command(attempt_id, "cmd-2", "step")

    assert first["cursorSeq"] == 1
    assert second["cursorSeq"] == 1, "the same commandId must not advance twice"
    assert second["deduplicated"] is True
    assert first["deduplicated"] is False
    assert third["cursorSeq"] == 2


# ------------------------------------------------------------- rerun and fork
def test_rerun_does_not_change_the_parent():
    """R02. A policy variation from the initial state is a *rerun*.

    It is a valid experiment and it is not a branch in time, so it carries no
    ``parentSeq`` - the number used to be recorded as if it meant something.
    """
    svc = service()
    parent_id = svc.create_attempt("policy-A-v1", DECK_ID, RES_ID)["attempt"]["id"]
    parent_before = svc.get_attempt(parent_id)
    parent_events_before = svc.events(parent_id)

    child = svc.rerun_attempt(parent_id, {"params": {"helperContactCap": 0}},
                              reason="이웃 연락 상한을 0으로 낮추면 어떻게 되는지 본다")
    child_id = child["attempt"]["id"]

    assert child_id != parent_id
    assert child["attempt"]["parentId"] == parent_id
    assert child["attempt"]["lineage"] == "rerun"
    assert child["attempt"]["parentSeq"] is None, "a rerun carries nothing over"
    assert child["policy"]["parentId"] == "policy-A-v1", "policy lineage is separate"
    assert child["policy"]["id"] != "policy-A-v1"
    # the edit is recorded as before → after, not only as free text
    assert any("helperContactCap" in c for c in child["policy"]["changes"])

    parent_after = svc.get_attempt(parent_id)
    assert parent_after["metrics"] == parent_before["metrics"]
    assert svc.events(parent_id) == parent_events_before

    # the changed condition really changed the outcome
    assert child["metrics"]["requests"]["unresolved"] == 1
    assert parent_after["metrics"]["requests"]["unresolved"] == 0


def test_fork_keeps_the_parent_prefix_and_switches_after_it():
    """R02. A checkpoint fork is the parent's run up to ``atSeq``, then new rules.

    The prefix is not asserted by label: the service compares it event by event
    against the parent's stored log and refuses to save a run that diverged.
    """
    svc = service()
    parent_id = svc.create_attempt("policy-A-v1", DECK_ID, RES_ID)["attempt"]["id"]
    parent_events = svc.events(parent_id)
    at_seq = next(e["seq"] for e in parent_events
                  if e["type"] == EventType.request_offered.value)

    child = svc.fork_attempt(parent_id, at_seq,
                             {"params": {"helperContactCap": 0}},
                             reason="이장이 이미 요청을 받은 시점 이후만 바꿔 본다")
    child_id = child["attempt"]["id"]
    assert child["attempt"]["lineage"] == "fork"
    assert child["attempt"]["parentSeq"] == at_seq

    child_events = svc.events(child_id)
    for parent_event, child_event in zip(parent_events[:at_seq], child_events[:at_seq]):
        assert parent_event["type"] == child_event["type"]
        assert parent_event["simTimeMs"] == child_event["simTimeMs"]
        assert parent_event["payload"] == child_event["payload"]

    switch = [e for e in child_events if e["type"] == EventType.policy_switched.value]
    assert switch and switch[0]["seq"] > at_seq
    assert switch[0]["visibility"] == [RESEARCHER]
    assert svc.events(parent_id) == parent_events, "the parent is untouched"


def test_a_fork_whose_prefix_diverges_is_refused():
    """The check has to actually fail when the prefix differs.

    Forced here by handing the fork a parent log that was written with one
    event's payload altered: a stored attempt whose prefix cannot be reproduced
    is not a parent, and calling the run its child would corrupt the lineage.
    """
    from app.simulation.service import ForkPrefixMismatch

    svc = service()
    parent_id = svc.create_attempt("policy-A-v1", DECK_ID, RES_ID)["attempt"]["id"]
    # rewrite one stored event so the deterministic replay can no longer match
    row = svc.store._conn.execute(
        "SELECT event_json FROM events WHERE attempt_id = ? AND seq = 3",
        (parent_id,)).fetchone()
    tampered = json.loads(row["event_json"])
    tampered["payload"]["tampered"] = True
    svc.store._conn.execute(
        "UPDATE events SET event_json = ? WHERE attempt_id = ? AND seq = 3",
        (json.dumps(tampered, ensure_ascii=False), parent_id))
    svc.store._conn.commit()

    before = {r["attempt"]["id"] for r in svc.store.list_attempts()}
    try:
        svc.fork_attempt(parent_id, 5, {"params": {"helperContactCap": 0}},
                         reason="접두부가 다른 경우")
    except ForkPrefixMismatch:
        after = {r["attempt"]["id"] for r in svc.store.list_attempts()}
        assert after == before, "a refused fork must not be stored"
        return
    raise AssertionError("a fork with a diverging prefix must be refused")


def test_comparison_reports_three_kinds_of_difference():
    svc = service()
    a = svc.create_attempt("policy-A-v1", DECK_ID, RES_ID)["attempt"]["id"]
    b = svc.create_attempt("policy-B-v1", DECK_ID, RES_ID)["attempt"]["id"]
    report = build_comparison(svc, [a, b])
    assert set(report) >= {"conditionDifference", "decisionDifference", "outcomeDifference"}
    assert len(report["conditionDifference"]) == 2
    strategies = {row["contactStrategy"] for row in report["conditionDifference"]}
    assert strategies == {"head_first", "retry_then_clinic"}
    waits = {row["attemptId"]: row["meanWaitMinutesResolvedOnly"]
             for row in report["outcomeDifference"]}
    assert waits[a] != waits[b]
    # the decks and resources are held fixed
    decks = {row["deckId"] for row in report["conditionDifference"]}
    assert len(decks) == 1


# --------------------------------------------------------- adapter failure paths
def test_model_failure_is_not_recorded_as_a_resident_action():
    result = run("policy-A-v1", "att-llm", adapter="llm")
    assert result.metrics["adapterFailures"] > 0
    for event in result.events:
        assert event.type is not EventType.request_declined
    waiting = [e for e in result.events
               if e.type is EventType.medial_waiting
               and e.payload.get("reason") == "adapter_error"]
    assert waiting, "an adapter failure must be visible as an engine fault"
    unresolved = [e for e in result.events if e.type is EventType.need_unresolved]
    assert unresolved
    assert "응답을 만들지 못했다" in unresolved[0].payload["reason"]


def test_llm_prompt_carries_only_the_actor_own_context():
    view = ActorView(actor_id="P6", sim_time_ms=CHECKIN_MS, observations=[],
                     own_place="PATROL", own_activity="마을 순찰", own_interruptible=True,
                     local_knowledge=[{"subjectId": "P1", "place": "FARM"}])
    payload = build_prompt_payload(view, [ProposalAction.accept])
    blob = json.dumps(payload, ensure_ascii=False)
    assert "localKnowledge" not in payload
    assert "publishedAvailability" not in payload
    assert "FARM" not in blob, "the prompt must not smuggle in other-actor knowledge"
    assert payload["actorId"] == "P6"


def test_scripted_adapter_only_fires_on_a_matching_observation():
    script = [{"actorId": "P6", "onObservationKind": "request.offered",
               "action": "decline", "params": {"reason": "scripted_decline"},
               "utterance": "오늘은 어렵겠습니다."}]
    result = run("policy-A-v1", "att-script", adapter="scripted", script=script)
    declined = [e for e in result.events if e.type is EventType.request_declined]
    assert declined and declined[0].payload["reason"] == "scripted_decline"
    assert result.metrics["requests"]["unresolved"] == 1
    assert result.metrics["neighbourMinutes"] == 0


# -------------------------------------------------------------------- reviews
def test_reviews_are_grounded_in_experienced_events():
    a = run("policy-A-v1", "att-rev-a")
    b = run("policy-B-v1", "att-rev-b")
    a_head = next(r for r in a.reviews if r.actorId == "P6")
    b_head = next(r for r in b.reviews if r.actorId == "P6")

    assert a_head.experiencedEventIds
    assert a_head.assessment != "unknown"
    assert b_head.experiencedEventIds == []
    assert b_head.assessment == "unknown", "no experience means no assessment"

    for review in a.reviews + b.reviews:
        assert review.source == "simulated"
        assert "실제 주민 만족도" not in review.comment or "아니다" in review.comment
        assert "실제 본인 평가" in review.unknowns
        blob = json.dumps(review.model_dump(), ensure_ascii=False)
        assert "rating" not in blob and "stars" not in blob


def test_no_human_or_researcher_reviews_are_fabricated():
    a = run("policy-A-v1", "att-rev-src")
    assert {r.source for r in a.reviews} == {"simulated"}


# ------------------------------------------------------------------- contracts
def test_events_validate_against_the_published_schema():
    schema_path = REPO_ROOT / "docs" / "research" / "contracts" / "domain.schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    import jsonschema

    result = run("policy-A-v1", "att-schema")
    definition = schema["$defs"]["DomainEvent"]
    definition = {**definition, "$defs": schema["$defs"]}
    for event in result.events[:5]:
        payload = json.loads(event.model_dump_json())
        payload["type"] = event.type.value
        jsonschema.validate(payload, definition)


def test_event_payloads_are_required_not_optional():
    from pydantic import ValidationError

    from app.simulation.contracts import DomainEvent

    try:
        DomainEvent(id="x", attemptId="a", seq=1, simTimeMs=0,
                    type=EventType.need_resolved, actorId=MEDIAL, correlationId="c",
                    visibility=[MEDIAL], payload={"requestId": "r"})
    except ValidationError:
        return
    raise AssertionError("a half-filled event should not validate")


def test_world_truth_events_cannot_be_addressed_to_an_actor():
    from pydantic import ValidationError

    from app.simulation.contracts import DomainEvent

    try:
        DomainEvent(id="x", attemptId="a", seq=1, simTimeMs=0,
                    type=EventType.world_actor_arrived, actorId="P1", correlationId="c",
                    visibility=[MEDIAL], payload={"place": "FARM"})
    except ValidationError:
        return
    raise AssertionError("a world-truth event addressed to MEDial should not validate")


# ------------------------------------------------------------------ safety net
def test_synthetic_fixture_is_labelled():
    assert village().is_synthetic
    assert village().data_source == "synthetic"


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
