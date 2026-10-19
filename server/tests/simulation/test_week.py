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


def test_every_rule_is_said_in_words_and_a_request_says_what_it_changes():
    for event in load_week()["events"]:
        now = {r["type"]: r["sentence"] for r in event["rules"]}
        assert all(r["label"] and r["sentence"] for r in event["rules"])
        for request in event["requests"]:
            for change in request["rules"]:
                # The judgment panel shows the event's rule and, once chosen, the request's change to it.
                assert now[change["type"]] == change["beforeSentence"]
                assert change["afterSentence"] and change["afterSentence"] != change["beforeSentence"]
    by_id = {e["id"]: e for e in load_week()["events"]}
    assert by_id["E6"]["rules"] == []


def test_requests_that_disagree_about_how_the_ai_ran_stop_the_read(copy: Path):
    def change(data):
        e1 = next(e for e in data["events"] if e["id"] == "E1")
        e1["requests"]["C"]["rules"].append({"type": "disclosure_scope", "before": {"level": "minimal"}, "after": {"level": "named"}})
    edit(copy / "briefs.json", change)
    with pytest.raises(WeekError, match="수정 전 값"):
        load_week(copy)


def test_a_rule_nobody_wrote_a_sentence_for_stops_the_read(copy: Path):
    def change(data):
        e1 = next(e for e in data["events"] if e["id"] == "E1")
        e1["requests"]["A"]["rules"][0]["type"] = "no_such_rule"
    edit(copy / "briefs.json", change)
    with pytest.raises(WeekError, match="말로 옮길 수 없습니다"):
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


def test_a_version_may_offer_requests_of_its_own(copy: Path):
    week = load_week(copy)
    event = next(e for e in week["events"] if e["id"] == "E1")
    first = next(r for r in event["requests"] if r["id"] == "A")
    assert [r["id"] for r in first["after"]["requests"]] == ["B", "C"]
    # A request on the last version offers nothing more; the document says so with an empty list, not a missing key.
    assert first["after"]["requests"][0]["after"]["requests"] == []
    # Every version of E1, E4 and E5 offers two requests of its own (a choice, not one card to accept), except
    # E5's first, where the residents' words left no second request with a basis; the other events stop at ver2.
    deeper = {e["id"] for e in week["events"] if any(r["after"]["requests"] for r in e["requests"])}
    assert deeper == {"E1", "E4", "E5"}
    for e in week["events"]:
        if e["id"] in deeper:
            for r in e["requests"]:
                want = 1 if (e["id"], r["id"]) == ("E5", "A") else 2
                assert len(r["after"]["requests"]) == want, (e["id"], r["id"])


def test_a_request_on_a_later_version_must_start_from_how_the_ai_ran_on_it(copy: Path):
    edit(copy / "briefs.json", lambda d: next(e for e in d["events"] if e["id"] == "E1")["requests"]["A"]["requests"]["B"]["rules"][0]["before"].update(count=99))
    with pytest.raises(WeekError, match="앞 버전이 돌던 값"):
        load_week(copy)


def test_a_request_on_a_later_version_needs_its_own_basis_too(copy: Path):
    edit(copy / "evaluations.json", lambda d: d["links"].update({"E1.A.B": {**d["links"]["E1.A.B"], "verdict": "none"}}))
    with pytest.raises(WeekError, match="E1.A.B"):
        load_week(copy)
