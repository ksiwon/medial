import { describe, expect, it } from 'vitest';
import type { DayRealization, DecisionRecord, DomainEvent } from '../api/types';
import { askedPeople, currentSentence, latestReasoning, requestFlows } from './requests';
import { hiddenRows, personName, sentenceFor, storyRows, withParticle } from './story';
import {
  dayChangeLines,
  dayLabel,
  inputName,
  paramName,
  refusalReason,
  ruleName,
  strategyName,
} from './words';

// Behaviour of the two selectors the observe screen is built on.
//
// These test what the screen *claims*, not how it looks. Doc 15 section 9 asks
// for no tests that restate a static CSS value, so there are none here: every
// case below is one where the screen would otherwise say something untrue -
// mixing two requests together, printing a world-only fact as MEDial's status,
// showing an internal type name to a reader, or fabricating a summary that
// cannot be traced back to its event.

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

describe('requestFlows', () => {
  it('keeps two requests of the same day apart', () => {
    const flows = requestFlows([
      event({ type: 'transport.need_raised', correlationId: 'req-P9', payload: { subjectId: 'P9' } }),
      event({ type: 'request.offered', correlationId: 'req-P9', payload: { toActorId: 'P2' } }),
      event({ type: 'need.resolved', correlationId: 'req-P9', payload: { resolutionPath: 'ride' } }),
      event({ type: 'transport.need_raised', correlationId: 'req-P11', payload: { subjectId: 'P11' } }),
      event({ type: 'request.offered', correlationId: 'req-P11', payload: { toActorId: 'P3' } }),
    ]);

    expect(flows.map((f) => f.id)).toEqual(['req-P9', 'req-P11']);

    // The second request must not be painted complete because the first closed.
    const p9 = flows.find((f) => f.id === 'req-P9')!;
    const p11 = flows.find((f) => f.id === 'req-P11')!;
    expect(p9.closed).toBe('resolved');
    expect(p11.closed).toBeNull();
    expect(p11.events.some((e) => e.type === 'need.resolved')).toBe(false);
  });

  it('excludes the engine world stream from every request', () => {
    const flows = requestFlows([
      event({ type: 'world.day_started', correlationId: 'world', actorId: 'ENGINE' }),
      event({ type: 'contact.attempted', payload: { toActorId: 'P1' } }),
    ]);
    expect(flows).toHaveLength(1);
    expect(flows[0].id).toBe('req-P1-1');
  });

  it('drops world facts that ride along on a request id', () => {
    // world.reachability_resolved carries the request's correlation id but says
    // *why* the phone went unanswered, which the caller cannot know. Letting it
    // into the flow put it in MEDial's own status line.
    const flows = requestFlows([
      event({ type: 'contact.attempted', payload: { toActorId: 'P1' } }),
      event({
        type: 'world.reachability_resolved',
        visibility: ['RESEARCHER'],
        payload: { toActorId: 'P1', answered: false, worldReason: '밭에 있었다' },
      }),
    ]);

    expect(flows[0].events.map((e) => e.type)).toEqual(['contact.attempted']);
    expect(currentSentence(flows[0])).not.toContain('world');
    expect(currentSentence(flows[0])).not.toContain('밭에');
  });

  it('names the routine check-in apart from the request it raised', () => {
    // Both groups are about P1. Naming both after the person put two identical
    // options in the picker.
    const flows = requestFlows([
      event({ type: 'contact.attempted', correlationId: 'checkin-P1', payload: { toActorId: 'P1' } }),
      event({ type: 'contact.no_response', correlationId: 'checkin-P1', payload: { toActorId: 'P1' } }),
      event({ type: 'request.raised', correlationId: 'req-P1-1', payload: { subjectId: 'P1' } }),
      event({ type: 'handoff.requested', correlationId: 'req-P1-1', payload: { toActorId: 'HC_NURSE' } }),
    ]);

    const titles = flows.map((f) => f.title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles).toContain('P1 정기 안부 연락 · 응답 없음');
    expect(titles).toContain('P1 확인 요청 · 기관 인계');
  });

  it('reads the subject out of an id shaped like checkin-P1', () => {
    // The old code split on "-" and took the first token, so the screen showed
    // a request belonging to somebody called "checkin".
    const [flow] = requestFlows([
      event({ type: 'contact.attempted', correlationId: 'checkin-P1', payload: {} }),
    ]);
    expect(flow.subjectId).toBe('P1');
    expect(flow.title).not.toContain('checkin');
  });

  it('leaves a stage that never fired as future rather than done', () => {
    const [flow] = requestFlows([
      event({ type: 'request.raised', payload: { subjectId: 'P1' } }),
      event({ type: 'task.check_performed', payload: { outcome: 'subject_found_well' } }),
    ]);
    const byKey = Object.fromEntries(flow.stages.map((s) => [s.key, s.state]));
    expect(byKey.observe).toBe('done');
    // Nothing was judged or coordinated; those must not be filled in because a
    // later stage has content.
    expect(byKey.judge).toBe('future');
    expect(byKey.coordinate).toBe('future');
    expect(byKey.result).toBe('current');
  });

  it('lists only people the request actually involved', () => {
    const [flow] = requestFlows([
      event({ type: 'request.offered', payload: { toActorId: 'P6', subjectId: 'P1' } }),
      event({ type: 'request.accepted', actorId: 'P6', payload: {} }),
    ]);
    expect(new Set(flow.participants)).toEqual(new Set(['P6', 'P1']));
    // The orchestrator itself and the engine are not villagers.
    expect(flow.participants).not.toContain('MEDial');
    expect(flow.participants).not.toContain('ENGINE');
  });
});

