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
            hub.command(stage.StageCommand(name="seek", value=i))
        assert wall.qsize() == stage.QUEUE_SIZE
        hub.unsubscribe(wall)
        assert hub.presence() == {"wall": 0, "pad": 0}
    asyncio.run(run())


def test_only_the_named_presses_are_accepted_and_the_sim_version_lets_them_through():
    set_service(SimulationService(store=Store(":memory:"), village=load_village(SYNTHETIC),
                                  persona_path=PERSONAS, mode="sim"))
    client = TestClient(create_app())
    assert client.post("/api/sim/stage/command", json={"name": "togglePlay"}).status_code == 200
    assert client.post("/api/sim/stage/command", json={"name": "rerun"}).status_code == 422
    assert client.post("/api/sim/stage/state", json={"screen": "case"}).status_code == 200
    # and it is still a sim server: nothing that starts a run got easier to reach
    assert client.post("/api/sim/attempts", json={}).status_code == 403
    assert modes.refuses("sim", "POST", "/api/sim/stage/other") is True
