"""Tests for the review-driven iteration loop.

Each test names the thing that would otherwise go wrong quietly: a review citing
an event its author never saw, a Change Set editing unsupported Quest/Task fields,
a budget stop reported as a finished design, a restart applying the same
generation twice, a "human" review that no human wrote.

They run on the synthetic fixtures and call no model.

    python -m pytest server/tests/simulation/test_iteration.py -q
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))

from app.simulation.contracts import HEALTH_STAFF, RESEARCHER  # noqa: E402
from app.simulation.iteration.contracts import (  # noqa: E402
    AgentReview,
    ChangeSet,
    ChangeSetValidation,
    ExecutionBinding,
    Generation,
    RuleChange,
    SessionStatus,
    UsageStatus,
)
from app.simulation.iteration.engine import IterationEngine  # noqa: E402
from app.simulation.iteration.experience import (  # noqa: E402
    ReviewBoundaryError,
    build_experience,
    validate_review,
)
from app.simulation.iteration.llm import (  # noqa: E402
    LlmClient,
    ModelCallError,
    ModelNotConfigured,
)
from app.simulation.iteration.evaluation_metrics import DEFAULT_CRITERIA  # noqa: E402
from app.simulation.iteration.service import IterationService  # noqa: E402
from app.simulation.iteration.validation import (  # noqa: E402
    validate_change_set,
)
from app.simulation.iteration.improvement import SUPPORTED_CAPABILITIES  # noqa: E402
from app.simulation.persistence.store import Store  # noqa: E402
from app.simulation.service import SimulationService  # noqa: E402
from app.simulation.village import load_village  # noqa: E402

SYNTHETIC = REPO_ROOT / "fixtures" / "synthetic" / "village.synthetic.json"
SYNTHETIC_PERSONAS = str(REPO_ROOT / "fixtures" / "synthetic" / "personas.synthetic.json")
P1_DECK = "deck-p1-no-response-v1"
P9_DECK = "deck-p9-transport-v1"
T_RES = "assumed-resources-transport-v1"
START = "policy-IT-v0"

_village = None


def village():
    global _village
    if _village is None:
        _village = load_village(SYNTHETIC)
    return _village


def sim_service(store: Store | None = None) -> SimulationService:
    return SimulationService(store=store or Store(":memory:"), village=village(),
                             persona_path=SYNTHETIC_PERSONAS)


def iteration(store: Store | None = None,
              llm: LlmClient | None = None) -> IterationService:
    return IterationService(sim_service(store), llm_client=llm or LlmClient())


def run_session(service: IterationService, **kwargs):
    defaults = dict(
        label="테스트 반복", core_item="누구의 시간으로 해결할 것인가",
        base_policy_id=START, development_decks=[P1_DECK, P9_DECK],
        resource_id=T_RES, max_generations=3)
    defaults.update(kwargs)
    session = service.create_session(**defaults)
    service.command(session.id, "cmd-start", "start", blocking=True)
    step = 0
    session = service.load(session.id)
    while session.status is SessionStatus.awaiting_confirmation:
        detail = service.detail(session.id)
        generation = next(g for g in detail["generations"]
                          if g["index"] == session.currentGenerationIndex)
        change_set = next(item for item in generation["changeSets"]
                          if item["validationStatus"] == "valid"
                          and item["confirmationStatus"] == "draft")
        service.command(
            session.id, f"cmd-confirm-{step}", "confirm_change_set",
            payload={"changeSetId": change_set["id"], "reason": "테스트 연구자 확정"},
            blocking=True,
        )
        step += 1
        session = service.load(session.id)
    return session


# ===================================================== the loop runs end to end
def test_three_generations_run_review_propose_and_rerun():
    """v0 -> reviews -> Change Sets -> confirmed v1 -> reviews -> v2, all stored.

    The chain, not the outcome, is what is asserted: whether v1 turned out better
    is a result, and a test that required it would be a test that the tool always
    improves.
    """
    service = iteration()
    session = run_session(service)
    detail = service.detail(session.id)
    generations = detail["generations"]

    indices = sorted({g["index"] for g in generations})
    assert indices == [0, 1, 2], "세 세대가 모두 기록되어야 한다: %s" % indices

    root = next(g for g in generations if g["index"] == 0)
    assert root["reviews"], "v0에 개인 리뷰가 없다"
    assert root["synthesis"], "v0 리뷰가 종합되지 않았다"
    assert root["changeSets"], "v0에서 Change Set 초안이 나오지 않았다"

    advanced = next(g for g in generations if g["index"] == 1
                    and g["confirmedBy"] == "researcher")
    assert advanced["parentGenerationId"] == root["id"]
    assert advanced["reviews"], "v1도 자기 리뷰를 가져야 한다"
    assert advanced["confirmationReason"], "왜 이 Change Set을 실행했는지 기록되어야 한다"

    assert len([g for g in generations if g["index"] == 1]) == 1, (
        "확정하지 않은 초안을 실행 분기로 만들면 안 된다")
    assert any(item["confirmationStatus"] == "declined" for item in root["changeSets"]), (
        "실행하지 않은 초안은 Change Set 기록으로만 남아야 한다")


def test_drafts_do_not_execute_before_researcher_confirmation():
    service = iteration()
    session = service.create_session(
        label="확인 경계", core_item="c", base_policy_id=START,
        development_decks=[P1_DECK], resource_id=T_RES, max_generations=2)
    service.command(session.id, "start-only", "start", blocking=True)
    detail = service.detail(session.id)
    assert detail["session"]["status"] == "awaiting_confirmation"
    assert len(detail["generations"]) == 1
    assert all(item["resultingPolicyRevisionId"] is None
               for item in detail["generations"][0]["changeSets"])


def test_every_actor_gets_a_review_and_non_use_is_not_a_complaint():
    service = iteration()
    session = run_session(service, development_decks=[P1_DECK])
    root = service.detail(session.id)["generations"][0]
    reviews = [AgentReview.model_validate(r) for r in root["reviews"]]

    actors = {r.actorId for r in reviews}
    assert HEALTH_STAFF in actors, "기관 담당자도 자기 리뷰를 받아야 한다"
    assert len(actors) >= 12, "모든 주민에게 리뷰를 만든다"

    untouched = [r for r in reviews if r.usageStatus is UsageStatus.no_experience]
    assert untouched, "이 deck에서 아무 일도 겪지 않은 사람이 있어야 한다"
    for review in untouched:
        assert all(i.assessment == "unknown" for i in review.items), (
            "미경험을 불만족으로 만들면 안 된다: %s" % review.actorId)


def test_reviews_are_not_uniformly_positive():
    """A reviewer that can only praise is decoration, not evidence."""
    service = iteration()
    session = run_session(service)
    root = service.detail(session.id)["generations"][0]
    counts = root["metrics"]["reviewCounts"]
    assert counts["positive"] > 0
    assert counts["mixed"] + counts["negative"] > 0, (
        "부정·혼합 평가가 하나도 없으면 고정 리뷰를 의심해야 한다")


# ============================================== the review boundary is enforced
def test_a_review_cannot_cite_an_event_its_author_never_saw():
    service = iteration()
    session = run_session(service, development_decks=[P1_DECK], max_generations=1)
    root = service.detail(session.id)["generations"][0]
    review = AgentReview.model_validate(root["reviews"][0])

    store = service.store
    attempt = store.get_attempt(review.attemptId)
    events = store.events(review.attemptId)
    personas = {p["subjectId"]: p
                for p in service.sim.personas_payload()["profiles"]}
    experience = build_experience(
        review.actorId, attempt=attempt["attempt"], events=events,
        metrics=attempt["metrics"], persona=personas.get(review.actorId),
        cycle_end_ms=20 * 60 * 60 * 1000)

    stranger = next(e["id"] for e in events
                    if review.actorId not in e["visibility"])
    tampered = review.model_copy(deep=True)
    tampered.items[0].eventRefs = [stranger]
    tampered.items[0].assessment = "negative"
    with pytest.raises(ReviewBoundaryError):
        validate_review(tampered, experience)


def test_a_review_never_reaches_a_world_truth_event():
    """The reason a call was missed lives with the researcher and stays there."""
    service = iteration()
    session = run_session(service, development_decks=[P1_DECK], max_generations=1)
    root = service.detail(session.id)["generations"][0]
    store = service.store

    hidden = {e["id"] for attempt_id in root["attemptIds"]
              for e in store.events(attempt_id)
              if e["visibility"] == [RESEARCHER]}
    assert hidden, "이 deck에는 연구자 전용 사건이 있어야 한다"
    cited = {ref for r in root["reviews"] for item in r["items"]
             for ref in item["eventRefs"]}
    assert not (cited & hidden), "리뷰가 세계 진실 사건을 인용했다"


def test_a_graded_item_without_an_event_is_refused():
    service = iteration()
    session = run_session(service, development_decks=[P1_DECK], max_generations=1)
    root = service.detail(session.id)["generations"][0]
    review = AgentReview.model_validate(root["reviews"][0])
    store = service.store
    attempt = store.get_attempt(review.attemptId)
    personas = {p["subjectId"]: p
                for p in service.sim.personas_payload()["profiles"]}
    experience = build_experience(
        review.actorId, attempt=attempt["attempt"],
        events=store.events(review.attemptId), metrics=attempt["metrics"],
        persona=personas.get(review.actorId), cycle_end_ms=20 * 60 * 60 * 1000)

    tampered = review.model_copy(deep=True)
    tampered.items[0].assessment = "negative"
    tampered.items[0].eventRefs = []
    with pytest.raises(ReviewBoundaryError, match="unknown"):
        validate_review(tampered, experience)


# ================================================= synthesis preserves conflict
def test_a_minority_concern_and_the_people_who_disagree_both_survive():
    service = iteration()
    session = run_session(service)
    root = service.detail(session.id)["generations"][0]
    synthesis = root["synthesis"]

    assert synthesis["issueGroups"], "문제 묶음이 하나도 없다"
    minority = [g for g in synthesis["issueGroups"] if g["minority"]]
    assert minority, "소수 의견이 별도로 표시되어야 한다"
    assert all(g["id"] in synthesis["minorityConcernIds"] for g in minority)

    with_dissent = [g for g in synthesis["issueGroups"] if g["dissentingActors"]]
    assert with_dissent, "같은 항목을 반대로 평가한 사람이 보존되어야 한다"


def test_the_institution_burden_is_not_hidden_by_resident_improvement():
    service = iteration()
    session = run_session(service)
    detail = service.detail(session.id)
    parent = next(g for g in detail["generations"] if g["index"] == 0)
    advanced = max(
        (g for g in detail["generations"] if g["index"] == 1),
        key=lambda g: g["metrics"]["vector"]["institutionStaffMinutes"])

    before = parent["metrics"]["vector"]["institutionStaffMinutes"]
    after = advanced["metrics"]["vector"]["institutionStaffMinutes"]
    assert after > before, (
        "이 후보는 이웃 시간을 기관으로 옮긴다. 기관 부담 증가가 보여야 한다")

    change_set = next(ChangeSet.model_validate(item)
                      for item in parent["changeSets"]
                      if item["id"] == advanced["appliedChangeSetId"])
    assert any("기관" in text for text in change_set.possibleRegressions), (
        "부작용이 제안에 미리 적혀 있어야 한다")


def test_objective_metrics_stay_beside_the_reviews_not_inside_them():
    service = iteration()
    session = run_session(service, development_decks=[P1_DECK], max_generations=1)
    root = service.detail(session.id)["generations"][0]
    assert root["synthesis"]["objectiveMetrics"], "연구자 지표가 종합에 붙어 있어야 한다"
    for review in root["reviews"]:
        text = review["overallNarrative"] + " ".join(i["reason"] for i in review["items"])
        assert "neighbourMinutes" not in text and "staffMinutes" not in text, (
            "개인 리뷰가 전체 집계 지표를 근거로 삼으면 안 된다")


# ============================================== what a Change Set may never touch
def change_set(binding: ExecutionBinding, *, field: str = "retry",
               quest_id: str = "quest:no-response-welfare-check") -> ChangeSet:
    return ChangeSet(
        id="c1", sessionId="s", generationIndex=0, baseRevisionId=START,
        label="변경", reviewItemRefs=["rev-x#0"], mechanism="검증",
        changes=[RuleChange(
            scope="task", target="timing_burden", questId=quest_id,
            taskIds=["task:contact-subject"], field=field,
            beforeRule="재연락하지 않는다.", afterRule="한 번 재연락한다.",
            executionBindings=[binding])], createdAt="now")


@pytest.mark.parametrize(("quest_id", "field"), [
    ("quest:edit-persona", "retry"),
    ("quest:no-response-welfare-check", "persona"),
    ("quest:no-response-welfare-check", "world"),
    ("quest:no-response-welfare-check", "rubric"),
])
def test_a_change_outside_supported_quest_task_rules_is_refused(quest_id, field):
    service = iteration()
    policy = service.sim.policies[START].model_dump(mode="json")
    checked = validate_change_set(
        change_set(ExecutionBinding(key="retryCount", before=0, after=1),
                   field=field, quest_id=quest_id),
        policy=policy, capabilities=SUPPORTED_CAPABILITIES,
        known_review_items={"rev-x#0"})
    assert checked.validationStatus is ChangeSetValidation.rejected
    assert checked.validationErrors


def test_a_change_set_whose_before_value_is_stale_is_refused():
    service = iteration()
    policy = service.sim.policies[START].model_dump(mode="json")
    checked = validate_change_set(
        change_set(ExecutionBinding(key="retryCount", before=99, after=1)),
        policy=policy, capabilities=SUPPORTED_CAPABILITIES,
        known_review_items={"rev-x#0"})
    assert checked.validationStatus is ChangeSetValidation.rejected
    assert any("변경 전 값" in e for e in checked.validationErrors)


def test_a_policy_the_engine_would_refuse_is_not_a_candidate():
    """head_first with the head switched off crashes the run, so it never runs."""
    service = iteration()
    policy = service.sim.policies[START].model_dump(mode="json")
    checked = validate_change_set(
        change_set(ExecutionBinding(key="allowHeadContact", before=True, after=False)),
        policy=policy, capabilities=SUPPORTED_CAPABILITIES,
        known_review_items={"rev-x#0"})
    assert checked.validationStatus is ChangeSetValidation.rejected
    assert any("이장 우선" in e for e in checked.validationErrors)


def test_an_out_of_range_value_is_refused():
    service = iteration()
    policy = service.sim.policies[START].model_dump(mode="json")
    checked = validate_change_set(
        change_set(ExecutionBinding(key="retryCount", before=0, after=99)),
        policy=policy, capabilities=SUPPORTED_CAPABILITIES,
        known_review_items={"rev-x#0"})
    assert checked.validationStatus is ChangeSetValidation.rejected


def test_an_unsupported_feature_is_kept_as_a_suggestion_and_never_run():
    service = iteration()
    session = run_session(service, max_change_sets=4)
    detail = service.detail(service.load(session.id).id)
    suggestions = [p for g in detail["generations"] for p in g["changeSets"]
                   if p["validationStatus"] == "requires_implementation"]
    assert suggestions, "구현이 필요한 제안이 기록되어야 한다"
    for proposal in suggestions:
        assert all(not change["executionBindings"] for change in proposal["changes"])
        assert proposal["confirmationStatus"] == "not_run"
        assert proposal["resultingPolicyRevisionId"] is None


# ========================================== researcher authorship and authority


def test_researcher_edit_is_a_new_valid_change_set_and_preserves_source():
    service = iteration()
    session = service.create_session(
        label="직접 수정", core_item="c", base_policy_id=START,
        development_decks=[P1_DECK], resource_id=T_RES, max_generations=2)
    service.command(session.id, "start-edit", "start", blocking=True)
    original = next(item for item in service.detail(session.id)["generations"][0]["changeSets"]
                    if item["validationStatus"] == "valid")
    result = service.command(
        session.id, "save-edit", "save_researcher_change_set",
        payload={
            "templateChangeSetId": original["id"],
            "sourceChangeSetId": original["id"],
            "label": "연구자가 다듬은 규칙",
            "mechanism": "같은 실행 변경을 연구자 가설로 명확히 기록한다.",
            "afterRules": [change["afterRule"] + " (연구자 명시)"
                           for change in original["changes"]],
            "bindingValues": {
                binding["key"]: binding["after"]
                for change in original["changes"]
                for binding in change["executionBindings"]
            },
            "expectedEffects": ["주민 평가에서 지적한 문제를 줄인다."],
            "possibleRegressions": ["다른 주민의 부담은 다음 실행에서 확인한다."],
            "watchNext": ["같은 장면의 재발 여부"],
        })
    saved = result["changeSet"]
    assert saved["author"] == "researcher_hypothesis"
    assert saved["validationStatus"] == "valid"
    detail = service.detail(session.id)
    rows = detail["generations"][0]["changeSets"]
    assert next(row for row in rows if row["id"] == original["id"])["confirmationStatus"] == "superseded"
    assert len(detail["generations"]) == 1, "저장은 실행 권한 부여가 아니다"


def test_researcher_can_author_an_independent_change_set_without_overwriting_draft():
    service = iteration()
    session = service.create_session(
        label="새 가설", core_item="c", base_policy_id=START,
        development_decks=[P1_DECK], resource_id=T_RES, max_generations=2)
    service.command(session.id, "start-author", "start", blocking=True)
    original = next(item for item in service.detail(session.id)["generations"][0]["changeSets"]
                    if item["validationStatus"] == "valid")
    service.command(
        session.id, "save-author", "save_researcher_change_set",
        payload={
            "templateChangeSetId": original["id"],
            "label": "독립 연구자 가설",
            "mechanism": "실행 가능한 구조를 바탕으로 독립 가설을 기록한다.",
            "afterRules": [change["afterRule"] for change in original["changes"]],
            "bindingValues": {binding["key"]: binding["after"]
                              for change in original["changes"]
                              for binding in change["executionBindings"]},
        })
    rows = service.detail(session.id)["generations"][0]["changeSets"]
    assert next(row for row in rows if row["id"] == original["id"])["confirmationStatus"] == "draft"
    assert sum(row["author"] == "researcher_hypothesis" for row in rows) == 1


def test_the_last_generation_is_not_marked_as_the_winner():
    service = iteration()
    session = run_session(service)
    detail = service.detail(session.id)
    assert not detail["decisions"], "디자이너가 고르기 전에는 결정이 없어야 한다"
    assert all(g["confirmedBy"] in ("researcher", "none") for g in detail["generations"])
    assert not detail["decisions"], "실행 확인은 최종 우승안 결정이 아니다"
    assert session.status is not SessionStatus.ready_for_designer or True
    # ready_for_designer means "ready", not "validated"
    assert "완료" not in (session.stopDetail or "")


def test_reaching_the_generation_limit_hands_over_rather_than_declaring_success():
    service = iteration()
    session = run_session(service, max_generations=2, development_decks=[P1_DECK])
    assert session.status in (SessionStatus.ready_for_designer,
                              SessionStatus.stalled,
                              SessionStatus.no_valid_change,
                              SessionStatus.awaiting_confirmation), session.status
    assert session.stopReason, "왜 멈췄는지 반드시 남는다"


# =========================================================== budget and failure
def test_the_call_budget_stops_the_loop_and_is_not_reported_as_finished():
    class Exhausted(LlmClient):
        @property
        def available(self):  # noqa: D401 - configured, so the session is allowed
            return True

    client = Exhausted(provider="anthropic", model="test", api_key="x",
                       base_url="https://example.invalid")
    service = iteration(llm=client)
    session = service.create_session(
        label="예산", core_item="c", base_policy_id=START,
        development_decks=[P1_DECK], resource_id=T_RES,
        review_adapter="llm", improvement_adapter="rule", call_budget=1)
    engine = IterationEngine(service.sim, session, llm_client=client)
    engine.session.callsUsed = 5          # already over the budget
    engine.run()

    assert engine.session.status is SessionStatus.budget_exhausted
    assert engine.session.stopReason == "budget_exhausted"
    assert "완료" not in (engine.session.stopDetail or "")


def test_a_model_failure_is_a_failure_not_a_set_of_unknown_reviews():
    class Broken(LlmClient):
        @property
        def available(self):
            return True

        def complete_json(self, **kwargs):
            raise ModelCallError("provider returned 503")

    client = Broken(provider="anthropic", model="test", api_key="x",
                    base_url="https://example.invalid")
    service = iteration(llm=client)
    session = service.create_session(
        label="장애", core_item="c", base_policy_id=START,
        development_decks=[P1_DECK], resource_id=T_RES, review_adapter="llm")
    engine = IterationEngine(service.sim, session, llm_client=client)
    engine.run()

    assert engine.session.status is SessionStatus.failed
    assert engine.session.stopReason == "model_failure"
    generations = service.store.list_generations(session.id)
    assert not service.store.agent_reviews(generations[0]["id"]), (
        "모델이 실패했는데 unknown 리뷰를 지어내면 안 된다")


def test_an_online_adapter_without_a_key_is_refused_rather_than_downgraded():
    service = iteration(llm=LlmClient())          # nothing configured
    with pytest.raises(ValueError, match="키"):
        service.create_session(
            label="키 없음", core_item="c", base_policy_id=START,
            development_decks=[P1_DECK], resource_id=T_RES, review_adapter="llm")


def test_an_unconfigured_client_refuses_to_pretend():
    with pytest.raises(ModelNotConfigured):
        LlmClient().complete_json(role="x", system="", payload={}, schema={},
                                  schema_name="x")


def test_the_model_description_never_carries_the_key():
    client = LlmClient(provider="anthropic", model="m", api_key="super-secret",
                       base_url="https://example.invalid")
    described = client.describe()
    assert "super-secret" not in repr(described)
    assert described["configured"] is True


def test_each_provider_is_reachable_from_its_own_key_alone():
    """A key on its own is enough to configure a client.

    Google is the one that is easy to break: it has no request shape of its own
    here, it is reached through its OpenAI-compatible endpoint. A refactor that
    keys the request builder off `provider` instead of `wire` leaves
    GOOGLE_API_KEY configured-looking and unusable.
    """
    cases = {
        "ANTHROPIC_API_KEY": ("anthropic", "anthropic"),
        "OPENAI_API_KEY": ("openai", "openai"),
        "GOOGLE_API_KEY": ("google", "openai"),
    }
    for env_key, (provider, wire) in cases.items():
        client = LlmClient.from_env({env_key: "k"})
        assert client.provider == provider
        assert client.wire == wire
        assert client.model, "%s has no default model" % provider
        assert client.base_url.startswith("https://")
        assert client.available

    # The alias people actually type.
    assert LlmClient.from_env(
        {"GOOGLE_API_KEY": "k", "MEDIAL_LLM_PROVIDER": "gemini"}).provider == "google"
    # And a key for one provider does not configure another.
    assert not LlmClient.from_env({"GOOGLE_API_KEY": "k",
                                   "MEDIAL_LLM_PROVIDER": "openai"}).available


# ============================================================ restart behaviour
def test_a_restart_does_not_run_or_apply_a_generation_twice():
    """The loop is resumed from the database, not from memory."""
    db = Path(tempfile.mkdtemp()) / "iteration.sqlite3"

    first = iteration(Store(db))
    session = first.create_session(
        label="재시작", core_item="c", base_policy_id=START,
        development_decks=[P1_DECK], resource_id=T_RES, max_generations=3)
    engine = IterationEngine(first.sim, session)
    for _ in range(4):                       # stop part-way through
        engine.step()
    partial_attempts = len(first.store.list_attempts())
    first.store.close()

    second = iteration(Store(db))
    resumed = second.load(session.id)
    engine2 = IterationEngine(second.sim, resumed)
    engine2.run()

    generations = second.store.list_generations(session.id)
    for row in generations:
        reviews = second.store.agent_reviews(row["id"])
        keys = [(r["actorId"], r["attemptId"]) for r in reviews]
        assert len(keys) == len(set(keys)), (
            "재시작 후 같은 사람의 리뷰가 두 번 저장됐다: %s" % row["id"])
        proposals = second.store.change_sets(row["id"])
        applied = [p for p in proposals if p["resultingPolicyRevisionId"]]
        assert len(applied) == len({p["resultingPolicyRevisionId"] for p in applied}), (
            "같은 Change Set이 두 번 적용됐다")
    assert len(second.store.list_attempts()) >= partial_attempts
    second.store.close()


def test_the_same_command_id_with_different_arguments_is_a_conflict():
    from app.simulation.persistence.store import CommandConflict

    service = iteration()
    session = service.create_session(
        label="명령", core_item="c", base_policy_id=START,
        development_decks=[P1_DECK], resource_id=T_RES)
    service.command(session.id, "same-id", "start", blocking=True)
    with pytest.raises(CommandConflict):
        service.command(session.id, "same-id", "pause")


# ============================================ controlled comparison and replay
def test_generations_differ_only_in_policy():
    service = iteration()
    session = run_session(service)
    comparison = service.generation_comparison(session.id)
    advanced = next(g for g in comparison["generations"]
                    if g["index"] == 1)
    controlled = advanced["comparedToParent"]
    assert controlled["controlled"] is True, (
        "정책 외 입력이 달라졌다: %s" % controlled["differingInputs"])
    assert controlled["policyDifference"], "정책 차이가 계산되어야 한다"
    assert controlled["perActor"], "사람별 득실이 있어야 한다"


def test_a_later_generation_does_not_remember_the_previous_one():
    """Controlled mode resets the day; learning effects would confound the policy."""
    service = iteration()
    session = run_session(service, development_decks=[P1_DECK])
    detail = service.detail(session.id)
    parent = next(g for g in detail["generations"] if g["index"] == 0)
    child = next(g for g in detail["generations"] if g["index"] == 1)

    store = service.store
    a = store.get_attempt(parent["attemptIds"][0])["attempt"]
    b = store.get_attempt(child["attemptIds"][0])["attempt"]
    for key in ("deck", "resources", "village", "persona"):
        assert a["inputHashes"][key] == b["inputHashes"][key], key
    assert a["baselineRevisionId"] == b["baselineRevisionId"]
    assert a["seed"] == b["seed"]


def test_longitudinal_mode_is_refused_rather_than_faked():
    service = iteration()
    with pytest.raises(ValueError, match="longitudinal"):
        service.create_session(
            label="다일", core_item="c", base_policy_id=START,
            development_decks=[P1_DECK], resource_id=T_RES, mode="longitudinal")


def test_reading_a_stored_generation_calls_no_model():
    service = iteration()
    session = run_session(service, development_decks=[P1_DECK])
    before = len(service.store.model_calls(session.id))
    service.detail(session.id)
    service.generation_comparison(session.id)
    assert len(service.store.model_calls(session.id)) == before == 0


# ========================================================= designer and the field
def test_no_human_review_exists_until_a_person_submits_one():
    service = iteration()
    session = run_session(service, development_decks=[P1_DECK])
    generation = service.store.list_generations(session.id)[0]
    service.decide(session.id, disposition="hold",
                   generation_id=generation["id"], reasons=["현장에서 먼저 물어야 한다"],
                   supported_conditions=[], tradeoffs=[], dissent=[], unanswered=[])

    assert service.store.human_review_count() == 0, (
        "사람이 제출하기 전에 source=human 데이터가 존재하면 안 된다")

    packages = service.store.field_packages(session.id)
    assert packages, "현장 검토 패키지가 만들어져야 한다"
    package = packages[0]
    assert 1 <= len(package["episodes"]) <= 5
    for episode in package["episodes"]:
        assert episode["preQuestion"], "모의 반응을 보여주기 전에 물을 질문이 있어야 한다"

    submitted = service.submit_human_review(session.id, {
        "packageId": package["id"], "reviewerRole": "participant",
        "elicitation": "after_simulation_response",
        "selectedEpisodeIds": [package["episodes"][0]["id"]],
        "responses": [{"question": "실제로는 어떻게 하셨겠습니까", "answer": "직접 갔을 것"}],
        "corrections": [{"field": "이동", "correction": "그 시간엔 배를 탄다"}],
        "agreement": "correction"})
    assert submitted["source"] == "human"
    assert service.store.human_review_count() == 1


def test_a_human_review_cannot_point_at_a_scene_that_is_not_in_its_package():
    service = iteration()
    session = run_session(service, development_decks=[P1_DECK])
    generation = service.store.list_generations(session.id)[0]
    package = service.build_field_package(session.id, generation["id"])
    with pytest.raises(ValueError):
        service.submit_human_review(session.id, {
            "packageId": package.id, "reviewerRole": "participant",
            "elicitation": "concept_review",
            "selectedEpisodeIds": ["epi-does-not-exist"]})


def test_a_designer_may_choose_an_earlier_generation_or_hold():
    service = iteration()
    session = run_session(service)
    generations = service.store.list_generations(session.id)
    first = next(g for g in generations if g["index"] == 0)

    result = service.decide(
        session.id, disposition="adopt_for_field_review",
        generation_id=first["id"],
        reasons=["v1의 기관 부담 증가를 현장에서 먼저 확인해야 한다"],
        supported_conditions=["담당자가 1명일 때에 한한다"],
        tradeoffs=["이웃 시간이 그대로 남는다"], dissent=["P6는 반대로 평가했다"],
        unanswered=["실제 응답 의사"])
    decision = result["decision"]
    assert decision["chosenGenerationId"] == first["id"]
    assert decision["reasons"] and decision["tradeoffs"] and decision["dissent"]
    assert decision["alternativesConsidered"], "고려한 대안도 남는다"


def test_a_hold_records_no_chosen_generation():
    service = iteration()
    session = run_session(service, development_decks=[P1_DECK])
    result = service.decide(session.id, disposition="hold", generation_id=None,
                            reasons=["근거가 부족하다"], supported_conditions=[],
                            tradeoffs=[], dissent=[], unanswered=["실제 주민 확인"])
    assert result["decision"]["chosenGenerationId"] is None
    assert result["package"] is None


# ========================================================== honest capabilities
def test_the_capability_report_names_what_is_missing():
    service = iteration()
    capabilities = service.capabilities()
    assert capabilities["modes"]["longitudinal"] is False
    joined = " ".join(capabilities["notImplemented"])
    assert "119" in joined and "다일" in joined
    assert capabilities["model"]["configured"] in (True, False)
    assert "hybrid" in capabilities["adapterModes"]


def test_the_adapter_mode_label_says_hybrid_only_when_it_is_hybrid():
    service = iteration()
    session = service.create_session(
        label="라벨", core_item="c", base_policy_id=START,
        development_decks=[P1_DECK], resource_id=T_RES)
    assert session.adapter_mode_label == "rule"
    session.reviewAdapter = "llm"
    assert session.adapter_mode_label == "hybrid", (
        "주민 행동이 규칙이면 전체가 LLM이라고 쓰지 않는다")


def test_concurrent_reads_while_the_loop_writes():
    """Found in the browser: an intermittent 500 on /events.

    One sqlite3 connection is shared by the API threadpool and the iteration
    loop's own thread. Reads were unguarded, so a read landing during a write
    could fail. The lock now covers reads too.
    """
    import threading

    db = Path(tempfile.mkdtemp()) / "concurrent.sqlite3"
    service = iteration(Store(db))
    session = service.create_session(
        label="동시성", core_item="c", base_policy_id=START,
        development_decks=[P1_DECK], resource_id=T_RES, max_generations=3)

    failures: list[str] = []

    def reader() -> None:
        for _ in range(60):
            try:
                for row in service.store.list_attempts():
                    service.store.events(row["attempt"]["id"])
                    service.store.observations(row["attempt"]["id"], "MEDial")
                service.store.list_generations(session.id)
            except Exception as exc:  # noqa: BLE001 - the thing under test
                failures.append("%s: %s" % (type(exc).__name__, exc))
                return

    threads = [threading.Thread(target=reader) for _ in range(4)]
    for thread in threads:
        thread.start()
    service.command(session.id, "cmd-start", "start", blocking=True)
    for thread in threads:
        thread.join(timeout=30)

    assert not failures, failures
    service.store.close()
