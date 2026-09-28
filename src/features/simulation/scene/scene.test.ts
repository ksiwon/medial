import { describe, expect, it } from 'vitest';
import attemptFixture from '../../../../fixtures/ui/attempt.json';
import eventsFixture from '../../../../fixtures/ui/events.json';
import villageFixture from '../../../../fixtures/ui/village.json';
import type { AttemptDetail, DecisionRecord, DomainEvent, RuleTraceRecord, VillagePayload } from '../api/types';
import { sentenceFor } from '../selectors/story';
import { buildEpisodes, MAP_GAP_MS } from './beats';
import { judgmentOf } from './judgment';
import { buildReel } from './reel';

// What the observe screen claims, checked against a real run of the synthetic
// village (fixtures/ui/) and against small hand-made logs for the cases that
// run does not reach. Never how it looks: each case is one where the screen
// would otherwise say something untrue.

const village = villageFixture as unknown as VillagePayload;
const detail = attemptFixture as unknown as AttemptDetail;
const events = (eventsFixture as { events: DomainEvent[] }).events;
const timeline = detail.timeline ?? null;
const DAY = { dayStartMs: 5 * 3_600_000, dayEndMs: 22 * 3_600_000 };

const episodes = (viewMode: 'researcher' | 'medial' = 'researcher', log = events) =>
  buildEpisodes({ events: log, timeline: log === events ? timeline : null, village, viewMode });
const reel = (pace = 1, log = events) =>
  buildReel({ episodes: episodes('researcher', log), events: log, timeline: log === events ? timeline : null, pace, ...DAY });

let seq = 0;
function event(partial: Partial<DomainEvent> & { type: string }): DomainEvent {
  seq += 1;
  return {
    id: `ev-${seq}`, attemptId: 'att-test', seq, simTimeMs: 9 * 3_600_000 + seq * 60_000,
    actorId: 'MEDial', causationId: null, correlationId: 'req-P1-1', visibility: ['MEDial'],
    committed: true, payload: {}, ...partial,
  };
}

describe('buildEpisodes', () => {
  it('never puts a world-only fact on screen', () => {
    const shown = new Set(episodes().flatMap((e) => e.beats.flatMap((b) => b.lines.map((l) => l.seq))));
    for (const e of events.filter((x) => x.type.startsWith('world.'))) expect(shown.has(e.seq)).toBe(false);
  });

  it('shows the silent house and where the person really is - to the researcher only', () => {
    const checkin = episodes().find((e) => e.requestId === 'checkin-P1')!;
    const frames = checkin.beats[0].frames;
    expect(frames.find((f) => f.device === '안내 시계')?.place).toBe('HOME:P1');
    // In the world P1 was at the farm, which is why nobody answered.
    const p1 = frames.find((f) => f.who.includes('P1'))!;
    expect(p1.place).toBe('FARM');
    expect(p1.poses.P1).toBe('work');

    // MEDial was told nothing about where P1 is.
    const medial = episodes('medial').find((e) => e.requestId === 'checkin-P1')!;
    expect(medial.beats[0].frames.find((f) => f.who.includes('P1'))!.place).toBeNull();
  });

  it('speaks only words the log carries, and captions every other act', () => {
    const byId = new Map(events.map((e) => [e.seq, e]));
    for (const episode of episodes()) {
      for (const line of episode.beats.flatMap((b) => b.lines)) {
        const source = byId.get(line.seq)!;
        const p = source.payload as Record<string, unknown>;
        if (line.kind === 'say') expect([p.utterance, p.message, p.report]).toContain(line.text);
        else expect(line.text).toBe(sentenceFor(source)!.text);
      }
    }
  });

  it('marks the visit where MEDial is not, and says what it waits for', () => {
    // The walk to the farm is a silence, so the visit is its own stretch of the request.
    const visit = episodes().filter((e) => e.requestId === 'req-P1-1')
      .flatMap((e) => e.beats).find((b) => b.frames.some((f) => f.place === 'FARM'))!;
    expect(visit.medial).toBe(false);
    expect(visit.waiting).toBe('P1 확인 결과 대기 중');
    expect(visit.frames[0].who).toEqual(['P6', 'P1']);
  });

  it('keeps a hand-off MEDial never hears out of MEDial\'s view', () => {
    const both = ['MEDial', 'P12'];
    const log = [
      event({ type: 'request.offered', correlationId: 'req-P9', payload: { toActorId: 'P12', subjectId: 'P9' }, visibility: both }),
      event({ type: 'request.accepted', correlationId: 'req-P9', actorId: 'P12', visibility: both }),
      event({ type: 'request.relayed', correlationId: 'req-P9', actorId: 'P12', visibility: ['P12', 'P6', 'RESEARCHER'],
              payload: { toActorId: 'P6', subjectId: 'P9' } }),
    ];
    const researcher = buildEpisodes({ events: log, timeline: null, village, viewMode: 'researcher' });
    const relay = researcher.flatMap((e) => e.beats).find((b) => b.lines.some((l) => l.seq === log[2].seq))!;
    expect(relay.medial).toBe(false);
    const medial = buildEpisodes({ events: log, timeline: null, village, viewMode: 'medial' });
    expect(medial.flatMap((e) => e.beats).flatMap((b) => b.lines).some((l) => l.seq === log[2].seq)).toBe(false);
  });

  it('plays one request at a time, in the order they began', () => {
    const log = [
      event({ type: 'request.offered', correlationId: 'req-A', payload: { toActorId: 'P2' } }),
      event({ type: 'request.offered', correlationId: 'req-B', payload: { toActorId: 'P3' } }),
      event({ type: 'request.accepted', correlationId: 'req-A', actorId: 'P2' }),
    ];
    const order = buildEpisodes({ events: log, timeline: null, village, viewMode: 'researcher' });
    expect(order.map((e) => e.requestId)).toEqual(['req-A', 'req-B']);
    // A's two events are one stretch again once B is out of the way.
    expect(order[0].beats.flatMap((b) => b.lines.map((l) => l.seq))).toEqual([log[0].seq, log[2].seq]);
  });
});