describe('currentSentence', () => {
  it('describes the request from its own last event', () => {
    const [flow] = requestFlows([
      event({ type: 'request.offered', payload: { toActorId: 'P6', subjectId: 'P1' } }),
    ]);
    expect(currentSentence(flow)).toBe('이장의 응답을 기다리고 있습니다.');
  });

  it('never prints an internal type name as a status', () => {
    const [flow] = requestFlows([event({ type: 'some.future.event.type', payload: {} })]);
    const sentence = currentSentence(flow);
    expect(sentence).not.toContain('some.future.event.type');
    expect(sentence).toContain('아직');
  });
});

describe('latestReasoning', () => {
  const decisions: DecisionRecord[] = [
    {
      id: 'dec-1',
      attemptId: 'att-test',
      simTimeMs: 0,
      policyId: 'policy-IT-v0',
      question: '누가 확인할 것인가',
      candidates: [
        { actorId: 'P1', included: false, reason: '확인 대상 본인' },
        { actorId: 'P6', included: true, reason: '' },
      ],
      chosen: 'P6',
      rationale: '이장은 안부 확인을 해 온 사람이다',
      knownFacts: ['P1이 응답하지 않았다', '이장은 집에 있다고 보고했다'],
      observationIds: [],
      excludedByPermission: [],
    },
  ];

  it('joins the facts MEDial held from the decision record, not the event', () => {
    // knownFacts is not on the medial.decided payload. Reading it there gave an
    // empty list every time, so the panel claimed MEDial knew nothing.
    const [flow] = requestFlows([
      event({ type: 'medial.decided', payload: { decisionId: 'dec-1', chosen: 'P6' } }),
    ]);
    const reasoning = latestReasoning(flow, decisions)!;
    expect(reasoning.knownFacts).toHaveLength(2);
    expect(reasoning.chosen).toBe('P6');
    expect(reasoning.excluded.map((e) => e.actorId)).toEqual(['P1']);
  });

  it('returns null when the request has no judgement yet', () => {
    const [flow] = requestFlows([event({ type: 'contact.attempted', payload: {} })]);
    expect(latestReasoning(flow, decisions)).toBeNull();
  });
});

