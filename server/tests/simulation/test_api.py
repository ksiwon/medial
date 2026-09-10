"""HTTP surface tests.

The API is where a wrong contract does the most damage - the screen believes
whatever it is handed - so the checks here are about refusals as much as about
successes: an unsupported policy field must come back 400, a reused commandId
with different arguments 409, and a fork must report where it branched.
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))

from fastapi.testclient import TestClient  # noqa: E402

from app.simulation.api.routes import create_app, set_service  # noqa: E402
from app.simulation.persistence.store import Store  # noqa: E402
from app.simulation.service import SimulationService  # noqa: E402
from app.simulation.village import load_village  # noqa: E402

SYNTHETIC = REPO_ROOT / "fixtures" / "synthetic" / "village.synthetic.json"
SYNTHETIC_PERSONAS = str(REPO_ROOT / "fixtures" / "synthetic" / "personas.synthetic.json")
DECK_ID = "deck-p1-no-response-v1"
RES_ID = "assumed-resources-v1"


def client() -> TestClient:
    set_service(SimulationService(store=Store(":memory:"),
                                  village=load_village(SYNTHETIC),
                                  persona_path=SYNTHETIC_PERSONAS))
    return TestClient(create_app())


def make_attempt(api: TestClient, policy_id: str = "policy-A-v1") -> str:
    response = api.post("/api/sim/attempts", json={
        "policyId": policy_id, "scenarioDeckId": DECK_ID,
        "resourceRevisionId": RES_ID})
    assert response.status_code == 200, response.text
    return response.json()["attempt"]["id"]


def test_health_says_no_model_is_called():
    api = client()
    body = api.get("/api/sim/health").json()
    assert body["status"] == "ok"
    assert body["modelCalls"] == "none"


def test_the_catalog_publishes_the_editable_policy_fields():
    api = client()
    body = api.get("/api/sim/catalog").json()
    spec = body["policyFields"]
    assert spec["supported"]
    names = {f["name"] for f in spec["fields"]}
    assert names == set(spec["supported"]), \
        "the form is built from this; it cannot offer a field the engine ignores"
    assert {d["id"] for d in body["decks"]} >= {DECK_ID, "deck-p9-transport-v1"}


def test_an_unsupported_policy_field_is_a_400():
    api = client()
    response = api.post("/api/sim/policies", json={
        "baseId": "policy-A-v1", "reason": "미지원 필드",
        "params": {"notAThing": 1}})
    assert response.status_code == 400
    assert "notAThing" in response.json()["detail"]


def test_an_out_of_range_policy_value_is_a_400():
    api = client()
    response = api.post("/api/sim/policies", json={
        "baseId": "policy-A-v1", "reason": "범위 밖", "params": {"retryCount": 99}})
    assert response.status_code == 400


def test_editing_a_policy_then_running_it():
    api = client()
    revision = api.post("/api/sim/policies", json={
        "baseId": "policy-B-v1", "reason": "재연락 1회로 줄여 본다",
        "params": {"retryCount": 1}}).json()
    assert revision["parentId"] == "policy-B-v1"

    attempt = api.post("/api/sim/attempts", json={
        "policyId": revision["id"], "scenarioDeckId": DECK_ID,
        "resourceRevisionId": RES_ID}).json()
    assert attempt["attempt"]["policyId"] == revision["id"]
    assert attempt["policy"]["params"]["retryCount"] == 1


def test_rerun_and_fork_are_separate_endpoints_with_separate_labels():
    api = client()
    parent = make_attempt(api)
    events = api.get("/api/sim/attempts/%s/events" % parent).json()["events"]
    at_seq = next(e["seq"] for e in events if e["type"] == "request.offered")

    rerun = api.post("/api/sim/attempts/%s/rerun" % parent, json={
        "reason": "초기 상태에서 정책만 바꾼다", "params": {"helperContactCap": 0}}).json()
    assert rerun["attempt"]["lineage"] == "rerun"
    assert rerun["attempt"]["parentSeq"] is None
    assert "재실행" in rerun["lineageNote"]

    fork = api.post("/api/sim/attempts/%s/fork" % parent, json={
        "reason": "이 시점 이후만 바꾼다", "atSeq": at_seq,
        "params": {"helperContactCap": 0}}).json()
    assert fork["attempt"]["lineage"] == "fork"
    assert fork["attempt"]["parentSeq"] == at_seq
    assert "체크포인트" in fork["lineageNote"]


def test_a_reused_command_id_with_other_arguments_is_a_409():
    api = client()
    attempt_id = make_attempt(api)
    url = "/api/sim/attempts/%s/commands" % attempt_id
    assert api.post(url, json={"commandId": "c1", "name": "seek", "seq": 3}
                    ).json()["cursorSeq"] == 3
    assert api.post(url, json={"commandId": "c1", "name": "seek", "seq": 3}
                    ).json()["deduplicated"] is True
    clash = api.post(url, json={"commandId": "c1", "name": "seek", "seq": 8})
    assert clash.status_code == 409


def test_snapshot_takes_a_cursor_seq():
    api = client()
    attempt_id = make_attempt(api)
    events = api.get("/api/sim/attempts/%s/events" % attempt_id).json()["events"]
    target = events[4]
    body = api.get("/api/sim/attempts/%s/snapshot" % attempt_id,
                   params={"seq": target["seq"]}).json()
    assert body["cursorSeq"] == target["seq"]
    assert body["atMs"] == target["simTimeMs"]
    assert api.get("/api/sim/attempts/%s/snapshot" % attempt_id).status_code == 400


def test_personas_are_served_without_names_or_quotes():
    api = client()
    body = api.get("/api/sim/personas").json()
    assert body["provenance"]["dataSource"] == "synthetic"
    assert len(body["profiles"]) == 12
    blob = api.get("/api/sim/personas").text
    raw = (REPO_ROOT / "fixtures" / "synthetic" / "personas.synthetic.json")
    import json as _json
    for person in _json.loads(raw.read_text(encoding="utf-8"))["페르소나"]:
        assert person["이름"] not in blob


def test_observations_are_served_per_actor():
    api = client()
    attempt_id = make_attempt(api)
    body = api.get("/api/sim/attempts/%s/observations" % attempt_id,
                   params={"actorId": "P6"}).json()
    assert body["observations"]
    assert {o["actorId"] for o in body["observations"]} == {"P6"}


def test_the_finding_loop_over_http():
    api = client()
    a = make_attempt(api)
    b = make_attempt(api, "policy-B-v1")
    compare = api.get("/api/sim/compare", params={"ids": "%s,%s" % (a, b)}).json()
    assert compare["controlled"] is True

    finding = api.post("/api/sim/findings", json={
        "coreItem": "누구의 시간으로 확인할 것인가",
        "comparedAttemptIds": [a, b],
        "observation": "B는 대기가 길다",
        "interpretation": "기관 경로는 시간을 늘린다",
        "nextChange": "이웃 연락 상한을 0으로",
        "fromPolicyId": "policy-A-v1"}).json()

    applied = api.post("/api/sim/findings/%s/apply" % finding["id"], json={
        "attemptId": a, "mode": "rerun", "params": {"helperContactCap": 0}}).json()
    assert applied["attempt"]["lineage"] == "rerun"

    stored = api.get("/api/sim/findings").json()["findings"][0]
    assert stored["resultingAttemptId"] == applied["attempt"]["id"]


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


# ================================================================ iteration API
ITER_START = "policy-IT-v0"
T_RES_ID = "assumed-resources-transport-v1"
T_DECK_ID = "deck-p9-transport-v1"


def make_session(api: TestClient, **overrides) -> str:
    body = {
        "label": "리뷰 기반 반복",
        "coreItem": "응답이 없거나 이동이 필요할 때 누구의 시간을 쓰는가",
        "basePolicyId": ITER_START,
        "developmentDeckRefs": [DECK_ID, T_DECK_ID],
        "resourceRevisionId": T_RES_ID,
    }
    body.update(overrides)
    response = api.post("/api/sim/iteration/sessions", json=body)
    assert response.status_code == 200, response.text
    return response.json()["session"]["id"]


def test_the_capability_report_does_not_oversell_the_build():
    api = client()
    body = api.get("/api/sim/iteration/capabilities").json()
    assert body["modes"]["longitudinal"] is False
    assert body["notImplemented"]
    assert body["model"]["configured"] is False
    assert "super" not in repr(body), "설명에 키가 들어가면 안 된다"


def test_the_whole_loop_over_http():
    api = client()
    session_id = make_session(api)
    started = api.post("/api/sim/iteration/sessions/%s/commands" % session_id,
                       json={"commandId": "c1", "name": "start", "blocking": True})
    assert started.status_code == 200, started.text
    session = started.json()["session"]
    assert session["stopReason"], "왜 멈췄는지 항상 남는다"

    generations = api.get("/api/sim/iteration/sessions/%s/generations"
                          % session_id).json()
    assert sorted({g["index"] for g in generations["generations"]}) == [0, 1, 2]
    assert generations["criteria"]["criteria"], "고정된 비교 기준이 함께 나온다"

    detail = api.get("/api/sim/iteration/sessions/%s" % session_id).json()
    root = next(g for g in detail["generations"] if g["index"] == 0)
    assert root["reviews"] and root["synthesis"] and root["proposals"]
    assert detail["modelCalls"] == [], "rule 어댑터는 모델을 호출하지 않는다"


def test_starting_twice_is_a_conflict_not_a_second_run():
    api = client()
    session_id = make_session(api, developmentDeckRefs=[DECK_ID],
                              resourceRevisionId=RES_ID)
    api.post("/api/sim/iteration/sessions/%s/commands" % session_id,
             json={"commandId": "c1", "name": "start", "blocking": True})
    again = api.post("/api/sim/iteration/sessions/%s/commands" % session_id,
                     json={"commandId": "c2", "name": "start", "blocking": True})
    assert again.status_code == 409


def test_an_online_adapter_without_a_key_is_a_400():
    api = client()
    response = api.post("/api/sim/iteration/sessions", json={
        "label": "온라인", "coreItem": "c", "basePolicyId": ITER_START,
        "developmentDeckRefs": [DECK_ID], "resourceRevisionId": RES_ID,
        "reviewAdapter": "llm"})
    assert response.status_code == 400
    assert "키" in response.json()["detail"]


def test_human_review_provenance_over_http():
    api = client()
    session_id = make_session(api, developmentDeckRefs=[DECK_ID],
                              resourceRevisionId=RES_ID)
    api.post("/api/sim/iteration/sessions/%s/commands" % session_id,
             json={"commandId": "c1", "name": "start", "blocking": True})
    detail = api.get("/api/sim/iteration/sessions/%s" % session_id).json()
    generation_id = detail["generations"][0]["id"]

    before = api.get("/api/sim/iteration/sessions/%s/human-reviews" % session_id).json()
    assert before["humanReviews"] == [], "사람이 내기 전에는 human 데이터가 없다"

    package = api.post("/api/sim/iteration/sessions/%s/field-package/%s"
                       % (session_id, generation_id)).json()
    assert package["episodes"]
    submitted = api.post("/api/sim/iteration/sessions/%s/human-reviews" % session_id,
                         json={"packageId": package["id"],
                               "reviewerRole": "participant",
                               "elicitation": "pre_simulation_response",
                               "selectedEpisodeIds": [package["episodes"][0]["id"]],
                               "responses": [{"q": "실제로는?", "a": "직접 갔을 것"}],
                               "agreement": "correction"})
    assert submitted.status_code == 200
    assert submitted.json()["source"] == "human"

    bad = api.post("/api/sim/iteration/sessions/%s/human-reviews" % session_id,
                   json={"packageId": package["id"], "reviewerRole": "participant",
                         "elicitation": "concept_review",
                         "selectedEpisodeIds": ["epi-nope"]})
    assert bad.status_code == 400


def test_a_designer_decision_records_its_reasons_and_dissent():
    api = client()
    session_id = make_session(api, developmentDeckRefs=[DECK_ID],
                              resourceRevisionId=RES_ID)
    api.post("/api/sim/iteration/sessions/%s/commands" % session_id,
             json={"commandId": "c1", "name": "start", "blocking": True})
    detail = api.get("/api/sim/iteration/sessions/%s" % session_id).json()
    generation_id = detail["generations"][0]["id"]

    response = api.post("/api/sim/iteration/sessions/%s/decision" % session_id, json={
        "disposition": "adopt_for_field_review", "generationId": generation_id,
        "reasons": ["이웃 부담이 가장 낮다"], "tradeoffs": ["대기가 길어질 수 있다"],
        "dissent": ["P6는 반대로 평가했다"], "unansweredQuestions": ["실제 응답 의사"]})
    assert response.status_code == 200, response.text
    decision = response.json()["decision"]
    assert decision["chosenGenerationId"] == generation_id
    assert decision["dissent"] and decision["unansweredQuestions"]
    assert response.json()["package"]["episodes"]

    holding = api.post("/api/sim/iteration/sessions/%s/decision" % session_id, json={
        "disposition": "adopt_for_field_review", "reasons": ["세대를 안 골랐다"]})
    assert holding.status_code == 400
