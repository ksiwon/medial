import { beforeEach, describe, expect, it } from 'vitest';
import fixture from './week.fixture.json';
import { beforeLines, dayOf, eventOf, eventsInOrder, isWeak, nameOf, numberOf, positionIn, runsOf, versionOf } from './selectors';
import { useWeekStore } from './store';
import type { Week } from './types';

const week = fixture as unknown as Week;
const reset = (w: Week = week) => useWeekStore.setState({
  loaded: true, week: w, error: null, introStarted: true, pathStarted: false, step: 'week', eventId: null,
  lineIndex: 0, seen: [], paths: {}, considering: null, generating: false, closingWords: false,
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
    expect(versionOf(e6, [])!.requests).toEqual([]);
    for (const event of week.events.filter((e) => !e.noChoice)) expect(versionOf(event, [])!.requests.length).toBeGreaterThan(0);
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
      for (const claim of ev.claims) {
        expect(claim.citedLines.length).toBeGreaterThan(0);
        for (const n of claim.citedLines) expect(n).toBeGreaterThanOrEqual(1);
        expect(Math.max(...claim.citedLines)).toBeLessThanOrEqual(lines.length);
      }
    }
  });

  it('puts a reading position in the right scene and says when the telling is done', () => {
    const scenes = eventOf(week, 'E1')!.before.scenes;
    const first = scenes[0].lines.length;
    expect(positionIn(scenes, 0)).toMatchObject({ scene: 0, line: 0, done: false });
    expect(positionIn(scenes, first)).toMatchObject({ scene: 1, line: 0 });
    expect(positionIn(scenes, 999).done).toBe(true);
  });

  it('reads an event in versions: ver1 is as it first ran, and a request makes the next', () => {
    const E1 = eventOf(week, 'E1')!;
    const first = versionOf(E1, [])!;
    expect(first).toMatchObject({ number: 1, chain: [] });
    expect(first.scenes).toBe(E1.before.scenes);
    expect(first.evaluations).toBe(E1.before.evaluations);
    expect(first.requests).toBe(E1.requests);
    const second = versionOf(E1, ['A'])!;
    const A = E1.requests.find((r) => r.id === 'A')!;
    expect(second).toMatchObject({ number: 2, path: ['A'] });
    expect(second.scenes).toEqual([A.after.scene]);
    expect(second.evaluations).toBe(A.after.evaluations);
    expect(second.requests).toBe(A.after.requests);
    // A request the event does not offer there makes no version.
    expect(versionOf(E1, ['Z'])).toBeNull();
    expect(versionOf(E1, ['A', 'Z'])).toBeNull();
    expect(versionOf(null, [])).toBeNull();
    // An emergency offers nothing, whatever the records say.
    expect(versionOf(eventOf(week, 'E6')!, [])!.requests).toEqual([]);
  });

  it('goes a version deeper where the records go deeper, and stops where they stop', () => {
    const deeper = week;
    const E1 = eventOf(deeper, 'E1')!;
    const third = versionOf(E1, ['A', 'B'])!;
    expect(third.number).toBe(3);
    expect(third.chain.map((q) => q.id)).toEqual(['A', 'B']);
    expect(third.requests).toEqual([]);
    expect(versionOf(E1, ['A'])!.requests.map((q) => q.id)).toEqual(['B', 'C']);
  });

  it('counts how many times the AI has been changed', () => {
    expect(runsOf({})).toBe(0);
    expect(runsOf({ E1: ['A', 'B'], E3: ['B'], E4: [] })).toBe(3);
  });
});

describe('the walk', () => {
  beforeEach(() => reset());
  const s = () => useWeekStore.getState();

  it('goes week -> event -> evaluations -> choose, and a choice makes the next version, back at the week', () => {
    s().openEvent('E1');
    expect(s().step).toBe('telling');
    expect(s().seen).toEqual(['E1']);
    s().goEvaluations();
    expect(s().step).toBe('evaluations');
    s().goChoose();
    expect(s().step).toBe('choose');
    s().chooseRequest('A');
    // The wall says a new simulation is being made; the event is already one version on.
    expect(s()).toMatchObject({ step: 'choose', generating: true, paths: { E1: ['A'] }, considering: null });
    s().endGenerating();
    expect(s()).toMatchObject({ step: 'week', eventId: null, generating: false, paths: { E1: ['A'] } });
  });

  it('reads the next version when the event is opened again, and offers what that version offers', () => {
    reset(week);
    s().openEvent('E1'); s().goEvaluations(); s().goChoose(); s().chooseRequest('A'); s().endGenerating();
    s().openEvent('E1'); s().goEvaluations(); s().goChoose();
    expect(s().step).toBe('choose');
    // Only the requests ver2 offers can be chosen from here, not ver1's.
    s().chooseRequest('Z');
    expect(s().paths.E1).toEqual(['A']);
    s().chooseRequest('B');
    expect(s().paths.E1).toEqual(['A', 'B']);
    s().endGenerating();
    expect(s().step).toBe('week');
  });

  it('ends an event where nothing is left to choose: the way on is back at the week', () => {
    reset(week);
    useWeekStore.setState({ paths: { E1: ['A', 'B'] } });
    s().openEvent('E1'); s().goEvaluations(); s().goChoose();
    expect(s().step).toBe('week');
    // An emergency is read, never chosen.
    s().openEvent('E6'); s().goEvaluations(); s().goChoose();
    expect(s()).toMatchObject({ step: 'week', paths: { E1: ['A', 'B'] } });
    expect(s().seen).toContain('E6');
  });

  it('drops a choice that does not belong: from another screen, or a request the version does not offer', () => {
    s().openEvent('E1');
    s().chooseRequest('A');
    expect(s().paths).toEqual({});
    s().goEvaluations();
    s().goChoose();
    s().chooseRequest('Z');
    expect(s()).toMatchObject({ step: 'choose', paths: {}, generating: false });
    s().consider('Z');
    expect(s().considering).toBeNull();
    s().consider('A');
    expect(s().considering).toBe('A');
  });

  it('does not open an event that is not in the week', () => {
    useWeekStore.getState().openEvent('E99');
    expect(useWeekStore.getState().eventId).toBeNull();
  });

  it('forgets everything on restart, including the versions made', () => {
    s().openEvent('E1'); s().goEvaluations(); s().goChoose(); s().chooseRequest('A'); s().endGenerating();
    s().restart();
    expect(s()).toMatchObject({ introStarted: false, pathStarted: false, eventId: null, seen: [], paths: {}, generating: false });
  });
});
