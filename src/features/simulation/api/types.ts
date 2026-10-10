// Mirrors server/app/simulation/contracts.py and the /api/sim payloads.
// Hand-written rather than generated: generating them from OpenAPI is on the
// backlog, and until then this file is the place where a server change has to be
// noticed. Anything the server marks as an assumption keeps that word here.

export type ViewMode = 'researcher' | 'medial';
export type Lineage = 'root' | 'rerun' | 'fork';

export interface DomainEvent {
  id: string;
  attemptId: string;
  seq: number;
  simTimeMs: number;
  type: string;
  actorId: string;
  causationId: string | null;
  correlationId: string;
  visibility: string[];
  committed: true;
  payload: Record<string, unknown>;
}

export interface Candidate {
  actorId: string;
  included: boolean;
  reason: string;
}

export interface DecisionRecord {
  id: string;
  attemptId: string;
  simTimeMs: number;
  policyId: string;
  question: string;
  candidates: Candidate[];
  chosen: string | null;
  rationale: string;
  knownFacts: string[];
  observationIds: string[];
  excludedByPermission: string[];
}

export interface PolicyParams {
  retryCount: number;
  retryIntervalMin: number;
  quietWindowMin: number;
  helperContactCap: number;
  disclosure: 'minimal' | 'named';
  escalateToInstitutionAfterMin: number | null;
  allowHeadContact: boolean;
  rideCandidateOrder?: string;
  maxRideDetourMin?: number;
  [key: string]: unknown;
}

export interface PolicyRevision {
  id: string;
  parentId: string | null;
  coreItem: string;
  label: string;
  changes: string[];
  contactStrategy: string;
  params: PolicyParams;
  assumptionRefs: string[];
}

/** One editable condition, as the server declares it. The UI builds its form
 *  from this rather than from a hard-coded list, so a field the engine does not
 *  read cannot appear on screen. */
export interface PolicyField {
  name: string;
  /** JSON-schema type name: integer | boolean | string. */
  type: 'integer' | 'boolean' | 'string' | string;
  /** Optional field: "없음" is a legal value, not an empty form. */
  nullable: boolean;
  default: unknown;
  minimum: number | null;
  maximum: number | null;
  enum: string[] | null;
  description: string;
}

export interface Attempt {
  id: string;
  parentId: string | null;
  parentSeq: number | null;
  lineage: Lineage;
  label: string;
  policyId: string;
  scenarioDeckId: string;
  personaRevisionId: string;
  baselineRevisionId: string;
  resourceRevisionId: string;
  seed: number;
  mode: string;
  status: string;
  engineVersion: string;
  adapter: string;
  /** Which world rules, which realized day, which relation graph. Fixed
   *  inputs: a change set cannot touch them, and two runs are a controlled
   *  pair only when all three match. */
  environmentRevisionId: string;
  dayRealizationId: string | null;
  relationRevisionId: string;
  createdAt: string;
  cursorSeq: number;
  eventCount: number;
  dataSource: string;
  inputHashes: Record<string, string>;
}

export interface Segment {
  startMs: number;
  endMs: number;
  kind: 'stay' | 'travel' | 'patrol';
  origin: 'baseline' | 'task';
  label: string;
  place: string | null;
  fromPlace: string | null;
  toPlace: string | null;
  mode: 'walk' | 'drive' | 'boat' | 'offmap' | 'stay';
  metres: number;
  requestId: string | null;
  interruptible: boolean;
  polyline?: [number, number][];
  /** Off the map although not in town - out fishing, taken to hospital. The
   *  label says why; the map lists the person under it instead. */
  offMap?: boolean;
  xy?: [number, number];
  riders?: string[];
}

export interface TimelineActor {
  id: string;
  displayName: string;
  isVillageHead: boolean;
  group: string;
  homeXY: [number, number];
  baseline: Segment[];
  realized: Segment[];
  planChanged: boolean;
  addedTaskMs: number;
  contactsReceived: number;
}

