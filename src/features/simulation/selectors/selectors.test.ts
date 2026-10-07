import { describe, expect, it } from 'vitest';
import type { AgentReview, GenerationDetail, SessionDetail } from '../api/iteration';
import type { DayRealization, DomainEvent } from '../api/types';
import { personName, sentenceFor, withParticle } from './story';
import { childFor, farthestPath, isTree, pathTo, rootsOf, ruleShifts } from './tree';
import { reviewChanges } from './versionFacts';
import { versionName } from '../ui/primitives';
import {
  dayChangeLines,
  dayLabel,
  inputName,
  paramName,
  refusalReason,
  ruleName,
  strategyName,
} from './words';

// The sentences and names every screen shares. How the observe screen cuts
// the log into scenes and what MEDial's panel says are in scene/scene.test.ts.
//
// These test what a screen *claims*, not how it looks: every case is one where
// a reader would otherwise be told something untrue - a world-only fact as
// MEDial's knowledge, an internal key in prose, a sentence with the wrong particle.

let seq = 0;

function event(partial: Partial<DomainEvent> & { type: string }): DomainEvent {
  seq += 1;
  return {
    id: `ev-${seq}`,
    attemptId: 'att-test',
    seq,
    simTimeMs: 9 * 60 * 60 * 1000 + seq * 60_000,
    actorId: 'MEDial',
    causationId: null,
    correlationId: 'req-P1-1',
    visibility: ['MEDial'],
    committed: true,
    payload: {},
    ...partial,
  };
}

describe('sentenceFor', () => {
  it('says only that there was no answer, and that the reason is unknowable', () => {
    const sentence = sentenceFor(event({ type: 'contact.no_response', payload: { toActorId: 'P1' } }))!;
    expect(sentence.text).toContain('응답이 없었습니다');
    expect(sentence.text).toContain('이유를 알 수 없습니다');
  });

  it('is neutral about what a chosen person was asked to do', () => {
    // The same decision covers re-contacting the person themselves and asking a
    // neighbour, so "부탁하기로" was wrong for the first.
    const sentence = sentenceFor(event({ type: 'medial.decided', payload: { chosen: 'P1' } }))!;
    expect(sentence.text).not.toContain('부탁');
    expect(sentence.text).toContain('P1');
  });

  it('says a field is missing rather than printing undefined', () => {
    // Runs recorded by an older engine have no location/clinical fields, and
    // their stored payload is history that is not rewritten.
    const sentence = sentenceFor(event({ type: 'medial.classified', payload: {} }))!;
    expect(sentence.text).not.toContain('undefined');
    expect(sentence.text).toContain('없습니다');
  });

  it('prints the refusal sentence, not the rule key', () => {
    const sentence = sentenceFor(event({ type: 'request.declined', actorId: 'P10',
      payload: { rule: 'persona_condition', reason: '영업 중 가게를 비울 수 없다' } }))!;
    expect(sentence.text).toContain('영업 중 가게를 비울 수 없다');
    expect(sentence.text).not.toContain('persona_condition');
  });

  it('says of a hand-off who really went, and that MEDial does not know', () => {
    const relayed = sentenceFor(event({ type: 'request.relayed', actorId: 'P12',
      payload: { toActorId: 'P6', subjectId: 'P9' } }))!;
    expect(relayed.text).toContain('이장에게 P9 확인을 넘겼습니다');
    expect(relayed.text).toContain('MEDial은 이것을 모릅니다');
  });
});

describe('withParticle', () => {
  it('picks the particle from the final consonant', () => {
    // 이장 ends in ㅇ, so 이/을; 보건소 ends in a vowel, so 가/를.
    expect(withParticle('이장', 'subject')).toBe('이장이');
    expect(withParticle('이장', 'object')).toBe('이장을');
    expect(withParticle('보건소', 'subject')).toBe('보건소가');
    expect(withParticle('보건소', 'object')).toBe('보건소를');
  });

  it('reads a trailing digit as the numeral it is spoken as', () => {
    // P1 is read 피원 - 일 ends in ㄹ - so 이. P2 is 이, a vowel, so 가.
    expect(withParticle('P1', 'subject')).toBe('P1이');
    expect(withParticle('P2', 'subject')).toBe('P2가');
    expect(withParticle('P6', 'subject')).toBe('P6이');
    expect(withParticle('P9', 'subject')).toBe('P9가');
  });
});

describe('personName', () => {
  it('names the village head by role and everyone else by number', () => {
    expect(personName('P6')).toBe('이장');
    expect(personName('P1')).toBe('P1');
    expect(personName('HC_NURSE')).toBe('보건소 담당자');
  });

  it('writes a grammatical sentence for the head', () => {
    const sentence = sentenceFor(event({ type: 'request.accepted', actorId: 'P6', payload: {} }))!;
    expect(sentence.text).toBe('이장이 하겠다고 했습니다.');
    expect(sentence.text).not.toContain('이장가');
  });
});

