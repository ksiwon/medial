import type { AgentReview, GenerationDetail, UsageStatus } from '../api/iteration';

// One version's readable facts, aggregated from the stored metrics of the
// attempts that version ran.
//
// The rule that shapes every field: a value the runs did not establish stays
// `null` and prints as 미수집. Nothing is filled in with a zero, because a zero
// reads as "none at all" and that is a different claim. Nothing is combined into
// an overall score, because the criteria have no common unit and averaging them
// would manufacture a winner.

/** A number the runs established, or an honest gap. */
export interface Measure {
  value: number | null;
  /** What the number counts and over what - the denominator doc 15 asks for. */
  basis: string;
}

export interface BurdenRow {
  actorId: string;
  minutes: number;
  contacts: number;
}

export interface VersionFacts {
  generation: GenerationDetail;
  attemptCount: number;
  requestsRaised: Measure;
  requestsResolved: Measure;
  requestsUnresolved: Measure;
  meanWaitMinutes: Measure;
  neighbourMinutes: Measure;
  institutionMinutes: Measure;
  /** Sorted worst-first, so a total cannot hide one person carrying it. */
  burden: BurdenRow[];
  contactAttempts: Measure;
  transportNeeds: Measure;
  transportCompleted: Measure;
  /** How many residents ended in each usage state, from their own reviews. */
  usage: Partial<Record<UsageStatus, number>>;
  reviewCounts: { positive: number; mixed: number; negative: number; unknown: number; noExperience: number };
  /** Quotes with an event behind them; anything ungrounded is left out. */
  groundedQuotes: { actorId: string; attemptId: string; eventId: string; text: string }[];
  newProblems: string[];
}

const dig = (source: unknown, ...path: string[]): unknown => {
  let node: unknown = source;
  for (const key of path) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
};

const numbers = (rows: unknown[]): number[] =>
  rows.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

/** Sum across the version's attempts, or null when no attempt reported it. */
function sumAcross(objectives: unknown[], ...path: string[]): number | null {
  const found = numbers(objectives.map((o) => dig(o, ...path)));
  return found.length === 0 ? null : found.reduce((a, b) => a + b, 0);
}

/** Mean across attempts, weighted equally. Used only where a mean is what the
 *  server already computed (it excludes unresolved requests itself). */
function meanAcross(objectives: unknown[], ...path: string[]): number | null {
  const found = numbers(objectives.map((o) => dig(o, ...path)));
  return found.length === 0 ? null : found.reduce((a, b) => a + b, 0) / found.length;
}

export function versionFacts(generation: GenerationDetail): VersionFacts {
  const objective = generation.metrics.objective ?? {};
  const objectives = Object.values(objective);
  const reviews = generation.reviews;

  const burdenMap = new Map<string, BurdenRow>();
  for (const attempt of objectives) {
    const rows = dig(attempt, 'residentBurden');
    if (rows === null || typeof rows !== 'object') continue;
    for (const [actorId, value] of Object.entries(rows as Record<string, unknown>)) {
      const current = burdenMap.get(actorId) ?? { actorId, minutes: 0, contacts: 0 };
      const minutes = dig(value, 'addedTaskMinutes');
      const contacts = dig(value, 'contactsReceived');
      current.minutes += typeof minutes === 'number' ? minutes : 0;
      current.contacts += typeof contacts === 'number' ? contacts : 0;
      burdenMap.set(actorId, current);
    }
  }

  const usage: Partial<Record<UsageStatus, number>> = {};
  for (const review of reviews) {
    usage[review.usageStatus] = (usage[review.usageStatus] ?? 0) + 1;
  }

  const counts = generation.metrics.reviewCounts ?? {};

  return {
    generation,
    attemptCount: objectives.length,
    requestsRaised: {
      value: sumAcross(objectives, 'requests', 'raised'),
      basis: `시나리오 ${objectives.length}개 하루 합계`,
    },
    requestsResolved: {
      value: sumAcross(objectives, 'requests', 'resolved'),
      basis: '해결로 종료된 요청 수',
    },
    requestsUnresolved: {
      value: sumAcross(objectives, 'requests', 'unresolved'),
      basis: '관측 구간이 끝날 때까지 열려 있던 요청 수',
    },
    meanWaitMinutes: {
      value: meanAcross(objectives, 'waitMs', 'meanMinutesResolvedOnly'),
      basis: '분 · 해결된 요청만 · 미해결 건은 평균에서 제외(censored)',
    },
    neighbourMinutes: {
      value: sumAcross(objectives, 'neighbourMinutes'),
      basis: '분 · 주민이 부탁받은 일에 쓴 시간 합계',
    },
    institutionMinutes: {
      value: sumAcross(objectives, 'institutionBurden', 'staffMinutes'),
      basis: '분 · 보건소 담당자 업무 시간 (실험 자원 가정 기반)',
    },
    burden: [...burdenMap.values()].sort((a, b) => b.minutes - a.minutes || b.contacts - a.contacts),
    contactAttempts: {
      value: sumAcross(objectives, 'contacts', 'attempts'),
      basis: '회 · 무응답을 거절로 합치지 않음',
    },
    transportNeeds: {
      value: sumAcross(objectives, 'transport', 'needsRaised'),
      basis: '건 · 이동이 필요해진 횟수 (분모)',
    },
    transportCompleted: {
      value: sumAcross(objectives, 'transport', 'ridesCompleted'),
      basis: '건 · 실제로 태워 준 동승',
    },
    usage,
    reviewCounts: {
      positive: counts.positive ?? 0,
      mixed: counts.mixed ?? 0,
      negative: counts.negative ?? 0,
      unknown: counts.unknown ?? 0,
      noExperience: counts.noExperience ?? 0,
    },
    groundedQuotes: groundedQuotes(reviews),
    newProblems: newProblems(generation),
  };
}

