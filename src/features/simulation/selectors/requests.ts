import type { DecisionRecord, DomainEvent } from '../api/types';
import { pathWord, personName, placeWord, withParticle, reasonText } from './story';

// One request at a time, never all of them averaged into a single progress bar.
//
// The grouping key is the event's own ``correlationId``. That field already
// carries exactly this fact in the stored log (``req-P9-transport``,
// ``req-P11-transport``, ``world``), so nothing here has to guess which events
// belong together - which is the one thing doc 15 section 5 forbids. If a run's
// events ever arrive without it, the request list is empty and the panel says
// so rather than inventing a grouping.

export type StageKey = 'observe' | 'judge' | 'coordinate' | 'result';

export const STAGE_LABELS: Record<StageKey, string> = {
  observe: '관측',
  judge: '판단',
  coordinate: '조율',
  result: '결과',
};

/** Which stage an event belongs to. Types absent from this map are engine or
 *  world bookkeeping and are not part of a request's story. */
const STAGE_OF: Record<string, StageKey> = {
  'request.raised': 'observe',
  'transport.need_raised': 'observe',
  'contact.attempted': 'observe',
  'contact.no_response': 'observe',
  'contact.answered': 'observe',
  'medial.observed': 'observe',

  'medial.classified': 'judge',
  'medial.decided': 'judge',
  'medial.waiting': 'judge',

  'request.offered': 'coordinate',
  'request.accepted': 'coordinate',
  'request.declined': 'coordinate',
  'request.deferred': 'coordinate',
  'request.relayed': 'coordinate',
  'handoff.requested': 'coordinate',
  'handoff.accepted': 'coordinate',
  'institution.queued': 'coordinate',
  'institution.review_started': 'coordinate',
  'transport.reservation_made': 'coordinate',
  'transport.reservation_cancelled': 'coordinate',
  'transport.conflict_detected': 'coordinate',

  'plan.modified': 'result',
  'task.travel_started': 'result',
  'task.travel_arrived': 'result',
  'task.check_performed': 'result',
  'task.completed': 'result',
  'transport.pickup': 'result',
  'transport.dropoff': 'result',
  'institution.review_completed': 'result',
  'need.resolved': 'result',
  'need.unresolved': 'result',
};

export interface RequestStage {
  key: StageKey;
  /** Events of this stage that have happened at or before the cursor. */
  events: DomainEvent[];
  state: 'done' | 'current' | 'future';
}

export interface RequestFlow {
  id: string;
  /** The person the request is about, read from the first event's payload. */
  subjectId: string | null;
  title: string;
  events: DomainEvent[];
  stages: RequestStage[];
  /** Whether this request has reached need.resolved / need.unresolved. */
  closed: 'resolved' | 'unresolved' | null;
  firstMs: number;
  lastMs: number;
  /** Everyone MEDial contacted or moved for this request. */
  participants: string[];
}

const asRecord = (event: DomainEvent) => event.payload as Record<string, unknown>;
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** Group a run's events into requests. ``visible`` must already be filtered to
 *  the cursor and view mode; nothing here re-reads the future. */
