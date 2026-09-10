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
* a ``ChangeProposal`` carries the *exact* before and after value. The before is
  checked against the base revision before the patch is applied, so a proposal
  written against a stale revision is refused instead of silently overwriting.
"""
from __future__ import annotations

from enum import Enum
from typing import Any, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field

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
    ungroundedClaims: list[str] = Field(default_factory=list)
    nextQuestions: list[str] = Field(default_factory=list)
    model: dict[str, Any] | None = None
    createdAt: str
    disclaimer: str = DISCLAIMER


# ------------------------------------------------------------- change proposal
class PatchOp(Base):
    op: Literal["replace"] = "replace"
    #: RFC 6901-style path into the policy revision, e.g. ``/params/retryCount``.
    path: str
    before: Any = None
    after: Any = None


class ProposalValidation(str, Enum):
    pending = "pending"
    valid = "valid"
    rejected = "rejected"
    #: The change is coherent but the engine has no handler for it. Recorded as a
    #: design suggestion and never executed.
    requires_implementation = "requires_implementation"


class ProposalSelection(str, Enum):
    pending = "pending"
    selected = "selected"
    branch = "branch"
    dominated = "dominated"
    rejected = "rejected"
    not_run = "not_run"


class ChangeProposal(Base):
    id: str
    sessionId: str
    generationIndex: int
    baseRevisionId: str
    label: str
    #: Which review items this is trying to answer. A proposal with none of these
    #: is not review-driven and the validator says so.
    reviewItemRefs: list[str] = Field(default_factory=list)
    issueRefs: list[str] = Field(default_factory=list)
    mechanism: str
    patch: list[PatchOp] = Field(default_factory=list)
    expectedEffects: list[str] = Field(default_factory=list)
    possibleRegressions: list[str] = Field(default_factory=list)
    assumptionRefs: list[str] = Field(default_factory=list)
    affectedActors: list[str] = Field(default_factory=list)
    #: Engine capabilities the change needs. Anything unsupported puts the
    #: proposal into ``requires_implementation``.
    requiredCapabilities: list[str] = Field(default_factory=list)
    watchNext: list[str] = Field(default_factory=list)
    validationStatus: ProposalValidation = ProposalValidation.pending
    validationErrors: list[str] = Field(default_factory=list)
    selectionStatus: ProposalSelection = ProposalSelection.pending
    resultingPolicyRevisionId: str | None = None
    resultingAttemptId: str | None = None
    adapter: Literal["rule", "llm", "scripted"] = "rule"
    model: dict[str, Any] | None = None
    createdAt: str
    #: Stable hash of the patch, used to notice a session proposing the same
    #: change over and over instead of making progress.
    patchHash: str = ""


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
    #: A hard constraint. A candidate that breaks it is excluded regardless of
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
    #: Order used only when the designer asked for automatic tie-breaking.
    priorityOrder: list[str] = Field(default_factory=list)
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
    evaluating_candidates = "evaluating_candidates"
    selecting_next = "selecting_next"
    # terminal / blocked
    ready_for_designer = "ready_for_designer"
    needs_decision = "needs_decision"
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
    SessionStatus.evaluating_candidates,
    SessionStatus.selecting_next,
})

TERMINAL_STATES = frozenset({
    SessionStatus.ready_for_designer,
    SessionStatus.needs_decision,
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
    "needs_decision": "후보들이 서로 다른 것을 좋게/나쁘게 만든다. 자동으로 고르지 않고 멈춘다.",
    "budget_exhausted": "모델 호출 예산이 끝났다. 완료가 아니라 중단이다.",
    "no_valid_change": "허용 범위 안에서 실행 가능한 개선안이 없다.",
    "stalled": "같은 patch가 반복되거나 새 발견이 없다. 반복을 멈춘다.",
    "model_failure": "모델 호출이 실패했다. 주민의 거절이나 unknown 평가와 다르다.",
    "cancelled": "사용자가 중단했다.",
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
    maxCandidatesPerGeneration: int = Field(default=2, ge=1, le=4)
    callBudget: int = Field(default=0, ge=0)
    tokenBudget: int = Field(default=0, ge=0)
    timeBudgetMs: int = Field(default=0, ge=0)
    allowedPatchPaths: list[str] = Field(default_factory=list)
    selectionRule: Literal["pareto_then_stop", "designer_priority"] = "pareto_then_stop"
    #: ``rule`` everywhere, or resident behaviour by rule with reviews and
    #: improvement by model. The second is reported as *hybrid*, never as
    #: "the residents are an LLM".
    behaviourAdapter: Literal["rule", "scripted"] = "rule"
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

    #: Policy paths a proposal may touch at all. Everything else is refused by
    #: :mod:`validation`, including things that are not policy in the first
    #: place (personas, memories, decks, rubrics, world facts, staffing).
    DEFAULT_ALLOWED_PATHS: ClassVar[tuple[str, ...]] = (
        "/contactStrategy",
        "/params/retryCount",
        "/params/retryIntervalMin",
        "/params/quietWindowMin",
        "/params/helperContactCap",
        "/params/disclosure",
        "/params/escalateToInstitutionAfterMin",
        "/params/allowHeadContact",
        "/params/rideCandidateOrder",
        "/params/maxRideDetourMin",
    )

    @property
    def adapter_mode_label(self) -> str:
        if self.reviewAdapter == "rule" and self.improvementAdapter == "rule":
            return "rule" if self.behaviourAdapter == "rule" else "scripted"
        if self.behaviourAdapter in ("rule", "scripted"):
            return "hybrid"
        return "llm"


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
    proposalIds: list[str] = Field(default_factory=list)
    #: Candidates that were run but not carried forward. Kept, never deleted:
    #: the branch is part of the record even when it lost.
    branchGenerationIds: list[str] = Field(default_factory=list)
    comparisonId: str | None = None
    outcome: GenerationOutcome = GenerationOutcome.pending
    selectedProposalId: str | None = None
    selectedBy: Literal["auto", "designer", "none"] = "none"
    selectionReason: str = ""
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
    note: str = (
        "실제 사람이 제출한 응답이다. 시뮬레이션 리뷰와 같은 표에 합산하지 않는다."
    )
