import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import IdleScreen from '../screens/IdleScreen';
import fixture from '../week/week.fixture.json';
import { useWeekStore } from '../week/store';
import type { Week } from '../week/types';
import { roleOf } from './protocol';
import { apply, describeStage, evaluationsOf, scenesOf } from './wall';

// The two screens' contract: a press from the tablet moves the wall's walk, only where it makes sense, and what
// the wall says it shows is what the tablet draws.

const week = fixture as unknown as Week;
const walk = () => useWeekStore.getState();
const at = (patch: Partial<ReturnType<typeof useWeekStore.getState>>) => useWeekStore.setState(patch);

const reset = () => useWeekStore.setState({
  loaded: true, week, error: null, introStarted: false, pathStarted: false, step: 'week', eventId: null,
  requestId: null, lineIndex: 0, openActor: null, seen: [],
});

beforeEach(reset);
afterEach(cleanup);

describe('the tablet starts the walk', () => {
  it('moves nothing until it has started: no press opens an event that is not on', () => {
    for (const name of ['skipScene', 'toEvaluations', 'toChoose', 'toResult', 'closeResident', 'week'] as const) apply({ name });
    apply({ name: 'openEvent', id: 'E1' });
    apply({ name: 'line', value: 1 });
    apply({ name: 'choose', id: 'A' });
    expect(walk()).toMatchObject({ introStarted: false, pathStarted: false, step: 'week', eventId: null, requestId: null, lineIndex: 0 });
  });

  it('start opens the film once; a second start changes nothing', () => {
    apply({ name: 'start' });
    expect(walk().introStarted).toBe(true);
    apply({ name: 'start' });
    expect(walk()).toMatchObject({ introStarted: true, pathStarted: false });
  });

  it('skipping the film opens the week, and only while the film is on', () => {
    apply({ name: 'skipIntro' });
    expect(walk().pathStarted).toBe(false);
    apply({ name: 'start' });
    apply({ name: 'skipIntro' });
    expect(walk()).toMatchObject({ pathStarted: true, step: 'week' });
  });

  it('home from anywhere goes back to the waiting screen and forgets what was read', () => {
    at({ introStarted: true, pathStarted: true, step: 'evaluations', eventId: 'E1', openActor: 'P1', seen: ['E1'] });
    apply({ name: 'home' });
    expect(walk()).toMatchObject({ introStarted: false, pathStarted: false, step: 'week', eventId: null, openActor: null, seen: [] });
  });
});

describe('the week, from the tablet', () => {
  beforeEach(() => at({ introStarted: true, pathStarted: true }));

  it('opens an event that is in the week, and never one that is not', () => {
    apply({ name: 'openEvent', id: 'E99' });
    expect(walk()).toMatchObject({ step: 'week', eventId: null });
    apply({ name: 'openEvent', id: 'E3' });
    expect(walk()).toMatchObject({ step: 'before', eventId: 'E3', lineIndex: 0 });
  });

  it('does not open a second event on top of the first: the week is where the next one is picked', () => {
    apply({ name: 'openEvent', id: 'E3' });
    apply({ name: 'openEvent', id: 'E1' });
    expect(walk().eventId).toBe('E3');
    apply({ name: 'week' });
    expect(walk()).toMatchObject({ step: 'week', eventId: null });
    apply({ name: 'openEvent', id: 'E1' });
    expect(walk().eventId).toBe('E1');
  });
});

