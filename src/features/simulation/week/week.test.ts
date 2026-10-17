import { beforeEach, describe, expect, it } from 'vitest';
import fixture from './week.fixture.json';
import { beforeLines, dayOf, eventOf, eventsInOrder, isWeak, nameOf, numberOf, positionIn, progress, requestsOf } from './selectors';
import { useWeekStore } from './store';
import type { Week } from './types';

const week = fixture as unknown as Week;
const reset = () => useWeekStore.setState({
  loaded: true, week, error: null, introStarted: true, pathStarted: false, step: 'week', eventId: null, requestId: null,
  lineIndex: 0, openActor: null, seen: [],
});

describe('the week', () => {
  it('has days with no event and days with several: it is not one event a day', () => {
    const counts = week.days.map((d) => d.events.length);
    expect(week.days.map((d) => d.day)).toEqual(['월', '화', '수', '목', '금', '토', '일']);
    expect(counts).toContain(0);
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(2);
  });

  it('says which day an event falls on from the schedule, not from the event', () => {
    expect(dayOf(week, 'E1')).toBe('월');
    expect(dayOf(week, 'E6')).toBe('금');
    expect(dayOf(week, 'E9')).toBeNull();
  });

  it('tells the events in the order of the days', () => {
    const ids = eventsInOrder(week).map((e) => e.id);
    expect(ids).toEqual(week.days.flatMap((d) => d.events));
    // The cause comes before its effect.
    expect(ids.indexOf('E1')).toBeLessThan(ids.indexOf('E8'));
    expect(ids.indexOf('E4')).toBeLessThan(ids.indexOf('E6'));
  });

  it('names the service only as AI and every person by a pseudonym', () => {
    expect(nameOf(week, 'AI')).toBe('AI');
    expect(nameOf(week, 'P1')).toBe('한상덕');
    expect(JSON.stringify(week)).not.toContain('MEDial');
  });

  it('gives an emergency no request cards and every other event at least one', () => {
    const e6 = eventOf(week, 'E6')!;
    expect(e6.noChoice).toBe(true);
    expect(requestsOf(e6)).toEqual([]);
    for (const event of week.events.filter((e) => !e.noChoice)) expect(requestsOf(event).length).toBeGreaterThan(0);
  });

  it('marks a request the residents only weakly support as weak', () => {
    const all = week.events.flatMap((e) => e.requests);
    expect(all.some(isWeak)).toBe(true);
    for (const r of all) expect(['direct', 'weak']).toContain(r.basis.verdict);
  });

  it('numbers lines across an event\'s scenes the way the evaluations cite them', () => {
    const event = eventOf(week, 'E1')!;
    const lines = beforeLines(event);
    expect(lines.length).toBe(event.before.scenes.reduce((n, s) => n + s.lines.length, 0));
    // The first line of the second scene follows the last of the first.
    expect(numberOf(event.before.scenes, 1, 0)).toBe(event.before.scenes[0].lines.length + 1);
    for (const ev of event.before.evaluations) {
      for (const n of ev.citedLines) expect(n).toBeGreaterThanOrEqual(1);
      expect(Math.max(...ev.citedLines)).toBeLessThanOrEqual(lines.length);
    }
  });

  it('puts a reading position in the right scene and says when the telling is done', () => {
    const scenes = eventOf(week, 'E1')!.before.scenes;
    const first = scenes[0].lines.length;
    expect(positionIn(scenes, 0)).toMatchObject({ scene: 0, line: 0, done: false });
    expect(positionIn(scenes, first)).toMatchObject({ scene: 1, line: 0 });
    expect(positionIn(scenes, 999).done).toBe(true);
  });

  it('counts what has been read', () => {
    expect(progress(week, new Set(['E1', 'E3']))).toEqual({ seen: 2, of: 8 });
  });
});

describe('the walk', () => {
  beforeEach(reset);

  it('goes week -> event -> evaluations -> choose -> after -> result, then back to the week', () => {
    const s = () => useWeekStore.getState();
    s().openEvent('E1');
    expect(s().step).toBe('before');
    s().goEvaluations();
    expect(s().step).toBe('evaluations');
    s().afterEvaluations();
    expect(s().step).toBe('choose');
    s().chooseRequest('A');
    expect(s()).toMatchObject({ step: 'after', requestId: 'A', lineIndex: 0 });
    s().goResult();
    expect(s().step).toBe('result');
    expect(s().seen).toEqual(['E1']);
    s().backToWeek();
    expect(s()).toMatchObject({ step: 'week', eventId: null, requestId: null });
  });

  it('skips the choice for an emergency and goes straight to its result', () => {
    const s = () => useWeekStore.getState();
    s().openEvent('E6');
    s().goEvaluations();
    s().afterEvaluations();
    expect(s().step).toBe('result');
    expect(s().seen).toContain('E6');
  });

  it('drops a choice that does not belong: from another screen, or a request the event does not have', () => {
    const s = () => useWeekStore.getState();
    s().openEvent('E1');
    s().chooseRequest('A');
    expect(s().step).toBe('before');
    s().goEvaluations();
    s().afterEvaluations();
    s().chooseRequest('Z');
    expect(s().step).toBe('choose');
  });

  it('does not open an event that is not in the week', () => {
    useWeekStore.getState().openEvent('E99');
    expect(useWeekStore.getState().eventId).toBeNull();
  });

  it('forgets everything on restart, including what was read', () => {
    const s = () => useWeekStore.getState();
    s().openEvent('E1');
    s().goResult();
    s().restart();
    expect(s()).toMatchObject({ introStarted: false, pathStarted: false, eventId: null, seen: [] });
  });
});
