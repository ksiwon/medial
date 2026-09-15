import type { Catalog } from './types';

// Mirrors server/app/simulation/iteration/*. Hand-written for the same reason as
// types.ts: this file is where a server contract change has to be noticed.
//
// Wording is kept identical to the server on purpose. "모의 리뷰", "미경험",
// "구현 필요", "예산 종료" mean specific things there, and softening any of them
// here would be the screen quietly making a weaker claim into a stronger one.

export type ReviewDimension =
  | 'help_resolution'
  | 'time_labour'
  | 'choice_refusal'
  | 'disclosure'
  | 'understandability'
  | 'reuse_condition';

export const DIMENSION_LABELS: Record<ReviewDimension, string> = {
  help_resolution: '도움 · 해결',
  time_labour: '시간 · 노동',
  choice_refusal: '선택 · 거절',
  disclosure: '정보 공유',
  understandability: '이해 가능성',
  reuse_condition: '재이용 조건',
};

export type Assessment = 'positive' | 'mixed' | 'negative' | 'unknown';

/** Said in Korean wherever an assessment is shown. The four values are the
 *  contract; printing the value itself put "도움 · 해결 · mixed" on screen. */
export const ASSESSMENT_LABELS: Record<Assessment, string> = {
  positive: '긍정',
  mixed: '혼합',
  negative: '부정',
  unknown: '판단 불가',
};

export type UsageStatus =
  | 'used'
  | 'offered_declined'
  | 'offered_no_response'
  | 'offered_unfulfilled'
  | 'not_offered'
  | 'no_experience';

export const USAGE_LABELS: Record<UsageStatus, string> = {
  used: '이용함',
  offered_declined: '제안받고 거절',
  offered_no_response: '연락받았으나 응답 없음',
  offered_unfulfilled: '제안은 있었으나 이어지지 않음',
  not_offered: '제안 없음',
  no_experience: '미경험',
};

export interface ReviewItem {
  dimension: ReviewDimension;
  assessment: Assessment;
  reason: string;
  eventRefs: string[];
  evidenceRefs: string[];
  requestedChange: string | null;
}

export interface AgentReview {
  id: string;
  sessionId: string | null;
  generationIndex: number | null;
  attemptId: string;
  actorId: string;
  actorRole: 'resident' | 'village_head' | 'health_staff' | 'health_director';
  policyRevisionId: string;
  source: 'simulated';
  adapter: 'rule' | 'llm' | 'scripted';
  scope: 'cycle_end_retrospective';
  usageStatus: UsageStatus;
  experiencedEventIds: string[];
  evidenceRefs: string[];
  items: ReviewItem[];
  overallNarrative: string;
  unknowns: string[];
  model: Record<string, unknown> | null;
  promptVersion: string;
  createdAt: string;
  disclaimer: string;
}

export interface IssueGroup {
  id: string;
  title: string;
  dimension: ReviewDimension;
  reviewItemRefs: string[];
  eventRefs: string[];
  affectedActors: string[];
  dissentingActors: string[];
  severity: 'blocking' | 'significant' | 'minor' | 'unknown';
  minority: boolean;
  assumedMechanism: string;
  alternativeExplanations: string[];
  objectiveMetricRefs: string[];
  unknowns: string[];
}

export interface ReviewConflict {
  id: string;
  description: string;
  issueRefs: string[];
  sideA: string[];
  sideB: string[];
  note: string;
}

export interface ReviewSynthesis {
  id: string;
  sessionId: string;
  generationIndex: number;
  attemptIds: string[];
  reviewIds: string[];
  adapter: string;
  issueGroups: IssueGroup[];
  minorityConcernIds: string[];
  conflicts: ReviewConflict[];
  objectiveMetrics: Record<string, unknown>;
  noExperienceActors: string[];
  ungroundedClaims: string[];
  nextQuestions: string[];
  createdAt: string;
  disclaimer: string;
}

export interface ExecutionBinding {
  key: string;
  before: unknown;
  after: unknown;
}

/** One rule MEDial can operate on, as the server's rule catalogue describes it.
 *  The composer builds its controls from this; there is no second list of
 *  fields on this side to drift out of date (server semantic_rules.py). */
