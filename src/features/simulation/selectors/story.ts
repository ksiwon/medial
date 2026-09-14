import type { DomainEvent } from '../api/types';
import { formatClock } from '../positions';

// Events, in sentences a person can read.
//
// This is a *presentation* mapper only. The stored log is untouched: every row
// keeps its own event id and seq, so "무엇을 요약했는지" can always be reopened
// as the original technical record. Nothing here merges two events into a claim
// neither of them makes, and nothing invents speech - an utterance is printed
// only when the payload carries one.

/** Engine bookkeeping that says nothing to a reader. Reachable under the technical
 *  disclosure, never in the default list. */
const BOOKKEEPING = new Set([
  'world.actor_moved',
  'world.actor_arrived',
  'world.copresence',
  'task.started',
  'attempt.completed',
]);

/** Researcher-only world facts: why a phone was not answered is knowledge the
 *  caller does not have. Kept out of the readable list even in researcher mode,
 *  where it stays available under the technical disclosure.
 *
 *  `world.relay_resolved` is *not* here. It is researcher-only too, but it is
 *  the one sentence the hand-off mechanism exists to produce - MEDial credits
 *  one person, another went - and it reads as a sentence. The view-mode filter
 *  upstream keeps it out of MEDial's view; in the researcher's it is shown. */
const WORLD_ONLY = new Set(['world.reachability_resolved']);

export type StoryTone = 'plain' | 'good' | 'attention' | 'bad';

export interface StoryRow {
  /** The originating event. Clicking a row seeks to exactly this seq. */
  event: DomainEvent;
  clock: string;
  text: string;
  tone: StoryTone;
  utterance: string | null;
}

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);

/**
 * How a person is named on screen, everywhere.
 *
 * Doc 15 section 5: the village head is "이장", everyone else is their P-number.
 * Exported because the request selector writes sentences too, and having each
 * one keep its own mapping is how the same person ends up as 이장 in one panel
 * and P6 in the panel beside it.
 */
export const personName = (id: string | null | undefined): string =>
  !id
    ? '누군가'
    : id === 'MEDial'
      ? 'MEDial'
      : id === 'P6'
        ? '이장'
        : id === 'HC_NURSE'
          ? '보건소 담당자'
          : id;

/** A list of actors, named the way every other panel names them. The synthesis
 *  and proposal payloads carry raw ids, and printing them straight made the
 *  comparison screen call 이장 "P6" while the person panel next to it called
 *  the same person 이장. */
export const nameList = (ids: readonly string[]): string => ids.map(personName).join(', ');

const person = personName;

/**
 * The machine-readable reason on an event payload, said in Korean.
 *
 * The codes are the engine's own vocabulary and they belong on the event - a
 * metric or a filter needs `driving_status_unknown`, not a sentence. What must
 * not happen is the code arriving in prose a person is supposed to read:
 * "이장이 거절했습니다 (driving_status_unknown)" makes the reader guess, and in
 * a resident's own review it reads as if they had said the code out loud.
 *
 * Reasons the engine already writes in Korean pass through untouched, and an
 * unmapped code is labelled as a code rather than silently dropped - losing the
 * reason would be worse than showing it.
 */
const REASON_TEXT: Record<string, string> = {
  does_not_drive: '운전을 하지 않는 사람이라서',
  driving_status_unknown: '운전을 할 수 있는지 원자료에 없어서',
  no_route: '그 길로는 갈 수 없어서',
  cannot_leave_post: '자리를 비울 수 없어서',
  detour_too_long: '우회 시간이 한도를 넘어서',
  detour_within_budget: '우회 시간이 한도 안이라서',
  contact_cap_reached: '연락 상한에 걸려서',
  activity_locked: '하던 일을 멈출 수 없어서',
  outside_shift: '근무 시간이 아니라서',
  queued_for_review: '검토 대기로 넘겨서',
  seats_exhausted: '남은 좌석이 없어서',
  duplicate_reservation: '이미 같은 예약이 있어서',
  driver_double_booked: '운전자가 이미 다른 예약에 묶여 있어서',
  rider_already_riding: '이미 다른 차에 타고 있어서',
  retry_scheduled: '다시 걸기로 예약해서',
  awaiting_escalation_deadline: '인계 기한을 기다리는 중이라서',
  proposal_rejected: '제안이 검증을 통과하지 못해서',
  adapter_error: '어댑터 오류로',
  unspecified: '사유가 지정되지 않아서',
};

