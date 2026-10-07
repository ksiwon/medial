import { describe, expect, it } from 'vitest';
import type { Episode } from '../scene/types';
import { ledgerAt, needOf, timelineAt } from './dayLedger';

const min = (h: number, m = 0) => (h * 60 + m) * 60_000;
const episode = (requestId: string, subjectId: string, title: string, start: number, end = start,
  medial = true): Episode => ({
  requestId, subjectId, title, firstOfRequest: true, startMs: start, endMs: end,
  beats: [{ medial } as Episode['beats'][number]],
});

const day: Episode[] = [
  episode('w1', 'P1', '본인에게 연락', min(9, 30), min(9, 38)),
  episode('w2', 'P1', '이장에게 확인을 부탁', min(9, 40), min(9, 50)),
  episode('w3', 'P1', '집에 가서 확인', min(10, 0), min(10, 20)),
  episode('t3', 'P9', '올 때 태워 줄 사람', min(12, 55), min(13, 20)),
];
const subtitles: Record<string, string> = {
  w1: '응답 없는 안부 확인 · P1 ◯◯◯', w2: '응답 없는 안부 확인 · P1 ◯◯◯',
  w3: '응답 없는 안부 확인 · P1 ◯◯◯', t3: '병원 동행 · P9 ◯◯◯',
};
const subtitleOf = (id: string) => subtitles[id];

describe('day ledger', () => {
  it('names a request by its need, not by the person', () => {
    expect(needOf('응답 없는 안부 확인 · P1 ◯◯◯', '본인에게 연락')).toBe('응답 없는 안부 확인');
    expect(needOf(null, '본인에게 연락')).toBe('본인에게 연락');
  });

  it('shows nothing before the first request begins', () => {
    const ledger = ledgerAt(day, min(8), subtitleOf);
    expect(ledger.rows).toEqual([]);
    expect(ledger.taken).toBe(0);
  });

  it('folds one request\'s Tasks into one row and never looks ahead', () => {
    const ledger = ledgerAt(day, min(9, 45), subtitleOf);
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0].need).toBe('응답 없는 안부 확인');
    // The house visit at 10:00 has not begun, and is still listed as a step to come
    // only in the row it belongs to - its row exists, the later request's does not.
    expect(ledger.rows[0].steps.map((s) => s.started)).toEqual([true, true, false]);
    expect(ledger.open).toBe(1);
    expect(ledger.done).toBe(0);
  });

  it('calls a request done only once its last Task has finished', () => {
    const mid = ledgerAt(day, min(10, 10), subtitleOf);
    expect(mid.rows[0].state).toBe('open');
    const after = ledgerAt(day, min(10, 30), subtitleOf);
    expect(after.rows[0].state).toBe('done');
    expect(after.done).toBe(1);
    expect(after.open).toBe(0);
  });

  it('counts requests as the day goes on, in the order they began', () => {
    const ledger = ledgerAt(day, min(13, 0), subtitleOf);
    expect(ledger.rows.map((r) => r.need)).toEqual(['응답 없는 안부 확인', '병원 동행']);
    expect(ledger.taken).toBe(2);
    expect(ledger.done).toBe(1);
    expect(ledger.open).toBe(1);
  });

  it('tallies who has been asked, once per request', () => {
    const asked: Record<string, string[]> = { w1: ['P1'], w2: ['P6'], w3: ['P6'], t3: ['P3', 'P6'] };
    const ledger = ledgerAt(day, min(14), subtitleOf, (id) => asked[id] ?? []);
    expect(ledger.load.find((l) => l.actorId === 'P6')?.count).toBe(2);
    expect(ledger.load.find((l) => l.actorId === 'P3')?.count).toBe(1);
  });

  it('falls back to a Task\'s own title when the record carries no panel', () => {
    const ledger = ledgerAt(day, min(10, 30), () => null);
    expect(ledger.rows.map((r) => r.need)).toEqual(['본인에게 연락', '이장에게 확인을 부탁', '집에 가서 확인']);
  });

  it('holds a zero-length Task open for a minute so it can be seen', () => {
    const instant = [episode('x1', 'P1', '확인', min(9, 30), min(9, 30))];
    const ledger = ledgerAt(instant, min(9, 30) + 30_000, () => null);
    expect(ledger.rows[0].state).toBe('open');
    expect(ledgerAt(instant, min(9, 40), () => null).rows[0].state).toBe('done');
  });
});