export function requestFlows(visible: DomainEvent[]): RequestFlow[] {
  const byId = new Map<string, DomainEvent[]>();
  for (const event of visible) {
    const key = event.correlationId;
    // "world" is the engine's own bookkeeping stream (day started, attempt
    // completed). It is not a request and must not be shown as one.
    if (!key || key === 'world') continue;
    // A `world.*` event carries a request's correlation id but is a fact of the
    // world, not of the request: `world.reachability_resolved` says *why* a
    // phone went unanswered, which is researcher-only knowledge the caller
    // never has. Letting it into the flow put it in MEDial's own status line.
    if (event.type.startsWith('world.')) continue;
    byId.set(key, [...(byId.get(key) ?? []), event]);
  }

  return [...byId.entries()]
    .map(([id, events]) => {
      const ordered = [...events].sort((a, b) => a.seq - b.seq);
      const subjectId =
        ordered
          .map((event) => str(asRecord(event).subjectId) ?? str(asRecord(event).riderId))
          .find(Boolean) ?? subjectFromId(id);

      const stages: RequestStage[] = (
        ['observe', 'judge', 'coordinate', 'result'] as StageKey[]
      ).map((key) => ({
        key,
        events: ordered.filter((event) => STAGE_OF[event.type] === key),
        state: 'future' as const,
      }));
      // The furthest stage with anything in it is "current"; earlier ones with
      // content are done. A stage that never fired stays future and shows a
      // dash - it is not painted complete because a later one moved on.
      const lastFilled = stages.reduce(
        (acc, stage, index) => (stage.events.length > 0 ? index : acc),
        -1,
      );
      stages.forEach((stage, index) => {
        stage.state =
          index === lastFilled ? 'current' : index < lastFilled && stage.events.length > 0
            ? 'done'
            : 'future';
      });

      const resolved = ordered.some((e) => e.type === 'need.resolved');
      const unresolved = ordered.some((e) => e.type === 'need.unresolved');

      const participants = [
        ...new Set(
          ordered.flatMap((event) => {
            const p = asRecord(event);
            return [
              event.actorId,
              str(p.toActorId),
              str(p.subjectId),
              str(p.riderId),
              str(p.driverId),
            ].filter((x): x is string => Boolean(x) && x !== 'MEDial' && x !== 'ENGINE');
          }),
        ),
      ];

      return {
        id,
        subjectId,
        title: titleFor(id, subjectId, ordered),
        events: ordered,
        stages,
        closed: resolved ? ('resolved' as const) : unresolved ? ('unresolved' as const) : null,
        firstMs: ordered[0]?.simTimeMs ?? 0,
        lastMs: ordered[ordered.length - 1]?.simTimeMs ?? 0,
        participants,
      };
    })
    .sort((a, b) => a.firstMs - b.firstMs || a.id.localeCompare(b.id));
}

/** The person a correlation id is about. Ids come in two shapes in the stored
 *  logs - ``req-P1-1`` and ``checkin-P1`` - so the resident token is found by
 *  pattern rather than by position, and a shape neither matches yields null
 *  instead of a fragment like "checkin". */
function subjectFromId(id: string): string | null {
  return id.split(/[-_]/).find((part) => /^P\d+$/.test(part)) ?? null;
}

/**
 * A name for the request, distinct from every other request in the same run.
 *
 * One person can be the subject of two correlation groups on the same day - the
 * routine check-in (``checkin-P1``) and the request it raised (``req-P1-1``) -
 * so the title has to say which is which. Naming both after the resident put
 * two identical options in the picker.
 */
function titleFor(id: string, subjectId: string | null, events: DomainEvent[]): string {
  const resolved = subjectId ?? subjectFromId(id);
  // Fall back to the raw correlation id rather than to "누군가": an id we could
  // not read a person out of is still a better label than a pronoun.
  const who = resolved ? personName(resolved) : id;
  const opener = events[0];
  const types = new Set(events.map((e) => e.type));

  if (opener?.type === 'transport.need_raised' || types.has('transport.need_raised')) {
    const to = str(asRecord(opener).destination);
    return `${who} 이동 요청${to ? ` · ${to}` : ''}`;
  }
  // A group that is only contact attempts is the scheduled check-in itself; the
  // follow-up lives in its own group and is named for what it is. World-stream
  // types are ignored in that test - `world.reachability_resolved` rides along
  // in the check-in group and would otherwise disqualify it.
  const meaningful = [...types].filter((type) => !type.startsWith('world.'));
  const onlyContact =
    meaningful.length > 0 && meaningful.every((type) => type.startsWith('contact.'));
  if (onlyContact) {
    return types.has('contact.no_response')
      ? `${who} 정기 안부 연락 · 응답 없음`
      : `${who} 정기 안부 연락`;
  }
  if (types.has('handoff.requested') || types.has('handoff.accepted')) {
    return `${who} 확인 요청 · 기관 인계`;
  }
  if (types.has('request.raised') || types.has('request.offered')) return `${who} 확인 요청`;
  return `${who} 요청`;
}