export function reasonText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '사유 미기록';
  if (/[가-힣]/.test(value)) return value;
  return REASON_TEXT[value] ?? `기록된 사유 코드 ${value}`;
}

/**
 * Korean subject / object particles, chosen by the name they follow.
 *
 * "이장가 하겠다고 했습니다" is wrong; it has to be "이장이". The rule is whether
 * the last syllable ends in a consonant, which for a Hangul syllable is
 * ``(code - 0xAC00) % 28 !== 0``. Ids like "P1" end in a digit, so the digit is
 * read as the Korean numeral it is spoken as - 1 is 일 and takes 이, 2 is 이 and
 * takes 가 - which is what a reader would say out loud.
 */
const DIGIT_HAS_FINAL: Record<string, boolean> = {
  '0': true, // 영
  '1': true, // 일
  '2': false, // 이
  '3': true, // 삼
  '4': false, // 사
  '5': false, // 오
  '6': true, // 육
  '7': true, // 칠
  '8': true, // 팔
  '9': false, // 구
};

function endsWithConsonant(word: string): boolean {
  const last = word.trim().slice(-1);
  if (!last) return false;
  if (last in DIGIT_HAS_FINAL) return DIGIT_HAS_FINAL[last];
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  // Latin letters: read as their English names, most of which end in a vowel
  // sound. Not worth more than a default.
  return false;
}

export type Particle = 'subject' | 'object' | 'topic' | 'with';

/** ``name`` plus the particle that belongs after it. */
export function withParticle(name: string, particle: Particle): string {
  const hasFinal = endsWithConsonant(name);
  switch (particle) {
    case 'subject':
      return name + (hasFinal ? '이' : '가');
    case 'object':
      return name + (hasFinal ? '을' : '를');
    case 'topic':
      return name + (hasFinal ? '은' : '는');
    case 'with':
      return name + (hasFinal ? '과' : '와');
  }
}

/** Shorthand: the person's display name already carrying its subject particle. */
export const subj = (id: string | null | undefined) => withParticle(personName(id), 'subject');
export const obj = (id: string | null | undefined) => withParticle(personName(id), 'object');


const channelOf = (c: unknown): string =>
  ({ home_device: '안내 시계', phone: '전화', in_person: '직접 찾아가서' })[String(c)] ??
  String(c ?? '연락');

/** One readable sentence per event, or null when the event has nothing to say
 *  to a reader and belongs under the technical disclosure instead. */
