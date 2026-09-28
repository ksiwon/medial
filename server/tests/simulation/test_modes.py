"""The two versions: ``sim`` plays what ``real`` ran, ``real`` generates.

What has to hold for "this was pre-run" to be a true sentence on the sim screen:
the sim server cannot start anything, cannot reach a model even with a key in
its environment, and serves exactly the frozen copy of real's database. And
neither version can come up without saying which one it is.
"""
from __future__ import annotations

import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))

from fastapi.testclient import TestClient  # noqa: E402

from app.simulation import mode as modes  # noqa: E402
from app.simulation.api.routes import create_app, set_service  # noqa: E402
from app.simulation.iteration.service import IterationService  # noqa: E402
from app.simulation.persistence.store import Store  # noqa: E402
from app.simulation.service import SimulationService  # noqa: E402
from app.simulation.village import load_village  # noqa: E402

SYNTHETIC = REPO_ROOT / "fixtures" / "synthetic" / "village.synthetic.json"
SYNTHETIC_PERSONAS = str(REPO_ROOT / "fixtures" / "synthetic" / "personas.synthetic.json")
DECK_ID = "deck-p1-no-response-v1"
RES_ID = "assumed-resources-v1"


def service(mode: str, store: Store | None = None) -> SimulationService:
    return SimulationService(store=store or Store(":memory:"), village=load_village(SYNTHETIC),
                             persona_path=SYNTHETIC_PERSONAS, mode=mode)


def api_for(svc: SimulationService) -> TestClient:
    set_service(svc)
    return TestClient(create_app())


def test_a_server_must_say_which_version_it_is():
    with pytest.raises(modes.ModeNotSet):
        modes.server_mode({})
    with pytest.raises(modes.ModeNotSet):
        modes.server_mode({"MEDIAL_MODE": "demo"})
    assert modes.server_mode({"MEDIAL_MODE": "sim"}) == "sim"
    assert modes.server_mode({"MEDIAL_MODE": "real"}) == "real"
    with pytest.raises(ValueError):
        SimulationService(store=Store(":memory:"), village=load_village(SYNTHETIC), mode="demo")


def test_each_version_keeps_its_own_record():
    sim, real = modes.database_path("sim", {}), modes.database_path("real", {})
    assert sim != real
    assert (sim.name, real.name) == ("sim.sqlite3", "real.sqlite3")
    # A disposable database (tests, e2e) still wins over both.
    assert modes.database_path("sim", {"MEDIAL_SIM_DB": "x.sqlite3"}) == Path("x.sqlite3")


def test_both_versions_say_which_they_are():
    for mode in ("sim", "real"):
        api = api_for(service(mode))
        assert api.get("/api/sim/health").json()["mode"] == mode
        assert api.get("/api/sim/catalog").json()["mode"] == mode


def test_the_sim_version_reaches_no_model_even_with_a_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-a-real-key")
    sim = IterationService(service("sim"))
    assert sim.llm.available is False
    assert sim.capabilities()["model"]["configured"] is False
    # The real version, given the same environment, would have one.
    assert IterationService(service("real")).llm.available is True


def test_the_sim_version_starts_nothing_and_writes_no_research_record():
    # A recording made by the real version...
    store = Store(":memory:")
    real = api_for(service("real", store))
    made = real.post("/api/sim/attempts", json={
        "policyId": "policy-A-v1", "scenarioDeckId": DECK_ID, "resourceRevisionId": RES_ID})
    assert made.status_code == 200, made.text
    attempt_id = made.json()["attempt"]["id"]

    # ...played by the sim version over the same records.
    sim = api_for(service("sim", store))
    refused = [
        sim.post("/api/sim/attempts", json={
            "policyId": "policy-A-v1", "scenarioDeckId": DECK_ID, "resourceRevisionId": RES_ID}),
        sim.post("/api/sim/attempts/%s/rerun" % attempt_id, json={"reason": "x"}),
        sim.post("/api/sim/policies", json={"baseId": "policy-A-v1", "reason": "x"}),
        sim.post("/api/sim/iteration/sessions", json={}),
        sim.post("/api/sim/iteration/sessions/any/commands",
                 json={"commandId": "c1", "name": "confirm_change_set"}),
        sim.post("/api/sim/iteration/sessions/any/human-reviews", json={}),
    ]
    for response in refused:
        assert response.status_code == 403
        assert response.json()["detail"] == modes.SIM_REFUSAL
    assert len(store.list_attempts()) == 1

    # Reading and moving the playback cursor are what it is for.
    assert sim.get("/api/sim/attempts/%s/events" % attempt_id).status_code == 200
    moved = sim.post("/api/sim/attempts/%s/commands" % attempt_id,
                     json={"commandId": "seek-1", "name": "seek", "seq": 3})
    assert moved.status_code == 200, moved.text


def _freeze_module():
    spec = importlib.util.spec_from_file_location(
        "freeze_sim", REPO_ROOT / "scripts" / "freeze_sim.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def _session_row(db: Path, sid: str, status: str) -> None:
    con = sqlite3.connect(db)
    con.execute("INSERT INTO iteration_sessions (id, label, status, stop_reason, created_at, "
                "updated_at, session_json) VALUES (?, 'l', ?, NULL, 't', 't', ?)",
                (sid, status, json.dumps({"id": sid, "behaviourAdapter": "llm"})))
    con.commit()
    con.close()


def test_freezing_copies_what_real_ran_and_nothing_half_done(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(modes, "RUNS_DIR", tmp_path)
    freeze = _freeze_module()
    monkeypatch.setattr(sys, "argv", ["freeze_sim.py"])

    assert freeze.main() == 2, "nothing to freeze before real has run"

    real = tmp_path / "real.sqlite3"
    Store(real)
    _session_row(real, "s-running", "collecting_reviews")
    assert freeze.main() == 1
    assert "s-running" in capsys.readouterr().out
    assert not (tmp_path / "sim.sqlite3").exists()

    con = sqlite3.connect(real)
    con.execute("UPDATE iteration_sessions SET status = 'ready_for_designer'")
    con.commit()
    con.close()
    assert freeze.main() == 0
    frozen = sqlite3.connect(tmp_path / "sim.sqlite3")
    assert frozen.execute("SELECT id FROM iteration_sessions").fetchall() == [("s-running",)]
    frozen.close()

    # An existing sim copy is replaced only when asked.
    assert freeze.main() == 1
    monkeypatch.setattr(sys, "argv", ["freeze_sim.py", "--replace"])
    assert freeze.main() == 0