export interface Reservation {
  id: string;
  requestId: string;
  driverId: string;
  riderId: string;
  seatIndex: number;
  departMs: number;
  pickupPlace: string;
  destination: string;
  returnDepartMs: number | null;
  returnDriverId: string | null;
  status: 'held' | 'picked_up' | 'completed' | 'cancelled';
  conditions: string[];
}

export interface Timeline {
  horizonMs: number;
  actors: Record<string, TimelineActor>;
  reservations?: {
    seatsPerVehicle: number;
    seatAssumption: string;
    reservations: Reservation[];
    activeCount: number;
    cancelledCount: number;
  };
}

export interface ReviewDimension {
  key: string;
  assessment: 'positive' | 'mixed' | 'negative' | 'unknown';
  reason: string;
}

export interface ExperienceReview {
  id: string;
  attemptId: string;
  actorId: string;
  source: 'simulated' | 'human' | 'researcher';
  experiencedEventIds: string[];
  dimensions: ReviewDimension[];
  assessment: 'positive' | 'mixed' | 'negative' | 'unknown';
  comment: string;
  unknowns: string[];
}

export interface Burden {
  addedTaskMinutes: number;
  addedTravelMetres: number;
  interruptions: number;
  contactsReceived: number;
  /** Who did the asking. MEDial's own ledger only ever has the first.
   *  Absent on attempts stored before the split existed. */
  askedByMedial?: number;
  askedByNeighbour?: number;
  basis: string;
}

/** One request a resident passed to another. Researcher-only knowledge: MEDial
 *  was told the person it asked accepted, and never hears the rest. */
export interface Handover {
  requestId: string;
  subjectId: string | null;
  askedActorId: string;
  chain: string[];
  hops: { fromActorId: string; toActorId: string; atMs: number; basis: string | null;
          relationKind: string | null }[];
  /** null when nobody went: the person it was handed to said no. */
  performedBy: string | null;
  outcome: string;
}

export interface Refusal {
  requestId: string | null;
  actorId: string;
  kind: 'declined' | 'deferred';
  /** Machine key of the rule that fired (or the ride-path code). */
  rule: string;
  /** The sentence the person is recorded as giving, when there is one. */
  reason: string | null;
  atMs: number;
  seenByMedial: boolean;
}

export interface StepChange {
  index: number;
  kind: 'jitter' | 'clamp' | 'skip_outing' | 'repeat_outing';
  target: string;
  beforeMs: number | null;
  afterMs: number | null;
  note: string;
}

/** The day a run took place on: the recorded routine, possibly nudged within
 *  the bounds the environment states. A pure function of (village, environment,
 *  seed), so a rerun lands on the same day without copying anything. */
export interface ElicitationGap {
  actorId: string;
  topic: string;
  status: 'recorded' | 'partial' | 'asked_none' | 'not_asked';
  /** Already in words: "P1 · 부탁하거나 도움을 청하는 사람: 안 물어봄". */
  text: string;
}

export interface Elicitation {
  ledgerId: string;
  involved: string[];
  gaps: ElicitationGap[];
  leanedOn: { kind: string; knowerId?: string; subjectId?: string; reason?: string }[];
  note: string;
}

export interface DayRealization {
  id: string;
  seed: number;
  villageContentHash: string;
  environmentRevisionId: string;
  classification: 'source_baseline' | 'source_jittered' | 'plausible_extension';
  residents: { actorId: string; steps: unknown[]; changes: StepChange[];
               excludedReason: string | null }[];
  assumptions: string[];
}

export interface TransportMetrics {
  needsRaised: number;
  peopleAsked: number;
  reservationsHeld: number;
  ridesCompleted: number;
  conflictsDetected: number;
  conflictReasons: string[];
  cancelled: number;
  seatAssumption: string;
  note: string;
}