/**
 * One sentence for what MEDial is doing about this request right now.
 * Every branch is decided by an event that actually exists in the log; there is
 * no "처리 중" fallback that would keep the sentence looking alive when nothing
 * has happened.
 */
export function currentSentence(flow: RequestFlow): string {
  const last = flow.events[flow.events.length - 1];
  if (!last) return '이 요청에 대해 아직 기록된 사건이 없습니다.';
  const p = asRecord(last);
  const to = p.toActorId ? personName(str(p.toActorId)) : null;
  const who = flow.subjectId ? personName(flow.subjectId) : '요청자';
  const replier = last.actorId === 'MEDial' ? (to ?? '상대') : personName(last.actorId);

  switch (last.type) {
    case 'need.resolved':
      return `${who}의 요청이 끝났습니다 (${pathWord(str(p.resolutionPath))}).`;
    case 'need.unresolved':
      return `${who}의 요청이 해결되지 않은 채 끝났습니다 (${reasonText(p.reason)}).`;
    case 'request.offered':
      return `${to ?? '상대'}의 응답을 기다리고 있습니다.`;
    // The person who answered is the *actor* of these events - the one who
    // accepted or refused. `toActorId` is who the offer was addressed to, and
    // the reply events do not carry it, so reading it here named "상대".
    case 'request.declined':
      return `${withParticle(replier, 'subject')} 거절했습니다 (${reasonText(p.reason)}). 다음 후보를 찾는 중입니다.`;
    case 'request.accepted':
      return `${withParticle(replier, 'subject')} 수락했습니다.`;
    case 'request.deferred':
      return `${withParticle(replier, 'subject')} 나중으로 미뤘습니다${
        str(p.reason) ? ` (${reasonText(p.reason)})` : ''
      }.`;
    case 'request.relayed':
      return `${withParticle(replier, 'subject')} ${to ?? '이웃'}에게 넘겼습니다. MEDial의 장부에는 ${replier}의 수락으로 남아 있습니다.`;
    case 'contact.attempted':
      return `${to ?? who}에게 연락을 걸어 두었습니다.`;
    case 'contact.no_response':
      return `${to ?? who}에게서 응답이 없습니다.`;
    case 'contact.answered':
      return `${withParticle(to ?? who, 'subject')} 응답했습니다.`;
    case 'medial.waiting':
      return str(p.untilMs)
        ? '재연락 시각까지 기다리는 중입니다.'
        : `대기 중입니다 (${reasonText(p.reason)}).`;
    case 'medial.decided':
      return `누구에게 부탁할지 정했습니다: ${p.chosen ? personName(str(p.chosen)) : '고를 사람 없음'}.`;
    case 'medial.classified':
      return `${who}의 상황을 분류했습니다.`;
    case 'medial.observed':
      return p.observationKind === 'no_local_knowledge'
        ? `${who}가 어디 있을지 물었지만 짐작 가는 곳이 없다는 답을 들었습니다.`
        : `${who}의 위치에 대한 이장의 추정을 전달받았습니다.`;
    case 'transport.need_raised':
      return `${who}의 이동 요청이 접수되었습니다.`;
    case 'transport.reservation_made':
      return `${p.driverId ? personName(str(p.driverId)) : '운전자'}의 차에 좌석을 예약했습니다.`;
    case 'transport.reservation_cancelled':
      return '예약이 취소되어 좌석이 반환되었습니다.';
    case 'transport.conflict_detected':
      return `예약이 겹칩니다 (${reasonText(p.reason)}).`;
    case 'transport.pickup':
      return `${withParticle(p.riderId ? personName(str(p.riderId)) : who, 'subject')} 차에 탔습니다.`;
    case 'transport.dropoff':
      return `${withParticle(p.riderId ? personName(str(p.riderId)) : who, 'subject')} 내렸습니다.`;
    case 'task.travel_started':
      return `${withParticle(personName(last.actorId), 'subject')} ${p.to ? placeWord(str(p.to)) : '목적지'}(으)로 출발했습니다.`;
    case 'task.travel_arrived':
      return `${withParticle(personName(last.actorId), 'subject')} ${p.place ? placeWord(str(p.place)) : '목적지'}에 도착했습니다.`;
    case 'task.check_performed':
      return str(p.outcome) === 'subject_found_well'
        ? `${withParticle(who, 'object')} 직접 확인했습니다.`
        : `${p.place ? placeWord(str(p.place)) : '그 장소'}에 ${withParticle(who, 'subject')} 없었습니다.`;
    case 'handoff.requested':
      return `${to ?? '기관'}에 인계를 요청했습니다.`;
    case 'handoff.accepted':
      return `${withParticle(to ?? '기관', 'subject')} 인계를 접수했습니다.`;
    case 'institution.queued':
      return `기관 대기열에 있습니다 (앞선 ${String(p.queueDepth ?? '?')}건).`;
    case 'institution.review_started':
      return '기관이 검토를 시작했습니다.';
    case 'institution.review_completed':
      return `기관 검토가 끝났습니다 (${str(p.outcome) ?? '결과 미기록'}).`;
    case 'plan.modified':
      return `${personName(str(p.actorId) ?? last.actorId)}의 일과가 바뀌었습니다.`;
    default:
      // Reached only if the engine adds an event type this selector does not
      // know yet. Say so rather than printing an internal name as a status.
      return '이 요청의 마지막 사건을 아직 문장으로 표시하지 못합니다 (아래 원 사건 목록 참고).';
  }
}

