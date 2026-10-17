"""The exhibition server reads what was written ahead of time, and nothing else: it has no engine, no model client and
no way to start a run, so these are not rules it has to remember - they are what it is made of."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))

from fastapi.testclient import TestClient  # noqa: E402

from app.simulation.api.routes import create_app  # noqa: E402


def client() -> TestClient:
    return TestClient(create_app())


def test_it_says_it_is_alive_and_that_it_never_calls_a_model():
    body = client().get("/api/sim/health").json()
    assert body["status"] == "ok" and body["modelCalls"] == "none"


def test_it_serves_the_week_it_checked():
    week = client().get("/api/sim/week").json()
    assert len(week["events"]) == 8
    assert [d["day"] for d in week["days"]] == ["월", "화", "수", "목", "금", "토", "일"]


def test_a_week_that_breaks_a_rule_is_a_server_error_that_says_why_not_a_half_week(monkeypatch):
    from app.simulation.api import routes
    from app.simulation.week import WeekError

    def broken():
        raise WeekError("E1.A 는 주민 평가에서 근거를 찾지 못했습니다(연결 점검)")

    monkeypatch.setattr(routes, "load_week", broken)
    response = client().get("/api/sim/week")
    assert response.status_code == 500
    assert "근거를 찾지 못" in response.json()["detail"]


def test_it_reads_and_does_not_write():
    c = client()
    for path in ("/api/sim/attempts", "/api/sim/policies", "/api/sim/findings", "/api/sim/iteration/sessions", "/api/sim/week"):
        assert c.post(path, json={}).status_code == 403, path
    assert c.put("/api/sim/week", json={}).status_code == 403
    assert c.delete("/api/sim/week").status_code == 403


def test_the_only_writes_it_takes_are_the_two_relays_of_the_screens():
    c = client()
    assert c.post("/api/sim/stage/state", json={"phase": "idle"}).status_code != 403
    assert c.post("/api/sim/stage/command?token=wrong", json={"name": "start"}).status_code == 403  # refused for the token, not the rule


def test_a_picture_or_voice_that_does_not_exist_is_a_404_and_the_indexes_are_lists():
    c = client()
    assert c.get("/api/sim/village/art/NO_SUCH").status_code == 404
    assert c.get("/api/sim/village/voice/NO_SUCH.wav").status_code == 404
    assert isinstance(c.get("/api/sim/village/art").json()["names"], list)
    assert isinstance(c.get("/api/sim/village/voice").json()["lines"], dict)


def test_the_server_package_has_nothing_that_could_call_a_model():
    """No module of the server imports an HTTP client or reads a key: the words are written by scripts/gen_week_*.py."""
    root = REPO_ROOT / "server" / "app"
    for path in root.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        assert "OPENAI_API_KEY" not in text, path
        assert "api.openai.com" not in text, path
        assert "import httpx" not in text, path
