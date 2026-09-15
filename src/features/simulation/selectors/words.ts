import type { DayRealization, StepChange } from '../api/types';
import { formatClock } from '../positions';
import { personName } from './story';

// Plain words for the engine's own vocabulary: policy fields, contact
// strategies, decline rules, the realized day.
//
// One place, so the three screens cannot disagree about what `neighbour_first`
// is called. An id this file does not know is returned as it is - an unfamiliar
// key is better than a wrong translation - and every screen that prints one of
// these goes through here rather than keeping its own copy.

const STRATEGY: Record<string, string> = {
  head_first: '이장에게 먼저',
  retry_then_clinic: '본인 재연락 후 보건소',
  neighbour_first: '가까운 이웃에게 먼저',
  relation_first: '가까운 관계에게 먼저, 이장은 마지막',
};

export const strategyName = (id: string): string => STRATEGY[id] ?? id;

const PARAM: Record<string, string> = {
  contactStrategy: '연락 순서',
  retryCount: '재연락 횟수',
  retryIntervalMin: '재연락 간격(분)',
  quietWindowMin: '연락 사이 최소 간격(분)',
  helperContactCap: '한 사람이 하루에 받는 부탁 상한',
  neighbourAskLimit: '한 건에 이웃 몇 명까지 물어보는가',
  disclosure: '상대에게 알리는 정보 범위',
  escalateToInstitutionAfterMin: '보건소 인계 기한(분)',
  allowHeadContact: '이장에게 물어봐도 되는가',
  rideCandidateOrder: '동승 후보 순서',
  maxRideDetourMin: '운전자에게 허용하는 우회 시간(분)',
};

export const paramName = (field: string): string => PARAM[field] ?? field;

export function paramValue(value: unknown): string {
  if (value === null || value === undefined) return '없음';
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  if (typeof value === 'string' && value in STRATEGY) return STRATEGY[value];
  if (value === 'minimal') return '최소한만';
  if (value === 'named') return '이름까지';
  return String(value);
}

/** The inputs a controlled comparison holds fixed, named for a reader. */
const INPUT: Record<string, string> = {
  deck: '시나리오',
  resources: '보건소 자원 가정',
  village: '마을 기록',
  environment: '마을 규칙',
  day: '뽑힌 하루',
  relations: '관계 기록',
  ledger: '채록 장부',
  modelPolicy: '모델 설정',
  persona: '페르소나',
  baseline: '기본 일과',
  engineVersion: '엔진 버전',
  adapter: '주민 어댑터',
  seed: '시드',
  dataSource: '자료 출처',
};

export const inputName = (id: string): string => INPUT[id] ?? id;

/** The line of the decline table that fired. The sentence a person gave lives
 *  on the event; this is the short name of the rule behind it. */
const RULE: Record<string, string> = {
  persona_condition: '본인이 말한 조건',
  cannot_leave_here: '지금 자리를 못 비움',
  asked_too_often: '오늘 부탁을 너무 많이 받음',
  too_far: '너무 멀어서',
  llm_judgement: '본인 판단 (모델)',
};

export const ruleName = (rule: string): string => RULE[rule] ?? rule;

// ---------------------------------------------------------------- the day

const DAY: Record<DayRealization['classification'], string> = {
  source_baseline: '기록된 하루 그대로',
  source_jittered: '기록된 시각이 조금 다른 하루',
  plausible_extension: '외출 하나가 다른 하루',
};

export const dayLabel = (day: DayRealization | undefined | null): string =>
  day ? DAY[day.classification] : '하루 기록 없음';

/** One line per edit the realization made, checkable against the source. */
export function dayChangeLines(day: DayRealization | undefined | null): string[] {
  if (!day) return [];
  const out: string[] = [];
  for (const resident of day.residents) {
    for (const change of resident.changes) {
      out.push(`${personName(resident.actorId)} · ${changeText(change)}`);
    }
    if (resident.excludedReason) {
      out.push(`${personName(resident.actorId)} · 그대로 둠 (${resident.excludedReason})`);
    }
  }
  return out;
}

function changeText(change: StepChange): string {
  const before = change.beforeMs === null ? null : formatClock(change.beforeMs);
  const after = change.afterMs === null ? null : formatClock(change.afterMs);
  const delta =
    change.beforeMs !== null && change.afterMs !== null
      ? Math.round((change.afterMs - change.beforeMs) / 60000)
      : null;
  switch (change.kind) {
    case 'jitter':
      return `${change.target} ${before} → ${after}${
        delta === null ? '' : ` (${delta > 0 ? `${delta}분 늦게` : `${-delta}분 일찍`})`
      }`;
    case 'clamp':
      return `${change.target} ${before} → ${after} (이동 시간에 맞춰 되돌림)`;
    case 'skip_outing':
      return `${change.target} 외출을 거름`;
    case 'repeat_outing':
      return `${change.target} 한 번 더 다녀옴`;
  }
}