export function sentenceFor(event: DomainEvent): { text: string; tone: StoryTone } | null {
  const p = event.payload as Record<string, unknown>;
  const who = person(event.actorId);
  const to = person(str(p.toActorId));
  const subject = person(str(p.subjectId));

  switch (event.type) {
    case 'world.day_started':
      return { text: '마을의 하루가 시작되었습니다.', tone: 'plain' };
    case 'request.raised':
      return { text: `${subject}의 안부를 확인할 필요가 생겼습니다.`, tone: 'attention' };
    case 'transport.need_raised':
      return {
        text: `${subject}에게 ${str(p.destination) ?? '읍내'}까지 갈 방법이 필요합니다.`,
        tone: 'attention',
      };
    case 'contact.attempted':
      return {
        text: `MEDial이 ${to}에게 ${channelOf(p.channel)} 연락했습니다 (${String(
          p.attemptNumber ?? 1,
        )}번째).`,
        tone: 'plain',
      };
    case 'contact.no_response':
      // Why nobody picked up is a fact of the world; the caller only learns
      // that nobody did.
      return {
        text: `${to}에게서 응답이 없었습니다. 연락한 쪽은 그 이유를 알 수 없습니다.`,
        tone: 'attention',
      };
    case 'contact.answered':
      return { text: `${withParticle(to, 'subject')} 응답했습니다.`, tone: 'good' };
    case 'medial.classified':
      return {
        text:
          p.locationStatus === undefined
            ? 'MEDial이 상황을 분류했습니다 (이 기록에는 위치·임상 상태 항목이 없습니다).'
            : `MEDial은 어디 있는지도 몸 상태도 확인하지 못한 상태로 판단했습니다.`,
        tone: 'plain',
      };
    case 'medial.decided':
      // Deliberately neutral about *what* was asked of them: the same decision
      // covers re-contacting the person themselves and asking a neighbour, and
      // "부탁하기로" is wrong for the first.
      return {
        text: str(p.chosen)
          ? `MEDial이 다음 상대로 ${obj(str(p.chosen))} 골랐습니다.`
          : 'MEDial이 연락할 사람을 찾지 못했습니다.',
        tone: str(p.chosen) ? 'plain' : 'attention',
      };
    case 'medial.waiting': {
      const until = num(p.untilMs);
      return {
        text: until
          ? `${formatClock(until)}에 다시 연락하기로 하고 기다립니다.`
          : `MEDial이 기다립니다 (${reasonText(p.reason)}).`,
        tone: 'plain',
      };
    }
    case 'medial.observed':
      return {
        text: `이장이 ${subject}는 ${str(p.suggestedPlace) ?? '어딘가'}에 있을 것이라고 알려주었습니다.`,
        tone: 'plain',
      };
    case 'request.offered':
      return { text: `${to}에게 ${subject} 확인을 부탁했습니다.`, tone: 'plain' };
    case 'request.accepted':
      return { text: `${withParticle(who, 'subject')} 하겠다고 했습니다.`, tone: 'good' };
    case 'request.declined':
      return {
        text: `${withParticle(who, 'subject')} 거절했습니다 (${reasonText(p.reason)}).`,
        tone: 'attention',
      };
    case 'request.deferred':
      return {
        text: `${withParticle(who, 'subject')} 나중으로 미뤘습니다${
          str(p.reason) ? ` (${reasonText(p.reason)})` : ''
        }.`,
        tone: 'attention',
      };
    // Reaches the reader only in researcher mode: the event is not addressed
    // to MEDial, and the upstream filter drops it from MEDial's view.
    case 'request.relayed':
      return {
        text: `${withParticle(who, 'subject')} ${to}에게 ${subject} 확인을 넘겼습니다${
          p.basis === 'copresent' ? ' (같이 있던 사람)' : ''
        }. MEDial은 이것을 모릅니다.`,
        tone: 'attention',
      };
    case 'world.relay_resolved':
      return {
        text: `MEDial은 ${withParticle(person(str(p.reportedBy)), 'subject')} 확인했다고 알고 있지만, 실제로 간 사람은 ${person(str(p.performedBy))}입니다.`,
        tone: 'attention',
      };
    case 'plan.modified':
      return {
        text: `${person(str(p.actorId))}의 원래 일과가 바뀌었습니다: ${str(p.change) ?? ''}`,
        tone: 'attention',
      };
    case 'task.travel_started': {
      const minutes = num(p.durationMs);
      return {
        text: `${withParticle(who, 'subject')} ${str(p.from) ?? '출발지'}에서 ${str(p.to) ?? '목적지'}로 떠났습니다${
          minutes ? ` (약 ${Math.round(minutes / 60000)}분)` : ''
        }.`,
        tone: 'plain',
      };
    }
    case 'task.travel_arrived':
      return { text: `${withParticle(who, 'subject')} ${str(p.place) ?? '목적지'}에 도착했습니다.`, tone: 'plain' };
    case 'task.check_performed':
      return str(p.outcome) === 'subject_found_well'
        ? { text: `${withParticle(who, 'subject')} ${str(p.place) ?? '그곳'}에서 ${withParticle(subject, 'object')} 만났습니다.`, tone: 'good' }
        : {
            text: `${withParticle(who, 'subject')} 갔지만 ${str(p.place) ?? '그곳'}에 ${withParticle(subject, 'topic')} 없었습니다.`,
            tone: 'bad',
          };
    case 'task.completed':
      return { text: `${withParticle(who, 'subject')} 부탁받은 일을 마쳤습니다.`, tone: 'good' };
    case 'transport.reservation_made':
      return {
        text: `${person(str(p.driverId))}의 차에 ${person(str(p.riderId))}의 자리를 잡았습니다 (출발 ${
          num(p.departMs) ? formatClock(num(p.departMs)!) : '시각 미기록'
        }).`,
        tone: 'good',
      };
    case 'transport.reservation_cancelled':
      return {
        text: `동승 예약이 취소되었습니다 (${reasonText(p.reason)}). 좌석은 돌아갔습니다.`,
        tone: 'attention',
      };
    case 'transport.conflict_detected':
      return {
        text: `${person(str(p.driverId))}의 차에 예약이 겹쳤습니다 (${reasonText(p.reason)}).`,
        tone: 'bad',
      };
    case 'transport.pickup':
      return {
        text: `${subj(str(p.riderId))} ${str(p.place) ?? '약속 장소'}에서 ${person(
          str(p.driverId),
        )}의 차를 탔습니다.`,
        tone: 'plain',
      };
    case 'transport.dropoff':
      return {
        text: `${subj(str(p.riderId))} ${str(p.place) ?? '목적지'}에서 내렸습니다.`,
        tone: 'plain',
      };
    case 'handoff.requested':
      return { text: `MEDial이 ${to}에 넘겼습니다.`, tone: 'attention' };
    case 'handoff.accepted':
      return { text: `${withParticle(who, 'subject')} 접수했습니다.`, tone: 'plain' };
    case 'institution.queued':
      return {
        text: `기관 대기열에 들어갔습니다 (앞선 ${String(p.queueDepth ?? '?')}건).`,
        tone: 'attention',
      };
    case 'institution.review_started':
      return { text: '기관 담당자가 검토를 시작했습니다.', tone: 'plain' };
    case 'institution.review_completed':
      return {
        text: `기관 검토가 끝났습니다: ${str(p.outcome) ?? '결과 미기록'}${
          num(p.callAtMs) ? ` · 연락 예정 ${formatClock(num(p.callAtMs)!)}` : ''
        }.`,
        tone: 'plain',
      };
    case 'need.resolved':
      return { text: `문제가 종료되었습니다 (${str(p.resolutionPath) ?? '경로 미기록'}).`, tone: 'good' };
    case 'need.unresolved':
      return {
        text: `해결되지 않은 채 끝났습니다 (${reasonText(p.reason)}).`,
        tone: 'bad',
      };
    default:
      return null;
  }
}

/**
 * The readable list. ``events`` must already be cut at the cursor and filtered
 * by view mode; this only decides what a reader can be shown.
 */
export function storyRows(events: DomainEvent[]): StoryRow[] {
  const rows: StoryRow[] = [];
  for (const event of events) {
    if (BOOKKEEPING.has(event.type) || WORLD_ONLY.has(event.type)) continue;
    const sentence = sentenceFor(event);
    if (!sentence) continue;
    rows.push({
      event,
      clock: formatClock(event.simTimeMs),
      text: sentence.text,
      tone: sentence.tone,
      utterance: str((event.payload as Record<string, unknown>).utterance),
    });
  }
  return rows;
}

/** Everything the readable list left out, so a summary can always be traced
 *  back to the raw record rather than replacing it. */
export function hiddenRows(events: DomainEvent[]): DomainEvent[] {
  return events.filter(
    (event) => BOOKKEEPING.has(event.type) || WORLD_ONLY.has(event.type) || !sentenceFor(event),
  );
}