/** Reasons a resident gave that cite an actual event. An item with no event
 *  reference is not quoted: there would be nothing to click through to. */
function groundedQuotes(reviews: AgentReview[]) {
  const out: VersionFacts['groundedQuotes'] = [];
  for (const review of reviews) {
    for (const item of review.items) {
      if (item.assessment === 'unknown' || item.eventRefs.length === 0) continue;
      out.push({
        actorId: review.actorId,
        attemptId: review.attemptId,
        eventId: item.eventRefs[0],
        text: item.reason,
      });
    }
  }
  // Negative and mixed first: a majority summary must not bury the person who
  // came off worse.
  const weight = (quote: (typeof out)[number]) => {
    const review = reviews.find((r) => r.actorId === quote.actorId);
    const kinds = review?.items.map((i) => i.assessment) ?? [];
    return kinds.includes('negative') ? 0 : kinds.includes('mixed') ? 1 : 2;
  };
  return out.sort((a, b) => weight(a) - weight(b));
}

/** What this version broke or made worse, taken from the synthesis and from the
 *  proposal that produced it - never inferred from the numbers going up. */
function newProblems(generation: GenerationDetail): string[] {
  const out: string[] = [];
  for (const issue of generation.synthesis?.issueGroups ?? []) {
    if (issue.severity === 'blocking' || issue.severity === 'significant') {
      out.push(`${issue.title}${issue.minority ? ' (소수 의견)' : ''}`);
    }
  }
  for (const conflict of generation.synthesis?.conflicts ?? []) {
    out.push(`이해관계 충돌: ${conflict.description}`);
  }
  for (const violation of generation.metrics.requiredViolations ?? []) {
    out.push(`필수 조건 위반: ${violation}`);
  }
  return out;
}

/** The condition changes between two versions, as the server computed them.
 *  Returns null when the pair has no recorded parent relationship - in which
 *  case the screen says the comparison is not a controlled one rather than
 *  printing a diff it cannot justify. */
export function conditionDiff(
  left: GenerationDetail,
  right: GenerationDetail,
): {
  controlled: boolean;
  differingInputs: string[];
  claim: string;
  rows: { field: string; before: unknown; after: unknown }[];
} | null {
  const compared = right.metrics.comparedToParent;
  const direct = compared != null && right.parentGenerationId === left.id;

  if (direct && compared) {
    const rows = compared.policyDifference.map((entry) => {
      const values = Object.values(entry.values);
      return { field: entry.field, before: values[0], after: values[1] };
    });
    return {
      controlled: compared.controlled,
      differingInputs: compared.differingInputs,
      claim: compared.claim,
      rows,
    };
  }

  // Not a parent/child pair. The policy labels still say what each side is, and
  // the screen must not present the two as a controlled experiment.
  return {
    controlled: false,
    differingInputs: ['두 버전이 직접적인 부모-자식 관계가 아닙니다'],
    claim:
      '이 두 버전은 서로 직접 파생 관계가 아니라서, 차이가 운영 조건 하나 때문이라고 말할 수 없습니다.',
    rows: [],
  };
}