export interface RuleParamSpec {
  key: string;
  label: string;
  kind: 'int' | 'bool' | 'enum';
  binding: string;
  minimum: number | null;
  maximum: number | null;
  options: { value: string; label: string }[];
  unit: string;
  nullable: boolean;
  nullLabel: string;
}

export interface RuleSpec {
  ruleType: string;
  label: string;
  description: string;
  scope: 'quest' | 'task';
  target: ImprovementTarget;
  questId: string;
  taskIds: string[];
  field: string;
  /** False when this session's scenarios never exercise the rule: changing it
   *  would run and show no difference, which is not the same as no effect. */
  applicable: boolean;
  params: RuleParamSpec[];
  /** Present on a generation's catalogue: that revision's current values. */
  current?: Record<string, unknown>;
  currentRule?: string;
}

/** The typed change itself: rule type plus the values before and after. The
 *  sentences and the engine bindings are derived from this on the server. */
export interface SemanticChange {
  ruleType: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/** Did the changed rule actually run (server rule_application.py)? */
export interface RuleApplicationRecord {
  ruleType: string | null;
  attemptId: string | null;
  label?: string;
  conditionStatus: 'occurred' | 'not_occurred' | 'unknown';
  executionStatus: 'applied' | 'not_reached' | 'unknown';
  reason: string;
  eventRefs: string[];
}

export type ImprovementTarget =
  | 'quest_completion_escalation'
  | 'task_composition_flow'
  | 'task_assignment_refusal'
  | 'timing_burden'
  | 'explanation_disclosure';

export interface RuleChange {
  scope: 'quest' | 'task';
  target: ImprovementTarget;
  questId: string;
  taskIds: string[];
  field: string;
  beforeRule: string;
  afterRule: string;
  executionBindings: ExecutionBinding[];
  /** Absent on Change Sets stored before 2026-09-15; those are read-only
   *  history and cannot be executed or used as a template. */
  semantic: SemanticChange | null;
}

export interface ChangeSet {
  id: string;
  sessionId: string;
  generationIndex: number;
  baseRevisionId: string;
  label: string;
  reviewItemRefs: string[];
  issueRefs: string[];
  eventRefs: string[];
  evidenceRefs: string[];
  mechanism: string;
  changes: RuleChange[];
  expectedEffects: string[];
  possibleRegressions: string[];
  unknowns: string[];
  assumptionRefs: string[];
  affectedActors: string[];
  requiredCapabilities: string[];
  watchNext: string[];
  validationStatus: 'pending' | 'valid' | 'rejected' | 'requires_implementation';
  validationErrors: string[];
  confirmationStatus: 'draft' | 'confirmed' | 'declined' | 'superseded' | 'not_run';
  confirmationReason: string;
  confirmedAt: string | null;
  resultingPolicyRevisionId: string | null;
  resultingAttemptId: string | null;
  adapter: string;
  author: 'rule_draft' | 'ai_draft' | 'researcher_hypothesis';
  createdAt: string;
  changeHash: string;
}

export type SessionStatus =
  | 'created'
  | 'running_cycle'
  | 'collecting_reviews'
  | 'synthesizing'
  | 'proposing_changes'
  | 'validating_changes'
  | 'executing_revision'
  | 'awaiting_confirmation'
  | 'ready_for_designer'
  | 'budget_exhausted'
  | 'no_valid_change'
  | 'stalled'
  | 'paused'
  | 'failed'
  | 'cancelled';

export const STATUS_LABELS: Record<SessionStatus, string> = {
  created: '시작 전',
  running_cycle: 'Cycle 실행 중',
  collecting_reviews: '개인 리뷰 수집 중',
  synthesizing: '리뷰 종합 중',
  proposing_changes: '개선안 작성 중',
  validating_changes: '개선안 검증 중',
  executing_revision: '확정한 MEDial 수정 실행 중',
  awaiting_confirmation: 'Change Set 연구자 확인 대기',
  ready_for_designer: '디자이너 검토 대기',
  budget_exhausted: '예산 종료 (완료 아님)',
  no_valid_change: '실행 가능한 개선안 없음',
  stalled: '정체 (같은 변경이 반복됨)',
  paused: '일시정지',
  failed: '실패',
  cancelled: '사용자 중단',
};

/** States the loop is still moving through, so the screen can poll. */
export const RUNNING_STATUSES: SessionStatus[] = [
  'created',
  'running_cycle',
  'collecting_reviews',
  'synthesizing',
  'proposing_changes',
  'validating_changes',
  'executing_revision',
];

export interface CriteriaRevision {
  id: string;
  label: string;
  criteria: {
    key: string;
    label: string;
    direction: 'lower_better' | 'higher_better';
    required: boolean;
    maxValue: number | null;
    minValue: number | null;
  }[];
  note: string;
}

export interface IterationSession {
  id: string;
  label: string;
  coreItem: string;
  initialSnapshotHash: string;
  developmentDeckRefs: string[];
  evaluationDeckRefs: string[];
  criteriaRevision: CriteriaRevision;
  mode: string;
  control: string;
  basePolicyRevisionId: string;
  maxGenerations: number;
  maxChangeSetsPerGeneration: number;
  callBudget: number;
  tokenBudget: number;
  behaviourAdapter: string;
  reviewAdapter: string;
  improvementAdapter: string;
  status: SessionStatus;
  pausedFrom: string | null;
  stopReason: string | null;
  stopDetail: string | null;
  currentGenerationIndex: number;
  callsUsed: number;
  tokensUsed: number;
  createdAt: string;
  updatedAt: string;
}

export interface GenerationMetrics {
  vector?: Record<string, number | null>;
  objective?: Record<string, Record<string, unknown>>;
  requiredViolations?: string[];
  reviewCounts?: Record<string, number>;
  /** Per confirmed rule, per attempt: supported / condition occurred /
   *  actually executed. Absent on generations stored before this existed. */
  ruleApplication?: RuleApplicationRecord[];
  /** What a controlled comparison holds fixed, per attempt. */
  manifest?: Record<string, Record<string, unknown>>;
  comparedToParent?: {
    controlled: boolean;
    differingInputs: string[];
    claim: string;
    policyDifference: { field: string; values: Record<string, unknown> }[];
    perActor: {
      actorId: string;
      beforeMinutes: number;
      afterMinutes: number;
      deltaMinutes: number;
      beforeContacts: number;
      afterContacts: number;
      deltaContacts: number;
    }[];
  };
}

export interface Generation {
  id: string;
  sessionId: string;
  index: number;
  parentGenerationId: string | null;
  policyRevisionId: string;
  label: string;
  attemptIds: string[];
  reviewIds: string[];
  synthesisId: string | null;
  changeSetIds: string[];
  outcome: string;
  appliedChangeSetId: string | null;
  confirmedBy: 'researcher' | 'none';
  confirmationReason: string;
  metrics: GenerationMetrics;
  createdAt: string;
}

export interface GenerationDetail extends Generation {
  reviews: AgentReview[];
  synthesis: ReviewSynthesis | null;
  changeSets: ChangeSet[];
  policy: { id: string; label: string; changes: string[] } | null;
  /** The rule catalogue with this generation's current values. */
  ruleCatalog: RuleSpec[];
}

export interface EpisodeCard {
  id: string;
  attemptId: string;
  actorId: string;
  title: string;
  fromSeq: number;
  toSeq: number;
  eventIds: string[];
  summary: string;
  simulatedReviewId: string | null;
  preQuestion: string;
  postQuestion: string;
}

export interface FieldReviewPackage {
  id: string;
  sessionId: string;
  generationId: string;
  coreItem: string;
  episodes: EpisodeCard[];
  policySummary: string[];
  openQuestions: string[];
  dissentToShow: string[];
  consentNote: string;
  createdAt: string;
}

export interface DesignerDecision {
  id: string;
  sessionId: string;
  chosenGenerationId: string | null;
  disposition: 'adopt_for_field_review' | 'hold' | 'reject';
  alternativesConsidered: string[];
  reasons: string[];
  supportedConditions: string[];
  tradeoffs: string[];
  dissent: string[];
  unansweredQuestions: string[];
  fieldReviewPackageId: string | null;
  createdAt: string;
}

export interface HumanReview {
  id: string;
  sessionId: string;
  packageId: string;
  reviewerRole: string;
  actorId: string | null;
  selectedEpisodeIds: string[];
  elicitation: string;
  responses: Record<string, unknown>[];
  corrections: Record<string, unknown>[];
  agreement: string;
  source: 'human';
  submittedAt: string;
  note: string;
  // The staged protocol (26번 C06). Present on records written from
  // 2026-09-15; older rows keep their own values untouched.
  respondentId: string;
  respondentRole: 'self' | 'family' | 'institution_staff' | 'researcher';
  /** Which modelled resident this is *about* - not who is answering. */
  subjectActorId: string | null;
  episodeId: string | null;
  reviewItemRefs: string[];
  responseStage: 'pre_disclosure' | 'post_disclosure';
  disclosureRecordId: string | null;
  correspondence: 'agreement' | 'correction' | 'disagreement' | 'unknown' | null;
  correctionTarget:
    | 'case_material'
    | 'world_assumption'
    | 'behaviour_model'
    | 'service_rule'
    | 'evaluation'
    | 'synthesis'
    | null;
  reason: string;
  responseKind: 'resident_response' | 'researcher_note';
}

/** When a respondent was shown the simulated evaluation, and what they saw. */
export interface DisclosureRecord {
  id: string;
  sessionId: string;
  packageId: string;
  episodeId: string;
  respondentId: string;
  disclosedBy: string;
  disclosedAt: string;
  shownReviewIds: string[];
  note: string;
}

export const CORRESPONDENCE_LABELS: Record<string, string> = {
  agreement: '대체로 일치',
  correction: '정정 필요',
  disagreement: '충돌 (다르다)',
  unknown: '판단 불가',
  // Kept for records written before 2026-09-15, shown as stored.
  partial: '일부 일치 (옛 기록)',
};

export const CORRECTION_TARGET_LABELS: Record<string, string> = {
  case_material: '자료 (채록·관계·일과)',
  world_assumption: '세계 가정 (연락·거리 등)',
  behaviour_model: '주민 행동 모델',
  service_rule: '서비스 운영 규칙',
  evaluation: '이 평가 자체',
  synthesis: '평가 종합',
};

export interface Capabilities {
  /** Which service is being evaluated (server iteration/services.py). */
  service?: { serviceId: string; label: string; category: string };
  /** Which community is loaded, and which roles it has (server case_bundle.py). */
  case?: {
    caseId: string;
    label: string;
    sourceKind: string;
    residentCount: number;
    roleAssignments: Record<string, string>;
  };
  supportedCapabilities: string[];
  supportedQuestIds: string[];
  supportedTaskIds: string[];
  supportedRuleFields: string[];
  supportedRules: RuleSpec[];
  decks: { id: string; label: string; questId?: string | null; questIds?: string[] }[];
  modes: Record<string, boolean>;
  notImplemented: string[];
  model: {
    provider: string | null;
    model: string | null;
    configured: boolean;
    promptVersion: string;
    note: string;
    envKeys: string[];
  };
  adapterModes: Record<string, string>;
  villageModel: Catalog['adapters']['model'] | null;
}

export interface SessionStatusPayload {
  session: IterationSession;
  adapterMode: string;
  stopReasonText: string | null;
  generationCount: number;
  running: boolean;
  budget: {
    callBudget: number;
    callsUsed: number;
    tokenBudget: number;
    tokensUsed: number;
    note: string;
  };
}

export interface SessionDetail extends SessionStatusPayload {
  /** True when the researcher may author, save, confirm or decline a change
   *  for the current generation - including when no valid draft exists. */
  canAuthor: boolean;
  generations: GenerationDetail[];
  decisions: DesignerDecision[];
  fieldPackages: FieldReviewPackage[];
  humanReviews: HumanReview[];
  disclosures: DisclosureRecord[];
  modelCalls: Record<string, unknown>[];
  capabilities: Capabilities;
}

export interface GenerationComparison {
  sessionId: string;
  criteria: CriteriaRevision;
  initialSnapshotHash: string;
  note: string;
  generations: (Pick<
    Generation,
    'id' | 'index' | 'label' | 'parentGenerationId' | 'policyRevisionId' | 'outcome' |
    'confirmedBy' | 'confirmationReason' | 'attemptIds'
  > & {
    vector: Record<string, number | null>;
    reviewCounts: Record<string, number>;
    requiredViolations: string[];
    comparedToParent: GenerationMetrics['comparedToParent'];
    policy: { id: string; label: string; changes: string[]; params: Record<string, unknown> } | null;
  })[];
}