describe('storyRows', () => {
  it('keeps every row traceable to its own event', () => {
    const events = [
      event({ type: 'contact.attempted', payload: { toActorId: 'P1', channel: 'phone', attemptNumber: 1 } }),
      event({ type: 'contact.no_response', payload: { toActorId: 'P1' } }),
    ];
    const rows = storyRows(events);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.event.seq)).toEqual(events.map((e) => e.seq));
  });

  it('does not narrate why a call went unanswered', () => {
    const rows = storyRows([
      event({
        type: 'world.reachability_resolved',
        payload: { toActorId: 'P1', answered: false, worldReason: '밭에 있었다' },
      }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it('says only that there was no answer, and that the reason is unknowable', () => {
    const [row] = storyRows([event({ type: 'contact.no_response', payload: { toActorId: 'P1' } })]);
    expect(row.text).toContain('응답이 없었습니다');
    expect(row.text).toContain('이유를 알 수 없습니다');
  });

  it('is neutral about what a chosen person was asked to do', () => {
    // The same decision covers re-contacting the person themselves and asking a
    // neighbour, so "부탁하기로" was wrong for the first.
    const [row] = storyRows([event({ type: 'medial.decided', payload: { chosen: 'P1' } })]);
    expect(row.text).not.toContain('부탁');
    expect(row.text).toContain('P1');
  });

  it('prints an utterance only when the payload carries one', () => {
    const rows = storyRows([
      event({ type: 'request.accepted', actorId: 'P6', payload: { utterance: '지금 가 볼게요' } }),
      event({ type: 'request.accepted', actorId: 'P2', payload: {} }),
    ]);
    expect(rows[0].utterance).toBe('지금 가 볼게요');
    expect(rows[1].utterance).toBeNull();
  });

  it('moves what it hides into a list that can be reopened', () => {
    const events = [
      event({ type: 'world.actor_moved', payload: {} }),
      event({ type: 'contact.attempted', payload: { toActorId: 'P1' } }),
    ];
    expect(storyRows(events)).toHaveLength(1);
    // Nothing is dropped on the floor: every event is in one list or the other.
    expect(hiddenRows(events).map((e) => e.type)).toEqual(['world.actor_moved']);
    expect(storyRows(events).length + hiddenRows(events).length).toBe(events.length);
  });

  it('says a field is missing rather than printing undefined', () => {
    // Runs recorded by an older engine have no location/clinical fields, and
    // their stored payload is history that is not rewritten.
    const sentence = sentenceFor(event({ type: 'medial.classified', payload: {} }))!;
    expect(sentence.text).not.toContain('undefined');
    expect(sentence.text).toContain('없습니다');
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

  it('is the same mapping the request sentences use', () => {
    // The head appearing as 이장 in one panel and P6 in the next was a real bug.
    const [flow] = requestFlows([
      event({ type: 'request.accepted', actorId: 'P6', payload: {} }),
    ]);
    expect(currentSentence(flow)).toContain('이장');
    expect(currentSentence(flow)).not.toContain('P6');
  });

  it('writes a grammatical sentence for the head', () => {
    const [row] = storyRows([event({ type: 'request.accepted', actorId: 'P6', payload: {} })]);
    expect(row.text).toBe('이장이 하겠다고 했습니다.');
    expect(row.text).not.toContain('이장가');
  });
});

// A hand-off as the engine records it: MEDial hears an acceptance from the
// person it asked; the researcher also sees the request move on and who went.
function handoffLog(): DomainEvent[] {
  const both = ['MEDial', 'P12'];
  const theirs = ['P12', 'P6', 'RESEARCHER'];
  return [
    event({ type: 'request.raised', payload: { subjectId: 'P9' } }),
    event({ type: 'request.offered', payload: { toActorId: 'P12', subjectId: 'P9' }, visibility: both }),
    event({ type: 'request.accepted', actorId: 'P12', visibility: both }),
    event({
      type: 'request.relayed',
      actorId: 'P12',
      visibility: theirs,
      payload: { fromActorId: 'P12', toActorId: 'P6', subjectId: 'P9', basis: 'recorded_relation' },
    }),
    event({ type: 'request.accepted', actorId: 'P6', visibility: theirs }),
    event({ type: 'task.check_performed', actorId: 'P6', visibility: ['P6', 'RESEARCHER'],
            payload: { outcome: 'subject_found_well', place: 'HOME:P9', subjectId: 'P9' } }),
    event({ type: 'need.resolved', visibility: ['MEDial', 'P12', 'P6', 'P9', 'RESEARCHER'],
            payload: { byActorId: 'P12', resolutionPath: 'neighbour_check' } }),
    event({ type: 'world.relay_resolved', actorId: 'ENGINE', visibility: ['RESEARCHER'],
            payload: { reportedBy: 'P12', performedBy: 'P6' } }),
  ];
}

describe('askedPeople', () => {
  it('shows the researcher the hand-off and MEDial the acceptance it was told', () => {
    const all = handoffLog();
    const researcher = askedPeople(requestFlows(all)[0]);
    expect(researcher.map((r) => [r.actorId, r.askedBy, r.answer])).toEqual([
      ['P12', 'MEDial', 'relayed'],
      ['P6', 'P12', 'accepted'],
    ]);
    expect(researcher[0].passedTo).toBe('P6');
    expect(researcher[1].seenByMedial).toBe(false);

    const medial = askedPeople(requestFlows(all.filter((e) => e.visibility.includes('MEDial')))[0]);
    expect(medial.map((r) => [r.actorId, r.answer])).toEqual([['P12', 'accepted']]);
  });

  it('keeps one row per ask so three refusals in turn are all shown', () => {
    const flow = requestFlows([
      event({ type: 'request.offered', payload: { toActorId: 'P10' } }),
      event({ type: 'request.declined', actorId: 'P10',
              payload: { rule: 'persona_condition', reason: '영업 중 가게를 비울 수 없다' } }),
      event({ type: 'request.offered', payload: { toActorId: 'P11' } }),
      event({ type: 'request.declined', actorId: 'P11',
              payload: { rule: 'persona_condition', reason: '영업 중 가게를 비울 수 없다' } }),
      event({ type: 'request.offered', payload: { toActorId: 'P9' } }),
      event({ type: 'request.accepted', actorId: 'P9' }),
    ])[0];
    const rows = askedPeople(flow);
    expect(rows.map((r) => r.answer)).toEqual(['declined', 'declined', 'accepted']);
    expect(rows[0].reason).toBe('영업 중 가게를 비울 수 없다');
    expect(rows[0].rule).toBe('persona_condition');
    expect(rows.every((r) => r.seenByMedial)).toBe(true);
  });

  it('closes the head row with what he said when asked where the person would be', () => {
    const flow = requestFlows([
      event({ type: 'request.raised', payload: {} }),
      event({ type: 'request.offered', payload: { toActorId: 'P9' } }),
      event({ type: 'request.accepted', actorId: 'P9' }),
      event({ type: 'request.offered', payload: { toActorId: 'P6', purpose: 'whereabouts' } }),
      event({ type: 'medial.observed', actorId: 'P6',
              payload: { observationKind: 'local_knowledge', suggestedPlace: 'FARM' } }),
    ])[0];
    const rows = askedPeople(flow);
    expect(rows.map((r) => [r.actorId, r.answer])).toEqual([['P9', 'accepted'], ['P6', 'told']]);
    expect(rows[1].reason).toBe('밭에 있을 것');
  });
});

describe('storyRows for a hand-off', () => {
  it('says who really went, and that MEDial does not know', () => {
    const rows = storyRows(handoffLog());
    const texts = rows.map((r) => r.text);
    expect(texts.some((t) => t.includes('이장에게 P9 확인을 넘겼습니다') && t.includes('MEDial은 이것을 모릅니다'))).toBe(true);
    expect(texts.some((t) => t.includes('실제로 간 사람은 이장'))).toBe(true);
  });

  it('never reaches MEDial view', () => {
    const rows = storyRows(handoffLog().filter((e) => e.visibility.includes('MEDial')));
    expect(rows.some((r) => r.event.type === 'request.relayed')).toBe(false);
    expect(rows.some((r) => r.event.type === 'world.relay_resolved')).toBe(false);
  });

  it('prints the refusal sentence, not the rule key', () => {
    const [row] = storyRows([
      event({ type: 'request.declined', actorId: 'P10',
              payload: { rule: 'persona_condition', reason: '영업 중 가게를 비울 수 없다' } }),
    ]);
    expect(row.text).toContain('영업 중 가게를 비울 수 없다');
    expect(row.text).not.toContain('persona_condition');
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