export interface Metrics {
  requests: {
    raised: number;
    resolved: number;
    unresolved: number;
    outcomes: string[];
    resolutionPaths: string[];
  };
  waitMs: {
    resolvedOnly: number[];
    meanMinutesResolvedOnly: number | null;
    censoredCount: number;
    note: string;
  };
  contacts: {
    attempts: number;
    byResult: Record<string, number>;
    toSubject: number;
    note: string;
  };
  residentBurden: Record<string, Burden>;
  neighbourMinutes: number;
  institutionBurden: {
    staffCount: number;
    shiftStartMs: number;
    shiftEndMs: number;
    staffMinutes: number;
    preexistingBacklogMinutes: number;
    queueWaitMinutes: number;
    items: { label: string; startMs: number; endMs: number; minutes: number; staff: number }[];
    travelBasis: string;
    note: string;
  };
  disclosure: Record<string, { recipientCount: number; fieldCount: number }>;
  transport: TransportMetrics;
  /** These three are absent on attempts stored before they were computed;
   *  a stored run is never recomputed, so the screens treat them as optional. */
  handovers?: {
    count: number;
    rows: Handover[];
    peopleAskedByMedial: string[];
    peopleAskedByNeighbour: string[];
    note: string;
  };
  refusals?: { count: number; byRule: Record<string, number>; rows: Refusal[]; note: string };
  dayRealization?: DayRealization;
  /** What was asked of whom (the elicitation ledger), restricted to the people
   *  this day involved, and the assumed facts a decision actually rested on. */
  elicitation?: Elicitation;
  safety: {
    emergencyClassifications: number;
    expected: number;
    emergencyRuleOutClaims: number;
    note: string;
  };
  adapterFailures: number;
  rejectedProposals: number;
  decisionCount: number;
  eventCount: number;
  personaProvenance: PersonaProvenance;
}

export interface TraceStep {
  atMs: number;
  decisionId: string;
  question: string;
  chosen: string | null;
  policyId: string;
}

export interface DeckPayload {
  id: string;
  label: string;
  classification: string;
  assumptions: string[];
  horizonMs: number;
  events: { id: string; simTimeMs: number; type: string; subjectId: string;
            prohibitedInferences: string[] }[];
  note: string;
}

export interface ResourceRevision {
  id: string;
  label: string;
  staffCount: number;
  shiftStartMs: number;
  shiftEndMs: number;
  reviewMinutes: number;
  callMinutes: number;
  visitTravelMinutes: number;
  visitMinutes: number;
  initialQueueDepth: number;
  assumedVehicleSeats?: number;
  assumptions: string[];
}

/** Whether one of the revision's rules fired in this attempt, and on which
 *  events (server iteration/rule_application.py `rule_trace`). The label and
 *  sentence are the rule's own words from semantic_rules. */
export interface RuleTraceRecord {
  ruleType: string;
  label: string;
  sentence: string;
  conditionStatus: 'occurred' | 'not_occurred' | 'unknown';
  executionStatus: 'applied' | 'not_reached' | 'unknown';
  reason: string;
  eventRefs: string[];
}

export interface AttemptDetail {
  attempt: Attempt;
  metrics: Metrics;
  policy: PolicyRevision;
  logFingerprint: string;
  timeline: Timeline | null;
  trace: TraceStep[];
  decisions: DecisionRecord[];
  rules: RuleTraceRecord[];
  reviews: ExperienceReview[];
  deck: DeckPayload;
  resources: ResourceRevision;
  lineageNote?: string;
  /** The day as scenes, when the record carries them (the exhibition record,
   *  scripts/import_exhibition.py); null when the screen derives them from the
   *  log. */
  scenes?: StoredScenes | null;
}

/** A day recorded as scenes: what was said is stored with it, not in the log. */
export interface StoredScenes {
  source: string;
  model: string;
  day: number;
  title: string;
  summary: string;
  /** Pseudonyms of the anonymised persona pack the record was made from. */
  people: Record<string, string>;
  episodes: import('../scene/types').Episode[];
  /** The Tasks worth playing when a visitor has minutes, not a quarter hour. The record says which
   *  (scripts/import_exhibition.py FEATURED); the screen chooses nothing. */
  featured?: string[];
  /** The Tasks known before they begin - MEDial's own check-in call, a booked appointment. The
   *  timeline lists these ahead of the playhead and nothing else (scripts/import_exhibition.py SCHEDULED). */
  scheduled?: string[];
  /** MEDial's panel for each Task, by the Task's id (an episode's requestId). */
  panels: Record<string, { subtitle: string; judgment: import('../scene/judgment').Judgment }>;
}