describe('buildReel', () => {
  it('goes back to the map for a silence of three minutes or more, and cuts otherwise', () => {
    const r = reel();
    let clock = DAY.dayStartMs;
    r.episodes.forEach((episode, i) => {
      const lead = r.segments.findIndex((s) => s.kind === 'lead' && s.episode === i && s.beat === 0);
      const before = r.segments[lead - 1];
      const quiet = episode.startMs - clock >= MAP_GAP_MS;
      if (i > 0) expect(before.kind === 'map').toBe(quiet);
      clock = Math.max(clock, episode.endMs);
    });
    expect(r.segments[r.segments.length - 1].kind).toBe('map');
  });

  it('can be entered anywhere: a clock time comes back as itself', () => {
    const r = reel();
    for (const hhmm of [6 * 60, 12 * 60, 15 * 60 + 30, 20 * 60]) {
      const ms = hhmm * 60_000;
      expect(Math.abs(r.locate(r.atTime(ms)).atMs - ms)).toBeLessThan(60_000);
    }
  });

  it('puts an event under the playhead with its own line on screen', () => {
    const r = reel();
    const said = r.episodes.flatMap((e) => e.beats.flatMap((b) => b.lines)).find((l) => l.kind === 'say')!;
    const at = r.locate(r.atSeq(said.seq));
    expect(at.segment.kind).toBe('line');
    expect(at.cursorSeq).toBe(said.seq);
  });

  it('changes how long lines stay with the pace, never the layout', () => {
    const normal = reel(1);
    const slow = reel(1.35);
    expect(slow.segments.map((s) => s.kind)).toEqual(normal.segments.map((s) => s.kind));
    const line = normal.segments.findIndex((s) => s.kind === 'line');
    expect(slow.segments[line].dur).toBeCloseTo(normal.segments[line].dur * 1.35, 5);
  });

  it('never runs the clock backwards inside a scene', () => {
    const r = reel();
    for (let i = 1; i < r.segments.length; i += 1) {
      const a = r.segments[i - 1];
      const b = r.segments[i];
      if (a.kind !== 'map' && b.kind !== 'map' && a.episode === b.episode) {
        expect(r.locate(b.r0).atMs).toBeGreaterThanOrEqual(r.locate(a.r0).atMs);
      }
    }
  });
});