describe('words', () => {
  it('names every strategy and rule the engine can emit', () => {
    expect(strategyName('neighbour_first')).toBe('가까운 이웃에게 먼저');
    expect(paramName('neighbourAskLimit')).not.toBe('neighbourAskLimit');
    expect(ruleName('too_far')).toBe('너무 멀어서');
    // The ride path stores its code in `reason` as well as `rule`, so a screen
    // that trusted `reason` printed driving_status_unknown at the reader.
    expect(refusalReason('driving_status_unknown', 'driving_status_unknown')).toBe(
      '운전 여부가 기록에 없음',
    );
    expect(refusalReason('asked_too_often', '오늘은 가게를 비울 수 없다')).toBe(
      '오늘은 가게를 비울 수 없다',
    );
    expect(refusalReason('brand_new_code', 'brand_new_code')).toContain('사유가 기록되지 않음');
    expect(refusalReason(null, null)).toBe('사유가 기록되지 않음');
    expect(inputName('day')).toBe('뽑힌 하루');
  });

  it('describes the day in one line and its edits per person', () => {
    const day: DayRealization = {
      id: 'day-1', seed: 7, villageContentHash: 'h', environmentRevisionId: 'env-v2',
      classification: 'source_jittered',
      residents: [{ actorId: 'P1', steps: [], excludedReason: null, changes: [
        { index: 0, kind: 'jitter', target: 'FARM', beforeMs: 9 * 3_600_000,
          afterMs: 9 * 3_600_000 + 12 * 60_000, note: '' }] }],
      assumptions: [],
    };
    expect(dayLabel(day)).toBe('기록된 시각이 조금 다른 하루');
    expect(dayChangeLines(day)).toEqual(['P1 · FARM 09:00 → 09:12 (12분 늦게)']);
    expect(dayLabel(undefined)).toBe('하루 기록 없음');
  });
});

describe('reviewChanges', () => {
  const review = (actorId: string, attemptId: string,
                  items: [AgentReview['items'][number]['dimension'], AgentReview['items'][number]['assessment'], string[]][]) =>
    ({
      actorId,
      attemptId,
      items: items.map(([dimension, assessment, eventRefs]) => ({
        dimension, assessment, reason: `${actorId} ${dimension} ${assessment}`, eventRefs,
        evidenceRefs: [], requestedChange: null,
      })),
    }) as unknown as AgentReview;
  const version = (reviews: AgentReview[]) => ({ reviews }) as unknown as GenerationDetail;

  it('names each resident dimension that moved, with the later reason and event', () => {
    const moved = reviewChanges(
      version([review('P4', 'a0', [['time_labour', 'mixed', ['ev-1']], ['help_resolution', 'positive', []]])]),
      version([review('P4', 'a1', [['time_labour', 'negative', ['ev-9']], ['help_resolution', 'positive', []]])]),
    );
    expect(moved).toEqual([{
      actorId: 'P4', dimension: 'time_labour', before: 'mixed', after: 'negative',
      reason: 'P4 time_labour negative', attemptId: 'a1', eventId: 'ev-9',
    }]);
  });

  it('does not pair a resident who has no single review on each side', () => {
    // Two scenarios, two reviews: there is no one pair to compare, and
    // choosing one would invent a change.
    const left = version([review('P2', 'a0', [['choice_refusal', 'positive', []]]),
                          review('P2', 'b0', [['choice_refusal', 'negative', []]])]);
    const right = version([review('P2', 'a1', [['choice_refusal', 'mixed', []]]),
                           review('P9', 'a1', [['choice_refusal', 'mixed', []]])]);
    expect(reviewChanges(left, right)).toEqual([]);
  });
});

describe('versionName', () => {
  it('says the version prefix once, even on a stored label that has it twice', () => {
    expect(versionName(0, 'v0 · v0 · 초기 운영안')).toBe('v0 · 초기 운영안');
    expect(versionName(0, 'v0 · 초기 운영안')).toBe('v0 · 초기 운영안');
    expect(versionName(1, '동선 기준으로 시험')).toBe('v1 · 동선 기준으로 시험');
  });
});

describe('a session whose versions branch', () => {
  const g = (id: string, parent: string | null, applied: string | null = null) =>
    ({ id, parentGenerationId: parent, appliedChangeSetId: applied, index: parent ? 1 : 0 }) as GenerationDetail;
  const line = { generations: [g('v0', null), g('v1', 'v0', 'c')] } as unknown as SessionDetail;
  const tree = { generations: [g('a', null), g('b', null), g('a-0', 'a', 'x'), g('a-1', 'a', 'y')] } as unknown as SessionDetail;

  it('is a tree only when a version has a sibling', () => {
    expect(isTree(line)).toBe(false);
    expect(isTree(tree)).toBe(true);
  });

  it('walks from a first setting down, and finds the day a revision led to', () => {
    expect(rootsOf(tree).map((r) => r.id)).toEqual(['a', 'b']);
    expect(pathTo(tree, 'a-1').map((r) => r.id)).toEqual(['a', 'a-1']);
    expect(childFor(tree, 'y')?.id).toBe('a-1');
    expect(childFor(tree, 'z')).toBeNull();
  });

  it('shows, as three days later, the walk whose last day ended most differently', () => {
    const day = (id: string, parent: string | null, refusals: number, rule: string, label = id) => ({
      id, parentGenerationId: parent, index: id.split('-').length - 1, label,
      metrics: { exhibition: { quests: 1, refusals, headAsks: 1, resolveMinutes: 30 } },
      ruleCatalog: [{ ruleType: 'contact_order', label: '누구에게 먼저', currentRule: rule },
                    { ruleType: 'quiet_period', label: '간격', currentRule: '없다' }],
    }) as unknown as GenerationDetail;
    const walks = { generations: [
      day('a', null, 0, '이장'), day('a-0', 'a', 0, '이장'), day('a-1', 'a', 0, '이웃', '이웃 먼저'),
      day('a-0-0', 'a-0', 0, '이장'), day('a-1-0', 'a-1', 6, '이웃'), day('a-1-1', 'a-1', 6, '이웃'),
    ] } as unknown as SessionDetail;
    const walk = farthestPath(walks, 'a');
    expect(walk.map((x) => x.id)).toEqual(['a', 'a-1', 'a-1-0']);
    expect(ruleShifts(walk)).toEqual([{ ruleType: 'contact_order', label: '누구에게 먼저', before: '이장',
      after: '이웃', request: '이웃 먼저', day: '1일차' }]);
  });
});