describe('what MEDial did not see', () => {
  const pier = episode('a1', 'P8', '항구에서 한 말', min(10, 56), min(11), false);

  it('does not count a scene MEDial was not in as its own request', () => {
    const ledger = ledgerAt([...day, pier], min(11, 30), subtitleOf);
    expect(ledger.rows.map((r) => r.need)).toEqual(['응답 없는 안부 확인']);
    expect(ledger.taken).toBe(1);
  });

  it('counts a request as MEDial own when any one of its Tasks had MEDial in it', () => {
    const mixed = [episode('x1', 'P1', '본인에게 연락', min(9), min(9, 5), true),
      episode('x2', 'P1', '집에 가서 확인', min(9, 30), min(9, 50), false)];
    const ledger = ledgerAt(mixed, min(10), () => '응답 없는 안부 확인 · P1 ◯◯◯');
    expect(ledger.rows).toHaveLength(1);
    expect(timelineAt(mixed, min(10), new Set(), () => '응답 없는 안부 확인 · P1 ◯◯◯', true).every((t) => t.medial)).toBe(true);
  });
});

describe('the timeline', () => {
  const pier = episode('a1', 'P8', '항구에서 한 말', min(10, 56), min(11), false);
  const all = [...day, pier];

  it('lists what has begun, lights what is happening, and nothing unplanned ahead', () => {
    const items = timelineAt(all, min(9, 41), new Set(), subtitleOf, true);
    expect(items.map((i) => [i.title, i.state])).toEqual([['본인에게 연락', 'done'], ['이장에게 확인을 부탁', 'now']]);
    expect(items[1].need).toBe('응답 없는 안부 확인');
  });

  it('lights one Task when the next begins the minute the last ends', () => {
    const back = [episode('x1', 'P1', '본인에게 연락', min(9, 30), min(9, 40)), episode('x2', 'P1', '이장에게 확인을 부탁', min(9, 40), min(9, 42))];
    expect(timelineAt(back, min(9, 40), new Set(), () => null, true).map((i) => i.state)).toEqual(['done', 'now']);
  });

  it('shows a scheduled Task ahead, without the name its outcome gives it', () => {
    const items = timelineAt(all, min(8), new Set(['w1']), subtitleOf, true);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: '본인에게 연락', state: 'planned', need: null });
  });

  it('says what MEDial did not see only in the researcher view, and only once it happened', () => {
    expect(timelineAt(all, min(11, 30), new Set(), subtitleOf, true).find((i) => !i.medial)?.title).toBe('항구에서 한 말');
    expect(timelineAt(all, min(11, 30), new Set(), subtitleOf, false).some((i) => !i.medial)).toBe(false);
    expect(timelineAt(all, min(10), new Set(), subtitleOf, true).some((i) => !i.medial)).toBe(false);
  });
});

describe('routine', () => {
  const pose = (id: string, place: string | null, o: { diverges?: boolean; offMap?: boolean; moving?: boolean } = {}) =>
    ({ id, place, offMap: o.offMap ?? false, moving: o.moving ?? false, divergesFromBaseline: o.diverges ?? false });
  const label = (place: string | null) => ({ FARM: '밭', HALL: '마을회관' }[place ?? ''] ?? null);

  it('counts who is on their ordinary day and who has left it', async () => {
    const { routineAt } = await import('./dayLedger');
    const r = routineAt([pose('P1', 'FARM'), pose('P2', 'FARM'), pose('P6', 'HALL', { diverges: true })], label);
    expect(r.onRoutine).toBe(2);
    expect(r.departed).toBe(1);
    expect(r.where[0]).toEqual({ label: '밭', count: 2, ids: ['P1', 'P2'], departed: [] });
    expect(r.where[1].departed).toEqual(['P6']);
  });

  it('says a person at their own home is at home, not on the road', async () => {
    const { routineAt } = await import('./dayLedger');
    // placeLabel returns null for the viewer's own home; that must not read as "길 위".
    const r = routineAt([pose('P1', 'HOME:P1'), pose('P5', 'HOME:P5'), pose('P3', 'ROAD', { moving: true })], () => null);
    expect(r.where.map((w) => [w.label, w.count])).toEqual([['자택', 2], ['길 위', 1]]);
  });

  it('names people outside the map as outside, not as nowhere', async () => {
    const { routineAt } = await import('./dayLedger');
    const r = routineAt([pose('P9', null, { offMap: true })], label);
    expect(r.where.map((w) => [w.label, w.count])).toEqual([['마을 밖', 1]]);
  });
});