describe('judgmentOf', () => {
  const decisions: DecisionRecord[] = [{
    id: 'dec-1', attemptId: 'att-test', simTimeMs: 0, policyId: 'p', question: '누가 확인할 것인가',
    candidates: [{ actorId: 'P1', included: false, reason: '확인 대상 본인' }, { actorId: 'P6', included: true, reason: '' }],
    chosen: 'P6', rationale: '이장은 안부 확인을 해 온 사람이다',
    knownFacts: ['P1이 응답하지 않았다'], observationIds: [], excludedByPermission: [],
  }];

  it('takes what MEDial knew from the decision record, not from the event', () => {
    const log = [event({ type: 'medial.decided', payload: { decisionId: 'dec-1', chosen: 'P6', question: '누가 확인할 것인가' } })];
    const j = judgmentOf('req-P1-1', log[0].seq, log, decisions, []);
    expect(j.knows).toEqual(['P1이 응답하지 않았다']);
    expect(j.ruledOut).toEqual([{ actorId: 'P1', reason: '확인 대상 본인' }]);
    expect(j.rationale).toBe('이장은 안부 확인을 해 온 사람이다');
  });

  it('keeps one row per ask, so three answers in turn are all there', () => {
    const log = [
      event({ type: 'request.offered', payload: { toActorId: 'P10' } }),
      event({ type: 'request.declined', actorId: 'P10', payload: { reason: '영업 중 가게를 비울 수 없다' } }),
      event({ type: 'request.offered', payload: { toActorId: 'P9' } }),
      event({ type: 'request.accepted', actorId: 'P9' }),
      event({ type: 'request.offered', payload: { toActorId: 'P6', purpose: 'whereabouts' } }),
    ];
    const j = judgmentOf('req-P1-1', log[log.length - 1].seq, log, [], []);
    expect(j.asked.map((a) => [a.actorId, a.verdict])).toEqual([['P10', 'declined'], ['P9', 'accepted'], ['P6', 'asking']]);
    expect(j.asked[0].heard).toBe('영업 중 가게를 비울 수 없다');
  });

  it('hears an acceptance and nothing of the hand-off behind it', () => {
    const both = ['MEDial', 'P12'];
    const log = [
      event({ type: 'request.offered', payload: { toActorId: 'P12' }, visibility: both }),
      event({ type: 'request.accepted', actorId: 'P12', visibility: both }),
      event({ type: 'request.relayed', actorId: 'P12', visibility: ['P12', 'P6'], payload: { toActorId: 'P6' } }),
      event({ type: 'request.accepted', actorId: 'P6', visibility: ['P6'] }),
    ];
    const j = judgmentOf('req-P1-1', log[log.length - 1].seq, log, [], []);
    expect(j.asked.map((a) => [a.actorId, a.verdict])).toEqual([['P12', 'accepted']]);
  });

  it('lists only the rules this request actually went through', () => {
    const log = [event({ type: 'request.offered', payload: { toActorId: 'P6' } })];
    const rules: RuleTraceRecord[] = [
      { ruleType: 'contact_order', label: '연락 순서', sentence: '이장에게 먼저', conditionStatus: 'occurred',
        executionStatus: 'applied', reason: '', eventRefs: [log[0].id] },
      { ruleType: 'quiet_period', label: '최소 간격', sentence: '10분', conditionStatus: 'occurred',
        executionStatus: 'applied', reason: '', eventRefs: ['someone-else'] },
      { ruleType: 'helper_daily_cap', label: '부탁 상한', sentence: '4번', conditionStatus: 'not_occurred',
        executionStatus: 'not_reached', reason: '', eventRefs: [log[0].id] },
    ];
    expect(judgmentOf('req-P1-1', log[0].seq, log, [], rules).rules.map((r) => r.label)).toEqual(['연락 순서']);
  });
});