export interface DataIssue {
  id: string;
  claim: string;
  observed: string;
  action: string;
  severity: string;
  status: 'open' | 'resolved';
}

export interface Place {
  id: string;
  label: string;
  x: number;
  y: number;
  provenance: string;
  offMap?: boolean;
  offRoad?: boolean;
  anchor: { node: string; offsetPx: number };
}

export interface VillagePayload {
  dataSource: string;
  isSynthetic: boolean;
  contentHash: string;
  geometry: {
    frame: { width: number; height: number; mPerPx: number };
    sourceFrame: Record<string, unknown>;
    northUpTransform: { formula: string; derivation: string; confidence: string };
    orientationChecks?: {
      longAxis: string;
      northSouthExtentM: number;
      eastWestExtentM: number;
      crossChecks: string[];
      pairs: Record<string, unknown>;
    };
    viewBox: [number, number, number, number];
  };
  travel: Record<string, number | string>;
  places: Record<string, Place>;
  homes: Record<string, { x: number; y: number; provenance: string;
                          anchor: { node: string; offsetPx: number } }>;
  roads: Record<string, [number, number][]>;
  patrol: [number, number][];
  groups: Record<string, { fill: string; fg: string; label: string; note: string }>;
  residents: {
    id: string; displayName: string; isVillageHead: boolean; group: string;
    age: number | null; job: string | null; pinnedAtHome: boolean;
    home: { x: number; y: number }; overlayCount: number;
  }[];
  dataIssues: DataIssue[];
  roadGraphProvenance: {
    edgeCount: number; allEdgesFromSourcePolylines: boolean;
    junctionNodeCount: number; method: string;
  };
  namedRouteDistances: Record<string, { sourceM: number; graphM: number; deltaM: number }>;
  /** Present only when the registry was built from the source. The raster is
   *  served from the local API, never bundled. */
  mapImage: {
    file: string;
    bytes: number;
    sha256: string;
    sourceWidthPx: number;
    sourceHeightPx: number;
    mPerPx: number;
    northUpMatrix: [number, number, number, number, number, number];
    provenance: string;
    caveat: string;
  } | null;
}

export interface PersonaProvenance {
  dataSource: string;
  revisionId: string;
  personaCount: number;
  sourceName?: string;
  jointInterview: string[];
  noInterview: string[];
  note: string;
}

export interface DesignFinding {
  id: string;
  createdAt: string;
  coreItem: string;
  comparedAttemptIds: string[];
  observation: string;
  interpretation: string;
  nextChange: string;
  fromPolicyId: string;
  resultingPolicyId: string | null;
  resultingAttemptId: string | null;
  author: 'researcher';
}

/** Which version the server is. ``sim`` plays what ``real`` ran earlier and
 *  never calls a model; ``real`` generates as it goes. See server ``mode.py``. */
export type ServerMode = 'sim' | 'real';

export interface Catalog {
  mode: ServerMode;
  engineVersion: string;
  village: { dataSource: string; isSynthetic: boolean; contentHash: string;
             residentCount: number; dataIssues: DataIssue[] };
  personas: PersonaProvenance;
  policies: PolicyRevision[];
  decks: { id: string; label: string; classification: string; assumptions: string[];
           horizonMs: number; eventCount: number }[];
  resourceSets: ResourceRevision[];
  policyFields: {
    supported: string[];
    fields: PolicyField[];
    strategies: string[];
    note: string;
  };
  adapters: {
    available: string[];
    unavailable: string[];
    /** The two tiers an ``llm`` attempt would run on; null without a key. */
    model: {
      provider: string | null;
      configured: boolean;
      headModel: string;
      residentModel: string;
      temperature: number;
      promptRevision: string;
      note: string;
    } | null;
    note: string;
  };
  attempts: Attempt[];
  findings: DesignFinding[];
}

export interface CommandResult {
  attemptId: string;
  cursorSeq: number;
  playState: 'playing' | 'paused';
  eventCount: number;
  replayOnly: true;
  note: string;
  deduplicated: boolean;
}