/** The one line of reasoning behind the most recent judgement, and the facts it
 *  rested on.
 *
 *  The rationale is on the ``medial.decided`` event; the facts MEDial actually
 *  held are on the matching DecisionRecord, which is where the engine stores
 *  ``knownFacts`` and the candidates it excluded. Reading the facts off the
 *  event yielded an empty list every time and made the panel claim MEDial knew
 *  nothing, so the two records are joined here by ``decisionId``. */
export function latestReasoning(
  flow: RequestFlow,
  decisions: DecisionRecord[],
): {
  question: string;
  chosen: string;
  rationale: string;
  knownFacts: string[];
  excluded: { actorId: string; reason: string }[];
} | null {
  const decided = [...flow.events].reverse().find((event) => event.type === 'medial.decided');
  if (!decided) return null;
  const p = asRecord(decided);
  const record = decisions.find((row) => row.id === str(p.decisionId));
  const excluded = Array.isArray(p.excluded)
    ? (p.excluded as { actorId: string; reason: string }[])
    : (record?.candidates.filter((c) => !c.included) ?? []);
  return {
    question: str(p.question) ?? record?.question ?? '',
    chosen: str(p.chosen) ?? record?.chosen ?? '없음',
    rationale: str(p.rationale) ?? record?.rationale ?? '',
    knownFacts: record?.knownFacts ?? [],
    excluded,
  };
}

/** Every judgement on this request, oldest first, each with its own reason.
 *  The panel showed only the latest, so a relation-first run displayed "keep
 *  looking at the field" and hid why the head was asked in the first place. */
export function reasonsInOrder(
  flow: RequestFlow,
): { seq: number; atMs: number; question: string; chosen: string | null; rationale: string }[] {
  return flow.events
    .filter((event) => event.type === 'medial.decided')
    .map((event) => {
      const p = asRecord(event);
      return {
        seq: event.seq,
        atMs: event.simTimeMs,
        question: str(p.question) ?? '',
        chosen: str(p.chosen),
        rationale: str(p.rationale) ?? '',
      };
    });
}