describe('a telling, from the tablet', () => {
  beforeEach(() => { at({ introStarted: true, pathStarted: true }); apply({ name: 'openEvent', id: 'E1' }); });
  const event = () => week.events.find((e) => e.id === 'E1')!;
  const total = () => event().before.scenes.reduce((n, s) => n + s.lines.length, 0);

  it('moves a line at a time and stops at both ends', () => {
    apply({ name: 'line', value: -1 });
    expect(walk().lineIndex).toBe(0);
    apply({ name: 'line', value: 1 });
    apply({ name: 'line', value: 1 });
    expect(walk().lineIndex).toBe(2);
    for (let i = 0; i < 40; i += 1) apply({ name: 'line', value: 1 });
    expect(walk().lineIndex).toBe(total() - 1);
  });

  it('skips to the start of the next scene', () => {
    apply({ name: 'skipScene' });
    expect(walk().lineIndex).toBe(event().before.scenes[0].lines.length);
  });

  it('goes on to the evaluations from a telling, and a late press from a screen that has gone is dropped', () => {
    apply({ name: 'toEvaluations' });
    expect(walk().step).toBe('evaluations');
    apply({ name: 'line', value: 1 });
    apply({ name: 'skipScene' });
    expect(walk()).toMatchObject({ step: 'evaluations', lineIndex: 0 });
    apply({ name: 'toResult' });
    expect(walk().step).toBe('evaluations');
  });
});

describe('the evaluations, from the tablet', () => {
  beforeEach(() => { at({ introStarted: true, pathStarted: true }); apply({ name: 'openEvent', id: 'E1' }); apply({ name: 'toEvaluations' }); });
  const asked = () => week.events.find((e) => e.id === 'E1')!.before.evaluations;

  it('opens one resident\'s card, and the same press for someone who was not in the event opens nothing', () => {
    apply({ name: 'openResident', id: asked()[0].actor });
    expect(walk().openActor).toBe(asked()[0].actor);
    apply({ name: 'openResident', id: 'P99' });
    expect(walk().openActor).toBe(asked()[0].actor);
  });

  it('closing a card brings the list back', () => {
    apply({ name: 'openResident', id: asked()[0].actor });
    apply({ name: 'closeResident' });
    expect(walk().openActor).toBeNull();
  });
});

describe('choosing, from the tablet', () => {
  beforeEach(() => at({ introStarted: true, pathStarted: true }));

  const toChoose = (id: string) => { apply({ name: 'openEvent', id }); apply({ name: 'toEvaluations' }); apply({ name: 'toChoose' }); };

  it('only a request of this event can be chosen', () => {
    toChoose('E1');
    expect(walk().step).toBe('choose');
    apply({ name: 'choose', id: 'Z' });
    expect(walk()).toMatchObject({ step: 'choose', requestId: null });
    apply({ name: 'choose', id: 'A' });
    expect(walk()).toMatchObject({ step: 'after', requestId: 'A', lineIndex: 0 });
  });

  it('a choice cannot be taken back: once made, a second one does nothing', () => {
    toChoose('E1');
    apply({ name: 'choose', id: 'A' });
    apply({ name: 'choose', id: 'C' });
    expect(walk().requestId).toBe('A');
  });

  it('a choose pressed while another screen is on does nothing', () => {
    apply({ name: 'openEvent', id: 'E1' });
    apply({ name: 'choose', id: 'A' });
    expect(walk()).toMatchObject({ step: 'before', requestId: null });
  });

  it('an emergency has nothing to choose: it ends in its result, and counts as read', () => {
    apply({ name: 'openEvent', id: 'E6' });
    apply({ name: 'toEvaluations' });
    apply({ name: 'toChoose' });
    expect(walk()).toMatchObject({ step: 'result', requestId: null });
    expect(walk().seen).toContain('E6');
  });

  it('after the chosen scene the result is reached by the tablet, and counts the event as read', () => {
    toChoose('E1');
    apply({ name: 'choose', id: 'A' });
    apply({ name: 'toResult' });
    expect(walk().step).toBe('result');
    expect(walk().seen).toEqual(['E1']);
  });
});

