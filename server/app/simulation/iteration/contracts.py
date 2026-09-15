"""Contracts for the review -> improvement -> next generation loop.

Three separations are enforced by the types rather than left to a reviewer's
discipline:

* ``source`` distinguishes a simulated agent review from a researcher note from
  an actual person. ``source="human"`` is produced by exactly one code path -
  a real submission through the field-review endpoint - and nothing else in the
  package can construct one;
* a review item that carries an assessment other than ``unknown`` must cite at
  least one event the actor actually experienced. "I did not experience this"
  is ``unknown``, never a complaint;
* a ``ChangeSet`` carries meaningful Quest/Task before and after rules plus exact
  internal bindings. Stale before-values are refused instead of overwritten.
"""
from __future__ import annotations

from enum import Enum
from typing import Any, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field

from . import semantic_rules
from .semantic_rules import SemanticChange

#: Bumped when the prompts or the rule reviewers can produce a different review
#: from the same cycle. Stored on every review so two generations reviewed by
#: different versions are never silently compared.
REVIEW_CONTRACT_VERSION = "medial-review/1.0.0"

DISCLAIMER = (
    "시뮬레이션 산출물이다. 실제 주민의 발언·만족도·임상 결과가 아니다."
)


class Base(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


# --------------------------------------------------------------- agent review
class ReviewDimensionKey(str, Enum):
    """The six things every actor is asked about (doc 12 section 6).

    "불편" is not a seventh dimension: discomfort shows up as a ``negative``
    assessment on whichever dimension it belongs to, with the event that caused
    it attached. Splitting it out would let the same complaint be counted twice.
    """

    help_resolution = "help_resolution"      # 도움이 되었는가 / 일이 해결되었는가
    time_labour = "time_labour"              # 시간과 노동 (불편·부담)
    choice_refusal = "choice_refusal"        # 선택권 · 거절 가능성
    disclosure = "disclosure"                # 정보 공유 범위
    understandability = "understandability"  # 무슨 일이 왜 일어났는지 이해되었는가
    reuse_condition = "reuse_condition"      # 다음에 이용한다면 무엇이 달라져야 하는가


DIMENSION_LABELS: dict[str, str] = {
    ReviewDimensionKey.help_resolution.value: "도움 · 해결",
    ReviewDimensionKey.time_labour.value: "시간 · 노동",
    ReviewDimensionKey.choice_refusal.value: "선택 · 거절",
    ReviewDimensionKey.disclosure.value: "정보 공유",
    ReviewDimensionKey.understandability.value: "이해 가능성",
    ReviewDimensionKey.reuse_condition.value: "재이용 조건",
}


class UsageStatus(str, Enum):
    """Whether this actor met the service at all, and how.

    Not using something is an observation, not a complaint: ``not_offered`` and
    ``no_experience`` must never be scored as dissatisfaction.
    """

    used = "used"
    offered_declined = "offered_declined"
    offered_no_response = "offered_no_response"
    offered_unfulfilled = "offered_unfulfilled"
    not_offered = "not_offered"
    no_experience = "no_experience"


class ReviewItem(Base):
    dimension: ReviewDimensionKey
    assessment: Literal["positive", "mixed", "negative", "unknown"]
    reason: str
    #: Events this actor actually experienced. Required for anything that is not
    #: ``unknown``; validated against the actor's experience set.
    eventRefs: list[str] = Field(default_factory=list)
    #: Evidence cards from *this actor's own* persona revision. Used when the
    #: item rests on a disposition rather than on an event.
    evidenceRefs: list[str] = Field(default_factory=list)
    requestedChange: str | None = None


class AgentReview(Base):
    id: str
    sessionId: str | None = None
    generationIndex: int | None = None
    attemptId: str
    actorId: str
    actorRole: Literal["resident", "village_head", "health_staff", "health_director"]
    policyRevisionId: str
    #: ``simulated`` for anything this package produces. ``human`` exists only in
    #: :class:`HumanReview`; it is not reachable from an adapter.
    source: Literal["simulated"] = "simulated"
    adapter: Literal["rule", "llm", "scripted"]
    scope: Literal["cycle_end_retrospective"] = "cycle_end_retrospective"
    usageStatus: UsageStatus
    experiencedEventIds: list[str] = Field(default_factory=list)
    evidenceRefs: list[str] = Field(default_factory=list)
    items: list[ReviewItem] = Field(default_factory=list)
    overallNarrative: str
    unknowns: list[str] = Field(default_factory=list)
    model: dict[str, Any] | None = None
    promptVersion: str = REVIEW_CONTRACT_VERSION
    createdAt: str
    disclaimer: str = DISCLAIMER


# ------------------------------------------------------------------ synthesis
class IssueGroup(Base):
    id: str
    title: str
    dimension: ReviewDimensionKey
    #: ``"<reviewId>#<itemIndex>"``. Points at the exact item, not at a summary.
    reviewItemRefs: list[str] = Field(default_factory=list)
    eventRefs: list[str] = Field(default_factory=list)
    affectedActors: list[str] = Field(default_factory=list)
    #: Actors whose own review points the other way on the same issue. Kept
    #: because a majority reading that deletes them is the failure mode this
    #: whole structure exists to prevent.
    dissentingActors: list[str] = Field(default_factory=list)
    severity: Literal["blocking", "significant", "minor", "unknown"] = "unknown"
    #: True when few actors raised it. Minority is a reason to *look*, never a
    #: reason to drop.
    minority: bool = False
    assumedMechanism: str = ""
    alternativeExplanations: list[str] = Field(default_factory=list)
    objectiveMetricRefs: list[str] = Field(default_factory=list)
    unknowns: list[str] = Field(default_factory=list)


class ReviewConflict(Base):
    """Two parties whose interests move in opposite directions on one issue."""

    id: str
    description: str
    issueRefs: list[str] = Field(default_factory=list)
    sideA: list[str] = Field(default_factory=list)
    sideB: list[str] = Field(default_factory=list)
    note: str = ""


class ExcludedClaim(Base):
    """A claim the synthesis set aside, with what it was made of (26번 C05, F08).

    A bare sentence was not enough. The audit of 2026-09-15 found the synthesis
    filtering two grounded claims as unsupported - and filtering one claim no
    reviewer had made at all, which it had written itself. Both are invisible
    when the record is a list of strings.

    Three things are kept apart here:

    * ``reviewItemRefs`` - the original evaluation items this claim came from.
      Empty means the synthesis authored the claim itself, which is a different
      kind of error from mislabelling one;
    * ``technicalCheck`` - what a machine can settle: do the references exist,
      was the actor allowed to see them, is the timing possible;
    * ``semanticReview`` - whether the cited events actually support the
      sentence. A model's own opinion on this is an ``ai_draft`` label, never a
      human judgement, and ``unreviewed`` is the honest default.
    """

    id: str
    claim: str
    reviewItemRefs: list[str] = Field(default_factory=list)
    eventRefs: list[str] = Field(default_factory=list)
    technicalCheck: Literal["refs_exist", "refs_missing", "no_refs"] = "no_refs"
    semanticReview: Literal["supported", "contradicted", "insufficient",
                            "unreviewed"] = "unreviewed"
    #: Who applied ``semanticReview``. A model labelling its own output is a
    #: draft; only a person's label is counted in the audit's ratios.
    labelledBy: Literal["human", "ai_draft", "none"] = "none"
    reason: str = ""


class ReviewSynthesis(Base):
    id: str
    sessionId: str
    generationIndex: int
    attemptIds: list[str]
    reviewIds: list[str]
    adapter: Literal["rule", "llm", "scripted"]
    issueGroups: list[IssueGroup] = Field(default_factory=list)
    #: Ids of the issue groups that are minority concerns, surfaced separately so
    #: the screen cannot bury them under the common ones.
    minorityConcernIds: list[str] = Field(default_factory=list)
    conflicts: list[ReviewConflict] = Field(default_factory=list)
    #: Researcher metrics, kept *beside* the reviews and never merged into them.
    objectiveMetrics: dict[str, Any] = Field(default_factory=dict)
    noExperienceActors: list[str] = Field(default_factory=list)
    #: Historic form: the sentences alone. Kept because syntheses stored before
    #: 2026-09-15 have only this, and rewriting them would change the record.
    ungroundedClaims: list[str] = Field(default_factory=list)
    #: The same thing with its provenance attached. New syntheses fill this.
    excludedClaims: list[ExcludedClaim] = Field(default_factory=list)
    nextQuestions: list[str] = Field(default_factory=list)
    model: dict[str, Any] | None = None
    createdAt: str
    disclaimer: str = DISCLAIMER


# ---------------------------------------------------------------- change set
class ImprovementTarget(str, Enum):
    quest_completion_escalation = "quest_completion_escalation"
    task_composition_flow = "task_composition_flow"
    task_assignment_refusal = "task_assignment_refusal"
    timing_burden = "timing_burden"
    explanation_disclosure = "explanation_disclosure"


class ChangeScope(str, Enum):
    quest = "quest"
    task = "task"


class ExecutionBinding(Base):
    """Collapsed engine detail implementing one meaningful Quest/Task rule."""

    key: str
    before: Any = None
    after: Any = None


class RuleChange(Base):
    """One meaningful rule change.

    Since 2026-09-15 the source of truth is ``semantic``: a typed rule change
    from :mod:`semantic_rules`. Every other field here is *derived* from it by
    :func:`materialize_change` - the sentences, the bindings, the Quest/Task
    routing - and the validator refuses a change whose stored derivations do
    not match its semantic values. ``semantic`` is optional only so that Change
    Sets stored before this existed still load; those are read-only history and
    cannot be re-used as templates.
    """

    scope: ChangeScope
    target: ImprovementTarget
    questId: str
    taskIds: list[str] = Field(default_factory=list)
    field: str
    beforeRule: str
    afterRule: str
    executionBindings: list[ExecutionBinding] = Field(default_factory=list)
    semantic: SemanticChange | None = None


def materialize_change(semantic: Any) -> RuleChange:
    """The one constructor for a new :class:`RuleChange`."""
    s = semantic_rules.spec(semantic.ruleType)
    return RuleChange(
        scope=ChangeScope(s.scope), target=ImprovementTarget(s.target),
        questId=s.quest_id, taskIds=list(s.task_ids), field=s.field,
        beforeRule=semantic_rules.format_rule(semantic.ruleType, semantic.before),
        afterRule=semantic_rules.format_rule(semantic.ruleType, semantic.after),
        executionBindings=[ExecutionBinding(**b)
                           for b in semantic_rules.compile_bindings(semantic)],
        semantic=semantic,
    )


class ChangeSetValidation(str, Enum):
    pending = "pending"
    valid = "valid"
    rejected = "rejected"
    requires_implementation = "requires_implementation"


class ChangeSetConfirmation(str, Enum):
    draft = "draft"
    confirmed = "confirmed"
    declined = "declined"
    superseded = "superseded"
    not_run = "not_run"


class ChangeSet(Base):
    id: str
    sessionId: str
    generationIndex: int
    baseRevisionId: str
    label: str
    reviewItemRefs: list[str] = Field(default_factory=list)
    issueRefs: list[str] = Field(default_factory=list)
    eventRefs: list[str] = Field(default_factory=list)
    evidenceRefs: list[str] = Field(default_factory=list)
    mechanism: str
    changes: list[RuleChange] = Field(default_factory=list)
    expectedEffects: list[str] = Field(default_factory=list)
    possibleRegressions: list[str] = Field(default_factory=list)
    unknowns: list[str] = Field(default_factory=list)
    assumptionRefs: list[str] = Field(default_factory=list)
    affectedActors: list[str] = Field(default_factory=list)
    requiredCapabilities: list[str] = Field(default_factory=list)
    watchNext: list[str] = Field(default_factory=list)
    author: Literal["rule_draft", "ai_draft", "researcher_hypothesis"] = "rule_draft"
    validationStatus: ChangeSetValidation = ChangeSetValidation.pending
    validationErrors: list[str] = Field(default_factory=list)
    confirmationStatus: ChangeSetConfirmation = ChangeSetConfirmation.draft
    confirmationReason: str = ""
    confirmedAt: str | None = None
    resultingPolicyRevisionId: str | None = None
    resultingAttemptId: str | None = None
    adapter: Literal["rule", "llm", "scripted"] = "rule"
    model: dict[str, Any] | None = None
    createdAt: str
    changeHash: str = ""


class NoSupportedChange(Base):
    """What the improvement adapter returns when it has nothing legitimate.

    Returning this is a valid outcome. Inventing a change so the generation
    "does something" is not.
    """

    reason: str
    issueRefs: list[str] = Field(default_factory=list)
    requiresImplementation: list[str] = Field(default_factory=list)


# ------------------------------------------------------------------- criteria
class Criterion(Base):
    key: str
    label: str
    direction: Literal["lower_better", "higher_better"]
    #: A hard constraint. A revision that breaks it is flagged regardless of
    #: how the other numbers look.
    required: bool = False
    maxValue: float | None = None
    minValue: float | None = None


class CriteriaRevision(Base):
    """Fixed when the session starts.

    Changing what counts as better *during* an iteration is how a tool ends up
    proving whatever it happened to produce, so an edit means a new session.
    """

    id: str
    label: str
    criteria: list[Criterion] = Field(default_factory=list)
    note: str = "지표 방향과 필수 조건은 iteration 시작 시 고정된다."


# ------------------------------------------------------------------- session
class SessionMode(str, Enum):
    controlled_iteration = "controlled_iteration"
    longitudinal = "longitudinal"


class SessionControl(str, Enum):
    bounded_auto = "bounded_auto"
    manual = "manual"


class SessionStatus(str, Enum):
    created = "created"
    running_cycle = "running_cycle"
    collecting_reviews = "collecting_reviews"
    synthesizing = "synthesizing"
    proposing_changes = "proposing_changes"
    validating_changes = "validating_changes"
    executing_revision = "executing_revision"
    awaiting_confirmation = "awaiting_confirmation"
    # terminal / blocked
    ready_for_designer = "ready_for_designer"
    budget_exhausted = "budget_exhausted"
    no_valid_change = "no_valid_change"
    stalled = "stalled"
    paused = "paused"
    failed = "failed"
    cancelled = "cancelled"


#: States from which the loop may take another step on its own.
RUNNING_STATES = frozenset({
    SessionStatus.created,
    SessionStatus.running_cycle,
    SessionStatus.collecting_reviews,
    SessionStatus.synthesizing,
    SessionStatus.proposing_changes,
    SessionStatus.validating_changes,
    SessionStatus.executing_revision,
})

TERMINAL_STATES = frozenset({
    SessionStatus.ready_for_designer,
    SessionStatus.awaiting_confirmation,
    SessionStatus.budget_exhausted,
    SessionStatus.no_valid_change,
    SessionStatus.stalled,
    SessionStatus.failed,
    SessionStatus.cancelled,
})

#: Human-readable, and deliberately not interchangeable. A budget stop is not a
#: success, and a model outage is not a resident declining.
STOP_REASON_TEXT: dict[str, str] = {
    "reached_max_generations": "설정한 세대 수를 모두 실행했다. 최종 선택은 디자이너가 한다.",
    "awaiting_confirmation": "검증된 Change Set 초안이 있다. 연구자가 확정하기 전에는 실행하지 않는다.",
    "budget_exhausted": "모델 호출 예산이 끝났다. 완료가 아니라 중단이다.",
    "no_valid_change": "허용 범위 안에서 실행 가능한 개선안이 없다.",
    "stalled": "같은 Change Set이 반복되거나 새 발견이 없다. 반복을 멈춘다.",
    "model_failure": "모델 호출이 실패했다. 주민의 거절이나 unknown 평가와 다르다.",
    "cancelled": "사용자가 중단했다.",
    "no_change_this_time": "연구자가 이번에는 운영 규칙을 수정하지 않기로 했다. 현장 질문만 남긴다.",
}


class IterationSession(Base):
    id: str
    label: str
    coreItem: str
    briefRevision: str
    #: The snapshot every generation is reset to. In ``controlled_iteration``
    #: this is what makes generations comparable at all.
    initialSnapshotRef: str
    initialSnapshotHash: str
    personaRevisionId: str
    worldRevisionId: str
    resourceRevisionId: str
    developmentDeckRefs: list[str] = Field(default_factory=list)
    #: Held back from the improvement adapter's prompt. If a report from these is
    #: ever fed back into tuning, the deck stops being unseen and must be marked.
    evaluationDeckRefs: list[str] = Field(default_factory=list)
    criteriaRevision: CriteriaRevision
    mode: SessionMode = SessionMode.controlled_iteration
    control: SessionControl = SessionControl.bounded_auto
    basePolicyRevisionId: str
    maxGenerations: int = Field(default=3, ge=1, le=10)
    maxChangeSetsPerGeneration: int = Field(default=2, ge=1, le=4)
    callBudget: int = Field(default=0, ge=0)
    tokenBudget: int = Field(default=0, ge=0)
    timeBudgetMs: int = Field(default=0, ge=0)
    #: ``rule`` everywhere, or resident behaviour by rule with reviews and
    #: improvement by model. The second is reported as *hybrid*, never as
    #: "the residents are an LLM".
    behaviourAdapter: Literal["rule", "scripted", "llm"] = "rule"
    #: The health centre and 119: procedure, or a model (the head tier).
    institutionAdapter: Literal["rule", "llm"] = "rule"
    reviewAdapter: Literal["rule", "llm", "scripted"] = "rule"
    improvementAdapter: Literal["rule", "llm", "scripted"] = "rule"
    status: SessionStatus = SessionStatus.created
    #: Where a paused session will resume from. Kept so pausing does not lose the
    #: place in the state machine.
    pausedFrom: str | None = None
    stopReason: str | None = None
    stopDetail: str | None = None
    currentGenerationIndex: int = 0
    callsUsed: int = 0
    tokensUsed: int = 0
    createdAt: str
    updatedAt: str

    @property
    def adapter_mode_label(self) -> str:
        """``llm`` only when the village itself ran on models. Models used
        for review or proposal over a rule-driven village are ``hybrid``."""
        if self.behaviourAdapter == "llm":
            return "llm"
        if (self.reviewAdapter == "rule" and self.improvementAdapter == "rule"
                and self.institutionAdapter == "rule"):
            return "rule" if self.behaviourAdapter == "rule" else "scripted"
        return "hybrid"


class GenerationOutcome(str, Enum):
    pending = "pending"
    running = "running"
    reviewed = "reviewed"
    proposed = "proposed"
    evaluated = "evaluated"
    advanced = "advanced"
    blocked = "blocked"
    final = "final"


class Generation(Base):
    id: str
    sessionId: str
    index: int
    parentGenerationId: str | None = None
    policyRevisionId: str
    label: str
    attemptIds: list[str] = Field(default_factory=list)
    reviewIds: list[str] = Field(default_factory=list)
    synthesisId: str | None = None
    changeSetIds: list[str] = Field(default_factory=list)
    comparisonId: str | None = None
    outcome: GenerationOutcome = GenerationOutcome.pending
    appliedChangeSetId: str | None = None
    confirmedBy: Literal["researcher", "none"] = "none"
    confirmationReason: str = ""
    metrics: dict[str, Any] = Field(default_factory=dict)
    createdAt: str


# ---------------------------------------------------------- designer & field
class DesignerDecision(Base):
    id: str
    sessionId: str
    designerRole: str = "researcher"
    #: ``None`` is a real answer: holding is a decision, and the last generation
    #: is never an automatic winner.
    chosenGenerationId: str | None = None
    disposition: Literal["adopt_for_field_review", "hold", "reject"]
    alternativesConsidered: list[str] = Field(default_factory=list)
    reasons: list[str] = Field(default_factory=list)
    supportedConditions: list[str] = Field(default_factory=list)
    tradeoffs: list[str] = Field(default_factory=list)
    dissent: list[str] = Field(default_factory=list)
    unansweredQuestions: list[str] = Field(default_factory=list)
    fieldReviewPackageId: str | None = None
    createdAt: str


class EpisodeCard(Base):
    """A short scene to show a real person, instead of a whole log."""

    id: str
    attemptId: str
    actorId: str
    title: str
    fromSeq: int
    toSeq: int
    eventIds: list[str] = Field(default_factory=list)
    summary: str
    simulatedReviewId: str | None = None
    #: Asked *before* the simulated reaction is shown, so the answer is not
    #: anchored on it.
    preQuestion: str = ""
    postQuestion: str = ""


class FieldReviewPackage(Base):
    id: str
    sessionId: str
    decisionId: str | None = None
    generationId: str
    coreItem: str
    episodes: list[EpisodeCard] = Field(default_factory=list)
    policySummary: list[str] = Field(default_factory=list)
    openQuestions: list[str] = Field(default_factory=list)
    dissentToShow: list[str] = Field(default_factory=list)
    consentNote: str = (
        "재방문 인터뷰는 참여자가 언제든 쉬거나 중단할 수 있고, 실제 소요 시간과 부담을 "
        "함께 기록한다."
    )
    createdAt: str


class HumanReview(Base):
    """An actual person's answer. The only place ``source="human"`` exists.

    Nothing in this package writes one of these; it is created solely by the
    field-review submission endpoint, from a body a person filled in.

    The 2026-09-15 fields (26번 C06) exist because the protocol has an order and
    the record has to carry it:

    * ``responseStage`` - ``pre_disclosure`` answers are given *before* the
      person is shown what the agent said. A pre-disclosure record carries no
      ``correspondence``: there is nothing yet to agree with;
    * ``respondentId`` / ``respondentRole`` / ``subjectActorId`` - who answered,
      in what capacity, about which modelled resident. A family member's answer
      is their own record and never overwrites the resident's;
    * ``correspondence`` - ``disagreement`` is sayable. The old four values had
      no way to record an explicit conflict, only ``partial``;
    * ``correctionTarget`` - what the person says should change: the material,
      the world assumption, the behaviour model, the service rule, one
      evaluation, or the synthesis. A correction does not edit a past run; it is
      an input to the next one;
    * ``responseKind`` - a researcher's note is a human record but not a
      resident's answer, and the two are never counted together.

    Legacy values (``agreement``, ``elicitation``, ``reviewerRole``) are kept as
    stored. A ``partial`` from an earlier session is not silently rewritten into
    the new vocabulary; somebody may add a new correction record instead.
    """

    id: str
    sessionId: str
    packageId: str
    reviewerRole: Literal["participant", "family", "institution_staff", "researcher_note"]
    #: Which modelled actor this person speaks about or for. ``None`` when the
    #: reviewer is not represented in the model at all.
    relationshipToActor: str | None = None
    actorId: str | None = None
    selectedEpisodeIds: list[str] = Field(default_factory=list)
    elicitation: Literal["pre_simulation_response", "after_simulation_response",
                         "concept_review", "actual_use"]
    responses: list[dict[str, Any]] = Field(default_factory=list)
    corrections: list[dict[str, Any]] = Field(default_factory=list)
    agreement: Literal["agreement", "partial", "correction", "unknown"] = "unknown"
    consentScope: str = "unknown"
    source: Literal["human"] = "human"
    submittedAt: str

    # -- 2026-09-15 (26번 C06). Optional so that stored rows still load.
    #: Pseudonymous and stable within a study, never a name.
    respondentId: str = "unknown"
    respondentRole: Literal["self", "family", "institution_staff",
                            "researcher"] = "self"
    #: The modelled resident the answer is *about*, kept apart from who is
    #: answering: a family member speaking about P1 is not P1.
    subjectActorId: str | None = None
    episodeId: str | None = None
    reviewItemRefs: list[str] = Field(default_factory=list)
    responseStage: Literal["pre_disclosure", "post_disclosure"] = "pre_disclosure"
    #: Which disclosure this answer came after. Required for a post-disclosure
    #: record and refused on a pre-disclosure one.
    disclosureRecordId: str | None = None
    correspondence: Literal["agreement", "correction", "disagreement",
                            "unknown"] | None = None
    correctionTarget: Literal["case_material", "world_assumption",
                              "behaviour_model", "service_rule",
                              "evaluation", "synthesis"] | None = None
    reason: str = ""
    responseKind: Literal["resident_response", "researcher_note"] = "resident_response"
    note: str = (
        "실제 사람이 제출한 응답이다. 시뮬레이션 리뷰와 같은 표에 합산하지 않는다."
    )


class DisclosureRecord(Base):
    """When a respondent was shown the simulated evaluation, and by whom.

    The app can only record what it did itself. Somebody may have been told
    outside it, so this is a record, not a guarantee of an unanchored answer -
    and the screen says exactly that where it matters.
    """

    id: str
    sessionId: str
    packageId: str
    episodeId: str
    respondentId: str
    disclosedBy: str = "researcher"
    disclosedAt: str
    #: What was shown: the evaluation ids the respondent saw.
    shownReviewIds: list[str] = Field(default_factory=list)
    note: str = ("앱에서 공개한 시점의 기록이다. 앱 밖에서 이미 들었을 수 있으므로 "
                 "무편향 응답을 보증하지 않는다.")
