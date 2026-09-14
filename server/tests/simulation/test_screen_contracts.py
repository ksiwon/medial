"""The contracts the three redesigned screens depend on.

Doc 15 asks for meaningful checks on exactly four things and for no tests that
merely restate a CSS value: cursor/state change, restore after a restart, a
single start that cannot double, and the per-request grouping the MEDial panel
is built on. Those are the four here.

Each one exists because the screen makes a *claim* the server has to back:

* the observe screen says "this flow is one request, and no other request's
  events are in it". That is only true if every event carries a correlation id
  and the world stream is distinguishable from a request stream;
* the playback bar says "this is a recording" and the progress bar says "this is
  the run". Seeking must therefore change the stored cursor and nothing else;
* a refresh must land on the same event, or the observe screen is lying about
  where the researcher left off;
* the prepare screen has one button that creates and starts. A second press must
  not produce a second session.
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))

from fastapi.testclient import TestClient  # noqa: E402

from app.simulation.api.routes import create_app, set_service  # noqa: E402
from app.simulation.iteration.api import set_iteration_service  # noqa: E402
from app.simulation.iteration.llm import LlmClient  # noqa: E402
from app.simulation.iteration.service import IterationService  # noqa: E402
from app.simulation.persistence.store import Store  # noqa: E402
from app.simulation.service import SimulationService  # noqa: E402
from app.simulation.village import load_village  # noqa: E402

SYNTHETIC = REPO_ROOT / "fixtures" / "synthetic" / "village.synthetic.json"
SYNTHETIC_PERSONAS = str(REPO_ROOT / "fixtures" / "synthetic" / "personas.synthetic.json")
CHECKIN_DECK = "deck-p1-no-response-v1"
TRANSPORT_DECK = "deck-p9-transport-v1"
RES_ID = "assumed-resources-v1"
TRANSPORT_RES_ID = "assumed-resources-transport-v1"


def _service(store: Store) -> SimulationService:
    return SimulationService(store=store, village=load_village(SYNTHETIC),
                             persona_path=SYNTHETIC_PERSONAS)


def client(store: Store | None = None) -> TestClient:
    store = store or Store(":memory:")
    sim = _service(store)
    set_service(sim)
    # An explicit unconfigured client, never LlmClient.from_env(): a test must
    # not become a model call because the developer has a key exported.
    set_iteration_service(IterationService(sim, llm_client=LlmClient()))
    return TestClient(create_app())


def make_attempt(api: TestClient, deck: str = TRANSPORT_DECK,
                 policy_id: str = "policy-T-A-v1",
                 resource_id: str = TRANSPORT_RES_ID) -> str:
    response = api.post("/api/sim/attempts", json={
        "policyId": policy_id, "scenarioDeckId": deck,
        "resourceRevisionId": resource_id})
    assert response.status_code == 200, response.text
    return response.json()["attempt"]["id"]


# -- the per-request grouping selector --------------------------------------

def test_every_event_carries_a_correlation_id():
    """The MEDial panel groups by ``correlationId`` rather than guessing.

    If any event arrived without one the screen would have to invent a grouping,
    which doc 15 forbids outright.
    """
    api = client()
    attempt_id = make_attempt(api)
    events = api.get("/api/sim/attempts/%s/events" % attempt_id).json()["events"]
    assert events
    assert all(event["correlationId"] for event in events)


def test_two_requests_in_one_day_stay_separate():
    """The transport deck raises two needs. They must not share a stream.

    This is the bug the redesign fixed on the screen side: a panel that counted
    event *types* across the day painted one request complete because a different
    one had finished.
    """
    api = client()
    attempt_id = make_attempt(api)
    events = api.get("/api/sim/attempts/%s/events" % attempt_id).json()["events"]

    requests = {event["correlationId"] for event in events
                if event["correlationId"] != "world"}
    assert len(requests) >= 2, requests

    # No resolution is shared: each closing event belongs to exactly one stream.
    closings = [event for event in events
                if event["type"] in ("need.resolved", "need.unresolved")]
    assert closings
    assert len({event["correlationId"] for event in closings}) == len(closings)


def test_the_world_stream_is_distinguishable_from_a_request():
    """``world.*`` events are researcher-only facts, not request progress.

    ``world.reachability_resolved`` says *why* a call went unanswered - knowledge
    the caller does not have. The observe screen drops these from a request's
    flow, and it can only do that if the type prefix marks them.
    """
    api = client()
    attempt_id = make_attempt(api, deck=CHECKIN_DECK, policy_id="policy-A-v1",
                              resource_id=RES_ID)
    events = api.get("/api/sim/attempts/%s/events" % attempt_id).json()["events"]

    world = [event for event in events if event["type"].startswith("world.")]
    assert world, "the check-in deck resolves reachability in the world"
    for event in world:
        if event["type"] == "world.reachability_resolved":
            assert "MEDial" not in event["visibility"]


# -- cursor change and restore ----------------------------------------------

def test_seeking_moves_the_stored_cursor():
    api = client()
    attempt_id = make_attempt(api)
    before = api.get("/api/sim/attempts/%s" % attempt_id).json()["attempt"]["cursorSeq"]

    response = api.post("/api/sim/attempts/%s/commands" % attempt_id, json={
        "commandId": "cmd-seek-1", "name": "seek", "seq": 12})
    assert response.status_code == 200, response.text
    assert response.json()["cursorSeq"] == 12
    assert before != 12

    stored = api.get("/api/sim/attempts/%s" % attempt_id).json()["attempt"]["cursorSeq"]
    assert stored == 12


def test_the_cursor_survives_a_server_restart():
    """Reopening lands on the same event, which is what the observe screen
    promises when it restores a session rather than starting one."""
    store = Store(":memory:")
    api = client(store)
    attempt_id = make_attempt(api)
    api.post("/api/sim/attempts/%s/commands" % attempt_id, json={
        "commandId": "cmd-seek-1", "name": "seek", "seq": 9})

    # A fresh service over the same store is what a restart looks like.
    restarted = client(store)
    attempt = restarted.get("/api/sim/attempts/%s" % attempt_id).json()["attempt"]
    assert attempt["cursorSeq"] == 9


def test_replaying_a_command_id_does_not_move_the_cursor_twice():
    api = client()
    attempt_id = make_attempt(api)
    first = api.post("/api/sim/attempts/%s/commands" % attempt_id, json={
        "commandId": "cmd-step-1", "name": "step"})
    second = api.post("/api/sim/attempts/%s/commands" % attempt_id, json={
        "commandId": "cmd-step-1", "name": "step"})
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["cursorSeq"] == second.json()["cursorSeq"]


# -- the single start button ------------------------------------------------

def _create_session(api: TestClient) -> str:
    response = api.post("/api/sim/iteration/sessions", json={
        "label": "테스트 실험",
        "coreItem": "누구의 시간으로 해결할 것인가",
        "basePolicyId": "policy-IT-v0",
        "developmentDeckRefs": [CHECKIN_DECK],
        "resourceRevisionId": RES_ID,
        "maxGenerations": 1,
        "maxChangeSetsPerGeneration": 1,
        "callBudget": 0,
        "reviewAdapter": "rule",
        "improvementAdapter": "rule",
    })
    assert response.status_code == 200, response.text
    return response.json()["session"]["id"]


def test_a_second_start_on_the_same_session_is_a_409():
    """The prepare screen's one button creates then starts.

    A duplicate press must be told "already running" - a distinguishable status,
    not a generic failure - so the screen can adopt the running session instead
    of offering to create another one.
    """
    api = client()
    session_id = _create_session(api)

    first = api.post("/api/sim/iteration/sessions/%s/commands" % session_id, json={
        "commandId": "start-1", "name": "start", "payload": {}, "blocking": True})
    assert first.status_code == 200, first.text

    second = api.post("/api/sim/iteration/sessions/%s/commands" % session_id, json={
        "commandId": "start-2", "name": "start", "payload": {}, "blocking": True})
    assert second.status_code == 409, second.text


def test_creating_a_session_does_not_start_it():
    """Create and start are two calls, so a create that succeeded and a start
    that failed are two distinguishable outcomes on the prepare screen."""
    api = client()
    session_id = _create_session(api)
    status = api.get("/api/sim/iteration/sessions/%s/status" % session_id).json()
    assert status["session"]["status"] == "created"
    assert status["running"] is False


def test_reading_a_session_never_starts_one():
    """Restoring the last session on load is a read. If a GET could advance the
    loop, a refresh would silently re-run an experiment."""
    api = client()
    session_id = _create_session(api)
    for _ in range(3):
        api.get("/api/sim/iteration/sessions/%s" % session_id)
        api.get("/api/sim/iteration/sessions/%s/generations" % session_id)
        api.get("/api/sim/iteration/sessions")
    status = api.get("/api/sim/iteration/sessions/%s/status" % session_id).json()
    assert status["session"]["status"] == "created"


def test_listing_sessions_creates_nothing():
    """The empty state is the prepare screen. Loading the workspace must not
    manufacture the A/B attempts the old bootstrap created."""
    api = client()
    assert api.get("/api/sim/iteration/sessions").json()["sessions"] == []
    assert api.get("/api/sim/catalog").json()["attempts"] == []

# -- researcher confirmation: drafts are not execution branches ---------------

def test_change_sets_stop_before_execution_and_stay_on_the_source_generation():
    from app.simulation.iteration.contracts import SessionStatus  # noqa: PLC0415

    api = client()
    response = api.post("/api/sim/iteration/sessions", json={
        "label": "trade-off 확인",
        "coreItem": "누구의 시간으로 해결할 것인가",
        "basePolicyId": "policy-IT-v0",
        "developmentDeckRefs": [CHECKIN_DECK, TRANSPORT_DECK],
        "resourceRevisionId": TRANSPORT_RES_ID,
        "maxGenerations": 2,
        "maxChangeSetsPerGeneration": 3,
        "callBudget": 0,
        "reviewAdapter": "rule",
        "improvementAdapter": "rule",
    })
    assert response.status_code == 200, response.text
    session_id = response.json()["session"]["id"]

    started = api.post("/api/sim/iteration/sessions/%s/commands" % session_id, json={
        "commandId": "start-1", "name": "start", "payload": {}, "blocking": True})
    assert started.status_code == 200, started.text

    detail = api.get("/api/sim/iteration/sessions/%s" % session_id).json()
    assert detail["session"]["status"] == SessionStatus.awaiting_confirmation.value
    assert len(detail["generations"]) == 1, "확정 전에는 실행 후보 세대를 만들면 안 된다"
    drafts = [item for item in detail["generations"][0]["changeSets"]
              if item["validationStatus"] == "valid"
              and item["confirmationStatus"] == "draft"]
    assert drafts, "확인을 기다리는데 실행 가능한 Change Set이 없다"
    for change_set in drafts:
        assert change_set["reviewItemRefs"]
        assert change_set["changes"]
        assert change_set["expectedEffects"] or change_set["possibleRegressions"]
        assert change_set["resultingPolicyRevisionId"] is None


def test_the_loop_does_not_choose_for_the_designer():
    """Draft generation stops without making a final research decision."""
    from app.simulation.iteration.contracts import SessionStatus  # noqa: PLC0415

    api = client()
    session_id = _create_session(api)
    api.post("/api/sim/iteration/sessions/%s/commands" % session_id, json={
        "commandId": "start-1", "name": "start", "payload": {}, "blocking": True})
    detail = api.get("/api/sim/iteration/sessions/%s" % session_id).json()
    # Nothing is decided on the designer's behalf, in any terminal state.
    assert detail["decisions"] == []
