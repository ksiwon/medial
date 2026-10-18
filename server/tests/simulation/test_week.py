"""The week document keeps the research's rules, and a file that breaks one stops the read."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from app.simulation.week import DISCLAIMER, WEEK_DIR, WeekError, load_week


@pytest.fixture()
def copy(tmp_path: Path) -> Path:
    for name in ("briefs.json", "dialogue.json", "evaluations.json", "schedule.json"):
        shutil.copy(WEEK_DIR / name, tmp_path / name)
    return tmp_path


def edit(path: Path, change) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    change(data)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def test_the_stored_week_loads():
    week = load_week()
    assert [d["day"] for d in week["days"]] == ["월", "화", "수", "목", "금", "토", "일"]
    assert len(week["events"]) == 8
    # Some days hold two events and some none: the week is not one event a day.
    counts = [len(d["events"]) for d in week["days"]]
    assert 0 in counts and max(counts) >= 2


def test_an_emergency_has_no_choice_and_the_rest_do():
    by_id = {e["id"]: e for e in load_week()["events"]}
    assert by_id["E6"]["noChoice"] and by_id["E6"]["requests"] == []
    assert all(e["requests"] for e in by_id.values() if not e["noChoice"])


def test_every_request_says_how_well_the_residents_support_it():
    for event in load_week()["events"]:
        for request in event["requests"]:
            assert request["basis"]["verdict"] in {"direct", "weak"}
            if request["basis"]["verdict"] == "direct":
                assert request["basis"]["quote"] and request["basis"]["actor"]


def test_every_evaluation_is_simulated_and_cites_only_lines_the_resident_was_in():
    week = load_week()
    for event in week["events"]:
        pools = [event["before"]["evaluations"]] + [r["after"]["evaluations"] for r in event["requests"]]
        for pool in pools:
            for ev in pool:
                assert ev["source"] == "simulated" and ev["disclaimer"] == DISCLAIMER
                assert ev["claims"]
                for claim in ev["claims"]:
                    assert claim["kind"] in {"good", "bad", "neutral", "unknown", "wish"} and claim["citedLines"]


def test_a_citation_outside_what_the_resident_heard_stops_the_read(copy: Path):
    def cite_a_line_nobody_in_the_scene_heard(data):
        ev = next(v for v in data["evaluations"].values() if v["event"] == "E1" and v["variant"] == "before" and v["actor"] == "P1")
        ev["claims"][0]["citedLines"] = [1]  # line 1 is the AI and the head on the phone: P1 was not there

    edit(copy / "evaluations.json", cite_a_line_nobody_in_the_scene_heard)
    with pytest.raises(WeekError, match="겪지 않은 줄"):
        load_week(copy)


def test_a_claim_without_a_cited_line_stops_the_read(copy: Path):
    def uncite(data):
        next(iter(data["evaluations"].values()))["claims"][0]["citedLines"] = []

    edit(copy / "evaluations.json", uncite)
    with pytest.raises(WeekError, match="인용한 줄이 없습니다"):
        load_week(copy)


def test_an_unknown_claim_kind_stops_the_read(copy: Path):
    def retag(data):
        next(iter(data["evaluations"].values()))["claims"][0]["kind"] = "great"

    edit(copy / "evaluations.json", retag)
    with pytest.raises(WeekError, match="주장 종류"):
        load_week(copy)


def test_a_request_with_no_basis_stops_the_read(copy: Path):
    edit(copy / "evaluations.json", lambda d: d["links"]["E1.A"].update(verdict="none"))
    with pytest.raises(WeekError, match="근거를 찾지 못"):
        load_week(copy)


def test_an_evaluation_without_the_simulation_notice_stops_the_read(copy: Path):
    def strip(data):
        next(iter(data["evaluations"].values()))["disclaimer"] = ""

    edit(copy / "evaluations.json", strip)
    with pytest.raises(WeekError, match="시뮬레이션 표기"):
        load_week(copy)


def test_a_cause_placed_after_its_effect_stops_the_read(copy: Path):
    def swap(data):
        s = data["sessions"]["s1"]
        s["월"], s["일"] = s["일"], s["월"]

    edit(copy / "schedule.json", swap)
    with pytest.raises(WeekError, match="앞선 날"):
        load_week(copy)


def test_nothing_in_the_document_is_a_score():
    text = json.dumps(load_week(), ensure_ascii=False)
    for word in ("점수", "별점", "만족도"):
        assert word not in text.replace(DISCLAIMER, "")


def test_the_front_end_fixture_is_what_the_server_sends():
    """src/features/simulation/week/week.fixture.json is the screens' test input. If the week changes and the
    fixture does not, a screen test would be reading a week that no longer exists."""
    fixture = Path(__file__).resolve().parents[3] / "src" / "features" / "simulation" / "week" / "week.fixture.json"
    assert json.loads(fixture.read_text(encoding="utf-8")) == load_week(), (
        "week.fixture.json 이 서버가 내려주는 주와 다릅니다. 다시 만드세요: "
        "cd server && python -c \"import json;from app.simulation.week import load_week;"
        "open('../src/features/simulation/week/week.fixture.json','w',encoding='utf-8').write(json.dumps(load_week(),ensure_ascii=False,indent=1))\"")
