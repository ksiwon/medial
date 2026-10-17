"""The relay between the exhibition's wall and tablet: a press goes to the wall,
the wall's description goes to the tablet, and nothing else moves."""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))

from fastapi.testclient import TestClient  # noqa: E402

from app.simulation import mode as modes  # noqa: E402
from app.simulation.api import stage  # noqa: E402
from app.simulation.api.routes import create_app, set_service  # noqa: E402
from app.simulation.persistence.store import Store  # noqa: E402
from app.simulation.service import SimulationService  # noqa: E402
from app.simulation.village import load_village  # noqa: E402

SYNTHETIC = REPO_ROOT / "fixtures" / "synthetic" / "village.synthetic.json"
PERSONAS = str(REPO_ROOT / "fixtures" / "synthetic" / "personas.synthetic.json")


def drain(queue: "asyncio.Queue[str]") -> list[tuple[str, dict]]:
    out = []
    while not queue.empty():
        frame = queue.get_nowait()
        if frame == stage.CLOSE:  # the end of a stream, not an event
            out.append(("close", {}))
            continue
        event = frame.split("\n")[0].removeprefix("event: ")
        out.append((event, json.loads(frame.split("data: ", 1)[1])))
    return out


def test_a_press_reaches_the_wall_and_only_the_wall():
    async def run():
        hub = stage.StageHub()
        wall, pad = hub.subscribe("wall"), hub.subscribe("pad")
        drain(wall), drain(pad)
        assert hub.command(stage.StageCommand(name="choose", id="G3")) == 1
        assert drain(wall) == [("command", {"name": "choose", "id": "G3"})]
        assert drain(pad) == []
    asyncio.run(run())


def test_the_walls_state_reaches_the_tablet_and_a_late_tablet_still_gets_it():
    async def run():
        hub = stage.StageHub()
        wall, pad = hub.subscribe("wall"), hub.subscribe("pad")
        drain(wall), drain(pad)
        hub.publish_state({"screen": "case", "playing": True})
        assert drain(pad) == [("state", {"screen": "case", "playing": True})]
        assert drain(wall) == []
        # a tablet that connects after the wall spoke is told what the wall shows
        frames = stage.frames("pad", hub)
        first = [await frames.__anext__() for _ in range(3)]
        assert "event: state" in first[2] and '"playing": true' in first[2]
        await frames.aclose()
    asyncio.run(run())


def test_presence_says_who_is_listening_and_a_stalled_listener_cannot_block_the_rest():
    async def run():
        hub = stage.StageHub()
        wall = hub.subscribe("wall")
        assert hub.presence() == {"wall": 1, "pad": 0}
        for i in range(stage.QUEUE_SIZE + 10):
            hub.command(stage.StageCommand(name="line", value=1 if i % 2 else -1))
        assert wall.qsize() == stage.QUEUE_SIZE
        hub.unsubscribe(wall)
        assert hub.presence() == {"wall": 0, "pad": 0}
    asyncio.run(run())


def _client() -> TestClient:
    set_service(SimulationService(store=Store(":memory:"), village=load_village(SYNTHETIC),
                                  persona_path=PERSONAS, mode="sim"))
    return TestClient(create_app())


def test_only_the_named_presses_are_accepted_and_the_sim_version_lets_them_through():
    client = _client()
    t = {"token": stage.hub.token}
    assert client.post("/api/sim/stage/command", params=t, json={"name": "skipScene"}).status_code == 200
    assert client.post("/api/sim/stage/command", params=t, json={"name": "rerun"}).status_code == 422
    assert client.post("/api/sim/stage/state", json={"screen": "case"}).status_code == 200
    # and it is still a sim server: nothing that starts a run got easier to reach
    assert client.post("/api/sim/attempts", json={}).status_code == 403
    assert modes.refuses("sim", "POST", "/api/sim/stage/other") is True


def test_a_press_without_the_pairing_token_is_refused():
    client = _client()
    body = {"name": "skipScene"}
    assert client.post("/api/sim/stage/command", json=body).status_code == 403
    assert client.post("/api/sim/stage/command", params={"token": "wrong"}, json=body).status_code == 403
    assert client.get("/api/sim/stage/events", params={"role": "pad"}).status_code == 403
    assert client.get("/api/sim/stage/events", params={"role": "pad", "token": "x"}).status_code == 403
    assert client.get("/api/sim/stage/check", params={"token": "x"}).status_code == 403
    assert client.get("/api/sim/stage/check", params={"token": stage.hub.token}).status_code == 200


def test_the_token_is_read_only_by_the_wall_not_by_a_tablet():
    client = _client()
    wall = client.get("/api/sim/stage/pairing", headers={"host": "localhost:5180"})
    assert wall.status_code == 200 and wall.json()["token"] == stage.hub.token
    # a tablet comes in by the machine's network address, and the web server's proxy says so
    tablet = client.get("/api/sim/stage/pairing", headers={"x-forwarded-host": "192.168.0.174:5180"})
    assert tablet.status_code == 403
    # the wall's own address cannot be borrowed by writing a header on the way in through the proxy
    forged = client.get("/api/sim/stage/pairing", headers={"host": "localhost", "x-forwarded-host": "192.168.0.174:5180"})
    assert forged.status_code == 403
    # only the wall tells the tablet what is on screen
    assert client.post("/api/sim/stage/state", headers={"x-forwarded-host": "192.168.0.174:5180"}, json={}).status_code == 403


