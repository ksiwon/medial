"""The field record has an order, and the record has to carry it (26번 F07·F08).

What each test names: an answer filed as independent after the person had
already been shown the model's; a family member's answer overwriting the
resident's; a conflict that could only be recorded as "partial"; a synthesis
sentence set aside with nothing to trace it back to.

No real person's data is created here. Every respondent below is a fabricated
pseudonymous id in an in-memory database, and the records say so.

    python -m pytest server/tests/simulation/test_field_protocol.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.simulation.iteration.contracts import (  # noqa: E402
    AgentReview,
    ExcludedClaim,
    ReviewItem,
    SessionStatus,
)
from app.simulation.iteration.synthesis import check_excluded  # noqa: E402

from test_iteration import P1_DECK, START, T_RES, iteration, run_session  # noqa: E402


def session_with_package():
    """A finished session, a decision, and the scene package it produced."""
    service = iteration()
    session = run_session(service, development_decks=[P1_DECK], max_generations=2)
    detail = service.detail(session.id)
    generation = detail["generations"][-1]
    result = service.decide(
        session.id, disposition="adopt_for_field_review",
        generation_id=generation["id"], reasons=["현장에서 물어볼 장면을 고른다"],
        supported_conditions=[], tradeoffs=[], dissent=[], unanswered=[])
    package = result["package"]
    assert package and package["episodes"], "장면이 있어야 이 검사가 의미가 있다"
    return service, session, package


def pre_response(service, session, package, *, respondent="RESP-01",
                 role="participant", kind="resident_response", episode=None):
    episode = episode or package["episodes"][0]
    return service.submit_human_review(session.id, {
        "packageId": package["id"], "reviewerRole": role,
        "elicitation": "pre_simulation_response",
        "respondentId": respondent, "respondentRole": "self" if role == "participant" else "family",
        "subjectActorId": episode["actorId"], "episodeId": episode["id"],
        "selectedEpisodeIds": [episode["id"]],
        "responses": [{"question": episode["preQuestion"], "answer": "직접 가 봤을 것 같다"}],
        "responseStage": "pre_disclosure", "responseKind": kind,
        "consentScope": "이 연구 내 기록",
    })


# ------------------------------------------------- independence, then comparison
def test_a_comparison_answer_without_a_recorded_disclosure_is_refused():
    service, session, package = session_with_package()
    episode = package["episodes"][0]
    with pytest.raises(ValueError) as excinfo:
        service.submit_human_review(session.id, {
            "packageId": package["id"], "reviewerRole": "participant",
            "elicitation": "after_simulation_response",
            "respondentId": "RESP-01", "episodeId": episode["id"],
            "responseStage": "post_disclosure", "correspondence": "agreement",
        })
    assert "공개" in str(excinfo.value)


def test_a_disclosure_cannot_be_recorded_before_the_independent_answer():
    service, session, package = session_with_package()
    episode = package["episodes"][0]
    with pytest.raises(ValueError) as excinfo:
        service.record_disclosure(session.id, {
            "packageId": package["id"], "episodeId": episode["id"],
            "respondentId": "RESP-01"})
    assert "공개 전 독립 응답" in str(excinfo.value)


def test_a_pre_disclosure_answer_may_not_carry_a_correspondence():
    service, session, package = session_with_package()
    episode = package["episodes"][0]
    with pytest.raises(ValueError):
        service.submit_human_review(session.id, {
            "packageId": package["id"], "reviewerRole": "participant",
            "elicitation": "pre_simulation_response",
            "respondentId": "RESP-01", "episodeId": episode["id"],
            "responseStage": "pre_disclosure", "correspondence": "agreement",
        })


def test_the_whole_order_runs_and_is_preserved():
    service, session, package = session_with_package()
    episode = package["episodes"][0]
    first = pre_response(service, session, package)
    assert first["correspondence"] is None
    assert first["responseStage"] == "pre_disclosure"

    disclosure = service.record_disclosure(session.id, {
        "packageId": package["id"], "episodeId": episode["id"],
        "respondentId": "RESP-01",
        "shownReviewIds": [episode["simulatedReviewId"]] if episode["simulatedReviewId"] else []})
    assert disclosure["disclosedAt"]
    assert "무편향 응답을 보증하지 않는다" in disclosure["note"]

    after = service.submit_human_review(session.id, {
        "packageId": package["id"], "reviewerRole": "participant",
        "elicitation": "after_simulation_response",
        "respondentId": "RESP-01", "episodeId": episode["id"],
        "subjectActorId": episode["actorId"],
        "selectedEpisodeIds": [episode["id"]],
        "responseStage": "post_disclosure",
        "disclosureRecordId": disclosure["id"],
        "correspondence": "disagreement",
        "correctionTarget": "behaviour_model",
        "reason": "그 시간에는 그렇게 하지 않는다",
        "responses": [{"question": episode["postQuestion"], "answer": "다르다"}],
    })
    assert after["correspondence"] == "disagreement", "명시적 충돌을 적을 수 있어야 한다"
    assert after["correctionTarget"] == "behaviour_model"

    detail = service.detail(session.id)
    stages = [row["responseStage"] for row in detail["humanReviews"]]
    assert stages == ["pre_disclosure", "post_disclosure"], "순서가 보존되어야 한다"
    assert len(detail["disclosures"]) == 1


def test_a_family_answer_is_its_own_record_and_does_not_overwrite_the_resident():
    service, session, package = session_with_package()
    episode = package["episodes"][0]
    pre_response(service, session, package, respondent="RESP-01")
    pre_response(service, session, package, respondent="RESP-02", role="family")
    rows = service.detail(session.id)["humanReviews"]
    assert len(rows) == 2
    assert {r["respondentId"] for r in rows} == {"RESP-01", "RESP-02"}
    # Both speak *about* the same modelled resident; neither is that resident.
    assert {r["subjectActorId"] for r in rows} == {episode["actorId"]}
    assert {r["respondentRole"] for r in rows} == {"self", "family"}


def test_a_researcher_note_is_human_but_not_a_resident_response():
    service, session, package = session_with_package()
    note = pre_response(service, session, package, respondent="RESEARCHER-1",
                        role="researcher_note", kind="researcher_note")
    assert note["source"] == "human"
    assert note["responseKind"] == "researcher_note"
    rows = service.detail(session.id)["humanReviews"]
    residents = [r for r in rows if r["responseKind"] == "resident_response"]
    assert residents == [], "연구자 메모를 주민 응답으로 세지 않는다"


def test_nothing_human_exists_until_a_person_submits():
    service, session, package = session_with_package()
    assert service.detail(session.id)["humanReviews"] == []
    assert service.detail(session.id)["disclosures"] == []


# --------------------------------------------- what the synthesis set aside (F08)
def _review(review_id: str, *, refs: list[str]) -> AgentReview:
    return AgentReview(
        id=review_id, attemptId="att-1", actorId="P1", actorRole="resident",
        policyRevisionId=START, adapter="rule", usageStatus="used",
        items=[ReviewItem(dimension="help_resolution", assessment="negative",
                          reason="확인이 늦었다", eventRefs=refs)],
        overallNarrative="", createdAt="now")


def test_an_excluded_claim_that_cites_nothing_is_marked_as_the_synthesis_own():
    reviews = [_review("rev-1", refs=["ev-1"])]
    checked = check_excluded(
        [ExcludedClaim(id="e1", claim="경험 없는 주민 대부분은 중립일 것이다")], reviews)
    assert checked[0].technicalCheck == "no_refs"
    assert "종합이 스스로 만든 주장" in checked[0].reason
    assert checked[0].semanticReview == "unreviewed"
    assert checked[0].labelledBy == "none"


def test_an_excluded_claim_pointing_at_a_real_item_keeps_the_link():
    reviews = [_review("rev-1", refs=["ev-1"])]
    checked = check_excluded(
        [ExcludedClaim(id="e1", claim="근거 없음", reviewItemRefs=["rev-1#0"])], reviews)
    assert checked[0].technicalCheck == "refs_exist"
    # The machine says the reference exists. It does not say the event supports
    # the sentence, and the label stays open for a person.
    assert checked[0].semanticReview == "unreviewed"


def test_an_excluded_claim_pointing_at_a_missing_item_says_so():
    reviews = [_review("rev-1", refs=["ev-1"])]
    checked = check_excluded(
        [ExcludedClaim(id="e1", claim="근거 없음", reviewItemRefs=["rev-9#3"])], reviews)
    assert checked[0].technicalCheck == "refs_missing"
    assert "rev-9#3" in checked[0].reason


def test_a_session_synthesis_carries_its_excluded_claims_with_refs():
    service = iteration()
    session = run_session(service, development_decks=[P1_DECK], max_generations=2)
    synthesis = service.detail(session.id)["generations"][0]["synthesis"]
    assert synthesis is not None
    for claim in synthesis["excludedClaims"]:
        assert claim["labelledBy"] in ("none", "human", "ai_draft")
        assert claim["semanticReview"] == "unreviewed" or claim["labelledBy"] == "human"
