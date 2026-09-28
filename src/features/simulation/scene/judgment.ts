import type { DecisionRecord, DomainEvent, RuleTraceRecord } from '../api/types';
import { pathWord, personName, placeWord, questionWords, reasonText } from '../selectors/story';
import { MEDIAL } from './beats';

// MEDial's side of a request, as its four steps:
//
//   지금 아는 것            the facts its latest decision rested on
//   걸린 규칙               the rules this request actually went through
//   후보 판정               who it asked and what it heard, and who it ruled out
//   그래서 이렇게 말한다     what it told the people it asked, and why
//
// Only what MEDial held at the cursor: the facts are the DecisionRecord's
// `knownFacts`, the answers are events addressed to it, and a hand-off it was
// never told about does not appear. Nothing about the world goes in here - the
// scene beside it shows the world.

export type Verdict = 'accepted' | 'declined' | 'deferred' | 'told' | 'no_answer' | 'answered' | 'asking';

export interface Judgment {
  question: string | null;
  knows: string[];
  rules: { label: string; sentence: string }[];
  asked: { actorId: string; verdict: Verdict; heard: string | null }[];
  ruledOut: { actorId: string; reason: string }[];
  told: string[] | null;
  rationale: string | null;
  result: string | null;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

export function judgmentOf(
  requestId: string,
  cursorSeq: number,
  events: DomainEvent[],
  decisions: DecisionRecord[],
  rules: RuleTraceRecord[],
): Judgment {
  const mine = events.filter(
    (e) => e.correlationId === requestId && e.seq <= cursorSeq && e.visibility.includes(MEDIAL),
  );
  const ids = new Set(mine.map((e) => e.id));

  const decided = [...mine].reverse().find((e) => e.type === 'medial.decided');
  const record = decided ? decisions.find((d) => d.id === str(decided.payload.decisionId)) : undefined;
  const excluded = Array.isArray(decided?.payload.excluded)
    ? (decided!.payload.excluded as { actorId: string; reason: string }[])
    : (record?.candidates.filter((c) => !c.included) ?? []);

  const asked: Judgment['asked'] = [];
  const open = (id: string) => [...asked].reverse().find((row) => row.actorId === id && row.verdict === 'asking');
  for (const e of mine) {
    const p = e.payload;
    switch (e.type) {
      case 'contact.attempted':
      case 'request.offered':
        if (str(p.toActorId)) asked.push({ actorId: str(p.toActorId)!, verdict: 'asking', heard: null });
        break;
      case 'contact.no_response': {
        const row = open(str(p.toActorId) ?? '');
        if (row) row.verdict = 'no_answer';
        break;
      }
      case 'contact.answered': {
        const row = open(str(p.toActorId) ?? '');
        if (row) { row.verdict = 'answered'; row.heard = str(p.utterance); }
        break;
      }
      case 'request.accepted':
      case 'request.declined':
      case 'request.deferred': {
        const row = open(e.actorId);
        if (!row) break;
        row.verdict = e.type === 'request.accepted' ? 'accepted' : e.type === 'request.declined' ? 'declined' : 'deferred';
        row.heard = str(p.reason) ? reasonText(p.reason) : str(p.utterance);
        break;
      }
      case 'medial.observed': {
        const row = open(e.actorId);
        if (!row) break;
        row.verdict = 'told';
        row.heard = p.observationKind === 'no_local_knowledge'
          ? '짐작 가는 곳이 없다고 했다'
          : `${placeWord(str(p.suggestedPlace))}에 있을 거라고 했다`;
        break;
      }
      default:
        break;
    }
  }

  const disclosed = [...mine].reverse().find(
    (e) => ['request.offered', 'handoff.requested'].includes(e.type) && typeof e.payload.disclosure === 'object',
  );
  const told = disclosed
    ? (((disclosed.payload.disclosure as { fields?: string[] }).fields) ?? [])
    : null;

  const closed = mine.find((e) => e.type === 'need.resolved' || e.type === 'need.unresolved');
  const result = !closed ? null
    : closed.type === 'need.resolved'
      ? `요청이 끝났다 — ${pathWord(str(closed.payload.resolutionPath))}`
      : `해결되지 않은 채 끝났다 — ${reasonText(closed.payload.reason)}`;

  return {
    question: decided ? questionWords(str(decided.payload.question) ?? record?.question ?? '') || null : null,
    knows: record?.knownFacts ?? [],
    rules: rules
      .filter((r) => r.executionStatus === 'applied' && r.eventRefs.some((id) => ids.has(id)))
      .map((r) => ({ label: r.label, sentence: r.sentence })),
    asked,
    ruledOut: excluded.map((c) => ({ actorId: c.actorId, reason: c.reason })),
    told,
    rationale: str(decided?.payload.rationale) ?? record?.rationale ?? null,
    result,
  };
}

export const VERDICT_WORD: Record<Verdict, string> = {
  accepted: '수락', declined: '거절', deferred: '미룸', told: '알려 줌', no_answer: '응답 없음',
  answered: '응답함', asking: '묻는 중',
};

export const nameOf = (id: string) => (id === MEDIAL ? 'MEDial' : personName(id));