def test_a_second_tablet_takes_over_and_the_first_is_told_it_was_released():
    async def run():
        hub = stage.StageHub()
        first = hub.subscribe("pad")
        drain(first)
        second = hub.subscribe("pad")
        assert hub.presence()["pad"] == 1  # the released one no longer counts, though its stream has not ended yet
        told = drain(first)
        assert [name for name, _ in told if name != "presence"] == ["released", "close"]
        hub.unsubscribe(first)             # and ending its stream changes nothing
        assert hub.presence()["pad"] == 1
        assert hub.command(stage.StageCommand(name="start")) == 0  # no wall: nobody to deliver to
        assert [n for n, _ in drain(second) if n != "presence"] == []  # a tablet is not sent presses
    asyncio.run(run())


def test_each_run_makes_its_own_token_and_it_is_not_guessable_from_the_address():
    one, two = stage.StageHub(), stage.StageHub()
    assert one.token != two.token and len(one.token) >= 12
    assert one.accepts(one.token) and not one.accepts(two.token) and not one.accepts(None) and not one.accepts("")


def test_a_reloaded_wall_replaces_the_old_one_so_no_press_is_done_twice():
    async def run():
        hub = stage.StageHub()
        old = hub.subscribe("wall")
        drain(old)
        new = hub.subscribe("wall")   # the page reloaded: the new stream opens before the old one is torn down
        told = [n for n, _ in drain(old)]
        assert "replaced" in told and "close" in told
        assert hub.presence()["wall"] == 1
        assert hub.command(stage.StageCommand(name="skipScene")) == 1   # one wall hears it, once
        assert [n for n, _ in drain(new) if n == "command"] == ["command"]
        assert [n for n, _ in drain(old) if n == "command"] == []
    asyncio.run(run())


def test_being_released_is_never_dropped_even_when_the_listener_has_stalled():
    async def run():
        hub = stage.StageHub()
        slow = hub.subscribe("pad")
        for i in range(stage.QUEUE_SIZE + 20):   # the tablet sleeps while the wall keeps talking
            hub.publish_state({"n": i})
        assert slow.full()
        hub.subscribe("pad")                     # another tablet takes over
        frames = []
        while not slow.empty():
            frames.append(slow.get_nowait())
        assert "event: released" in frames[-2] and frames[-1] == stage.CLOSE
    asyncio.run(run())


def test_a_tablet_is_not_shown_a_screen_the_wall_no_longer_has():
    async def run():
        hub = stage.StageHub()
        wall = hub.subscribe("wall")
        hub.publish_state({"phase": "day"})
        assert hub.state == {"phase": "day"}
        hub.unsubscribe(wall)                    # the wall went away
        assert hub.state is None
        hub.publish_state({"phase": "evaluations"})
        replacement = hub.subscribe("wall")      # and a new wall knows nothing of that
        assert hub.state is None
        hub.unsubscribe(replacement)
    asyncio.run(run())


def test_the_stream_says_it_is_alive_with_a_named_event_the_page_can_see():
    async def run():
        stage.PING_SECONDS, saved = 0.05, stage.PING_SECONDS
        try:
            hub = stage.StageHub()
            frames = stage.frames("wall", hub)
            seen = [await asyncio.wait_for(frames.__anext__(), 2) for _ in range(4)]
            assert any("event: ping" in frame for frame in seen)   # silence is answered, so a quiet line is not a dead one
            await frames.aclose()
        finally:
            stage.PING_SECONDS = saved
    asyncio.run(run())


def test_a_browser_that_leaves_is_noticed_through_the_whole_app_not_only_the_router():
    """The sim write guard once wrapped every response in a layer that hid a dropped browser from the stream
    underneath, so a tablet that went away stayed "connected" for ever and the next one was told it had been
    replaced. This runs the app as it is served - guard and all - and drops the connection."""
    import socket
    import threading
    import time

    import uvicorn

    set_service(SimulationService(store=Store(":memory:"), village=load_village(SYNTHETIC),
                                  persona_path=PERSONAS, mode="sim"))
    stage.hub = stage.StageHub()
    saved = stage.WATCH_SECONDS
    stage.WATCH_SECONDS = 0.2
    # the route reads the module's hub by name, so the fresh one above is what it will use
    server = uvicorn.Server(uvicorn.Config(create_app(), host="127.0.0.1", port=0, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        deadline = time.time() + 10
        while not server.started and time.time() < deadline:
            time.sleep(0.05)
        port = server.servers[0].sockets[0].getsockname()[1]
        wall = socket.create_connection(("127.0.0.1", port))
        wall.sendall(b"GET /api/sim/stage/events?role=wall HTTP/1.1\r\nHost: localhost\r\n\r\n")
        deadline = time.time() + 5
        while stage.hub.presence()["wall"] == 0 and time.time() < deadline:
            time.sleep(0.05)
        assert stage.hub.presence()["wall"] == 1
        wall.close()
        deadline = time.time() + 5
        while stage.hub.presence()["wall"] != 0 and time.time() < deadline:
            time.sleep(0.05)
        assert stage.hub.presence()["wall"] == 0, "a wall that left is still counted"
    finally:
        stage.WATCH_SECONDS = saved
        server.should_exit = True
        thread.join(timeout=5)