describe('what the wall says it shows', () => {
  const state = (over: Partial<Parameters<typeof describeStage>[0]> = {}) => describeStage({
    week, introStarted: true, pathStarted: true, step: 'week', eventId: null, requestId: null, lineIndex: 0,
    openActor: null, seen: [], ...over,
  });

  it('says idle before the walk and intro during the film, with nothing else to press', () => {
    expect(state({ introStarted: false, pathStarted: false }).phase).toBe('idle');
    expect(state({ pathStarted: false }).phase).toBe('intro');
    expect(state({ pathStarted: false }).week).toEqual([]);
  });

  it('lists the whole week for the tablet, with what is read and what is an emergency', () => {
    const s = state({ seen: ['E1'] });
    expect(s.phase).toBe('week');
    expect(s.week.map((d) => d.day)).toEqual(['월', '화', '수', '목', '금', '토', '일']);
    expect(s.week.find((d) => d.day === '화')!.events).toEqual([]);
    expect(s.week.find((d) => d.day === '월')!.events[0]).toMatchObject({ id: 'E1', seen: true, noChoice: false });
    expect(s.week.flatMap((d) => d.events).find((e) => e.id === 'E6')!.noChoice).toBe(true);
    expect([s.seen, s.total]).toEqual([1, 8]);
  });

  it('tells where in a telling the wall is, and says it is done only on the last line', () => {
    const event = week.events.find((e) => e.id === 'E1')!;
    const last = event.before.scenes.reduce((n, s) => n + s.lines.length, 0) - 1;
    const first = state({ step: 'before', eventId: 'E1', lineIndex: 0 });
    expect(first).toMatchObject({ phase: 'before', toldAll: false, line: 0 });
    expect(first.scene).toMatchObject({ index: 0, of: event.before.scenes.length });
    expect(state({ step: 'before', eventId: 'E1', lineIndex: last }).toldAll).toBe(true);
  });

  it('lists the residents of the event, and only the one who is open as open', () => {
    const event = week.events.find((e) => e.id === 'E1')!;
    const s = state({ step: 'evaluations', eventId: 'E1', openActor: event.before.evaluations[0].actor });
    expect(s.residents.map((r) => r.id)).toEqual(event.before.evaluations.map((e) => e.actor));
    expect(s.openActor).toBe(event.before.evaluations[0].actor);
  });

  it('offers each request by its place in the event: the tablet shows its number, the wall shows the card', () => {
    const s = state({ step: 'choose', eventId: 'E1' });
    const event = week.events.find((e) => e.id === 'E1')!;
    expect(s.requests).toEqual(event.requests.map((r) => ({ id: r.id, label: r.label })));
  });

  it('offers an emergency no requests', () => {
    expect(state({ step: 'evaluations', eventId: 'E6' }).requests).toEqual([]);
    expect(state({ step: 'evaluations', eventId: 'E6' }).event?.noChoice).toBe(true);
  });

  it('tells the scene a chosen request led to, not the event\'s own', () => {
    const event = week.events.find((e) => e.id === 'E1')!;
    expect(scenesOf(event, 'before', null)).toEqual(event.before.scenes);
    expect(scenesOf(event, 'after', 'A')).toEqual([event.requests.find((r) => r.id === 'A')!.after.scene]);
    expect(evaluationsOf(event, 'result', 'A')).toEqual(event.requests.find((r) => r.id === 'A')!.after.evaluations);
    expect(evaluationsOf(event, 'evaluations', null)).toEqual(event.before.evaluations);
  });
});

describe('the waiting screen', () => {
  it('asks the visitor to use the tablet, and has nothing to press itself', () => {
    const { container } = render(<IdleScreen art={new Set()} />);
    expect(screen.getByText('Dially')).toBeDefined();
    expect(screen.getByText(/태블릿에서 시작하기/)).toBeDefined();
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('which screen an address is for', () => {
  it('reads the role from the address and knows nothing else', () => {
    expect(roleOf('?role=pad')).toBe('pad');
    expect(roleOf('?role=wall')).toBe('wall');
    expect(roleOf('')).toBeNull();
    expect(roleOf('?role=admin')).toBeNull();
  });
});