export interface AskedRow {
  actorId: string;
  /** MEDial, or the neighbour who handed it on. */
  askedBy: string;
  /** `told`: asked where the subject would be, and answered (with a place or
   *  with "no idea"). Not an acceptance - nobody agreed to go anywhere. */
  answer: 'accepted' | 'declined' | 'deferred' | 'relayed' | 'told' | 'pending';
  /** The sentence the person gave, already in Korean; null when they said
   *  nothing or have not answered yet. */
  reason: string | null;
  /** Machine key of the decline-table line, for the technical disclosure. */
  rule: string | null;
  /** For a model resident: what the source-backed table would have answered,
   *  when that differs from what they did. Null when they agree or no table
   *  verdict was recorded. */
  tableSaid: string | null;
  /** Who they handed it to, when the answer is `relayed`. */
  passedTo: string | null;
  /** False for anything MEDial was not addressed on: a hand-off, or a refusal
   *  further down one. The researcher sees the row with that mark. */
  seenByMedial: boolean;
  seq: number;
}

/**
 * Everyone who was asked to do something for this request, in the order they
 * were asked, with what they answered.
 *
 * One row per ask, not per person: under `neighbour_first` MEDial asks three
 * people in turn and the reader has to see each answer, not the last one. A
 * person who was handed the request by a neighbour gets a row whose `askedBy`
 * is that neighbour, and MEDial never sees that row - which is the point.
 */
export function askedPeople(flow: RequestFlow): AskedRow[] {
  const rows: AskedRow[] = [];
  const open = (actorId: string) =>
    [...rows].reverse().find((row) => row.actorId === actorId && row.answer === 'pending');

  for (const event of flow.events) {
    const p = asRecord(event);
    const seen = event.visibility.includes('MEDial');
    switch (event.type) {
      case 'request.offered':
        rows.push({
          actorId: str(p.toActorId) ?? '',
          askedBy: 'MEDial',
          answer: 'pending',
          reason: null,
          rule: null,
          tableSaid: null,
          passedTo: null,
          seenByMedial: seen,
          seq: event.seq,
        });
        break;
      case 'request.relayed': {
        // The engine writes the acceptance MEDial hears *before* the hand-off
        // the researcher sees, so the row is already "accepted" here. In the
        // researcher's view it becomes the hand-off it really was; in MEDial's
        // view this event never arrives and the acceptance stands.
        const from = [...rows].reverse().find((row) => row.actorId === event.actorId);
        if (from) {
          from.answer = 'relayed';
          from.passedTo = str(p.toActorId);
        }
        rows.push({
          actorId: str(p.toActorId) ?? '',
          askedBy: event.actorId,
          answer: 'pending',
          reason: null,
          rule: null,
          tableSaid: null,
          passedTo: null,
          seenByMedial: seen,
          seq: event.seq,
        });
        break;
      }
      case 'request.accepted':
      case 'request.declined':
      case 'request.deferred': {
        const row = open(event.actorId);
        if (!row) break;
        row.answer =
          event.type === 'request.accepted'
            ? 'accepted'
            : event.type === 'request.declined'
              ? 'declined'
              : 'deferred';
        row.reason = str(p.reason) ? reasonText(p.reason) : null;
        row.rule = str(p.rule);
        const table = p.ruleTableSaid as { action?: string } | undefined;
        row.tableSaid =
          p.agreesWithRuleTable === false && table?.action ? String(table.action) : null;
        row.seenByMedial = row.seenByMedial && seen;
        break;
      }
      case 'medial.observed': {
        const row = open(event.actorId);
        if (!row) break;
        row.answer = 'told';
        row.reason =
          p.observationKind === 'no_local_knowledge'
            ? '짐작 가는 곳이 없다'
            : (str(p.utterance) ?? `${placeWord(str(p.suggestedPlace))}에 있을 것`);
        row.seenByMedial = row.seenByMedial && seen;
        break;
      }
      default:
        break;
    }
  }
  return rows;
}

/** Whether the health centre or 119 are actually in this request's log. Nothing
 *  is drawn for a dispatch the engine never produced. */
export function institutionsInvolved(flow: RequestFlow): string[] {
  return [
    ...new Set(
      flow.events
        .filter((event) => event.type.startsWith('handoff.') || event.type.startsWith('institution.'))
        .map((event) => str(asRecord(event).toActorId) ?? event.actorId)
        .filter((x): x is string => Boolean(x) && x !== 'MEDial'),
    ),
  ];
}
