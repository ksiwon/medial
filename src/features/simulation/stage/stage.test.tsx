import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAssets } from '../assets';
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

const reset = (w: Week = week) => useWeekStore.setState({
  loaded: true, week: w, error: null, introStarted: false, pathStarted: false, step: 'week', eventId: null,
  lineIndex: 0, read: [], paths: {}, considering: null, generating: false, closingWords: false, rulesOpen: false,
});

// Every picture and voice is held (assets.ts) unless a test says otherwise.
beforeEach(() => { reset(); useAssets.setState({ status: 'ready' }); });
afterEach(cleanup);

describe('the tablet starts the walk', () => {
  it('moves nothing until it has started: no press opens an event that is not on', () => {
    for (const name of ['skipScene', 'toEvaluations', 'toChoose', 'toTelling', 'week'] as const) apply({ name });
    apply({ name: 'openEvent', id: 'E1' });
    apply({ name: 'line', value: 1 });
    apply({ name: 'choose', id: 'A' });
    expect(walk()).toMatchObject({ introStarted: false, pathStarted: false, step: 'week', eventId: null, paths: {}, lineIndex: 0 });
  });

  it('start is not taken until every picture and voice is held, and the tablet is told so', () => {
    useAssets.setState({ status: 'loading' });
    apply({ name: 'start' });
    expect(walk().introStarted).toBe(false);
    expect(describeStage({ week, introStarted: false, pathStarted: false, step: 'week', eventId: null, lineIndex: 0, ready: false }).ready).toBe(false);
    useAssets.setState({ status: 'ready' });
    apply({ name: 'start' });
    expect(walk().introStarted).toBe(true);
    expect(describeStage({ week, introStarted: false, pathStarted: false, step: 'week', eventId: null, lineIndex: 0, ready: true }).ready).toBe(true);
  });

  it('start opens the film once; a second start changes nothing', () => {
    apply({ name: 'start' });
    expect(walk().introStarted).toBe(true);
    apply({ name: 'start' });
    expect(walk()).toMatchObject({ introStarted: true, pathStarted: false });
  });

  it('skipping the film takes it to its last scene first, then opens the draft, and only while the film is on', () => {
    apply({ name: 'skipIntro' });
    expect(walk()).toMatchObject({ pathStarted: false, introSkipped: false });
    apply({ name: 'start' });
    apply({ name: 'skipIntro' });
    expect(walk()).toMatchObject({ pathStarted: false, introSkipped: true });
    apply({ name: 'skipIntro' });
    expect(walk()).toMatchObject({ pathStarted: true, step: 'draft' });
    // From the draft the tablet goes on to the week.
    apply({ name: 'week' });
    expect(walk()).toMatchObject({ pathStarted: true, step: 'week' });
  });

  it("the film's own controls only act while the film is on, and each press of previous/next is counted once", () => {
    apply({ name: 'introNext' });
    apply({ name: 'introToggle' });
    expect(walk()).toMatchObject({ introPaused: false, introMove: { n: 0 } });
    apply({ name: 'start' });
    apply({ name: 'introToggle' });
    expect(walk().introPaused).toBe(true);
    expect(describeStage({ week, introStarted: true, pathStarted: false, step: 'week', eventId: null, lineIndex: 0, introPaused: walk().introPaused }))
      .toMatchObject({ phase: 'intro', introPaused: true });
    apply({ name: 'introNext' });
    apply({ name: 'introPrev' });
    expect(walk().introMove).toEqual({ dir: -1, n: 2 });
    apply({ name: 'introToggle' });
    expect(walk().introPaused).toBe(false);
  });

  it('home from anywhere goes back to the waiting screen and forgets what was read', () => {
    at({ introStarted: true, pathStarted: true, step: 'evaluations', eventId: 'E1', read: ['E1@1'] });
    apply({ name: 'home' });
    expect(walk()).toMatchObject({ introStarted: false, pathStarted: false, step: 'week', eventId: null, read: [] });
  });
});

describe('the week, from the tablet', () => {
  beforeEach(() => at({ introStarted: true, pathStarted: true }));

  it('opens an event that is in the week, and never one that is not', () => {
    apply({ name: 'openEvent', id: 'E99' });
    expect(walk()).toMatchObject({ step: 'week', eventId: null });
    apply({ name: 'openEvent', id: 'E3' });
    expect(walk()).toMatchObject({ step: 'telling', eventId: 'E3', lineIndex: 0 });
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
  });
});

describe('the evaluations, from the tablet', () => {
  beforeEach(() => { at({ introStarted: true, pathStarted: true }); apply({ name: 'openEvent', id: 'E1' }); apply({ name: 'toEvaluations' }); });

  it('goes back to the telling, and the way back from the requests is these evaluations', () => {
    apply({ name: 'toTelling' });
    expect(walk()).toMatchObject({ step: 'telling', lineIndex: 0 });
    apply({ name: 'toEvaluations' });
    apply({ name: 'toChoose' });
    expect(walk().step).toBe('choose');
    apply({ name: 'toEvaluations' });
    expect(walk()).toMatchObject({ step: 'evaluations', considering: null });
  });
});

describe('choosing, from the tablet', () => {
  beforeEach(() => at({ introStarted: true, pathStarted: true }));

  const toChoose = (id: string) => { apply({ name: 'openEvent', id }); apply({ name: 'toEvaluations' }); apply({ name: 'toChoose' }); };

  it('only a request of this version can be chosen', () => {
    toChoose('E1');
    expect(walk().step).toBe('choose');
    apply({ name: 'choose', id: 'Z' });
    expect(walk()).toMatchObject({ step: 'choose', paths: {}, generating: false });
    apply({ name: 'choose', id: 'A' });
    expect(walk()).toMatchObject({ paths: { E1: ['A'] }, generating: true });
  });

  it('a choice cannot be taken back: once made, a second one does nothing, and the walk waits for the new simulation', () => {
    toChoose('E1');
    apply({ name: 'choose', id: 'A' });
    apply({ name: 'choose', id: 'C' });
    expect(walk().paths.E1).toEqual(['A']);
    // While the wall makes the new simulation the tablet cannot send it elsewhere.
    for (const name of ['week', 'finish', 'toChoose', 'toEvaluations'] as const) apply({ name });
    expect(walk()).toMatchObject({ step: 'choose', generating: true });
  });

  it('a choose pressed while another screen is on does nothing', () => {
    apply({ name: 'openEvent', id: 'E1' });
    apply({ name: 'choose', id: 'A' });
    expect(walk()).toMatchObject({ step: 'telling', paths: {} });
  });

  it('an emergency has nothing to choose: it ends back at the week, and counts as read', () => {
    apply({ name: 'openEvent', id: 'E6' });
    apply({ name: 'toEvaluations' });
    apply({ name: 'toChoose' });
    expect(walk()).toMatchObject({ step: 'week', paths: {} });
    expect(walk().read).toContain('E6@1');
  });

  it('a chosen request is "made" for a moment, then the week shows the event one version on', () => {
    toChoose('E1');
    apply({ name: 'choose', id: 'A' });
    useWeekStore.getState().endGenerating();
    expect(walk()).toMatchObject({ step: 'week', eventId: null, generating: false, paths: { E1: ['A'] } });
    // Opened again, the event is told as ver2: the scene that request made.
    apply({ name: 'openEvent', id: 'E1' });
    const event = week.events.find((e) => e.id === 'E1')!;
    expect(scenesOf(event, walk().paths.E1)).toEqual([event.requests.find((r) => r.id === 'A')!.after.scene]);
  });

  it('offers on ver2 what ver2 offers, and a version with nothing to offer sends the visitor back to the week', () => {
    reset(week);
    at({ introStarted: true, pathStarted: true });
    toChoose('E1'); apply({ name: 'choose', id: 'A' }); useWeekStore.getState().endGenerating();
    toChoose('E1');
    expect(walk().step).toBe('choose');
    apply({ name: 'choose', id: 'B' }); useWeekStore.getState().endGenerating();
    expect(walk().paths.E1).toEqual(['A', 'B']);
    toChoose('E1');
    expect(walk().step).toBe('week');
  });
});

describe('what the wall says it shows', () => {
  const state = (over: Partial<Parameters<typeof describeStage>[0]> = {}) => describeStage({
    week, introStarted: true, pathStarted: true, step: 'week', eventId: null, lineIndex: 0,
    paths: {}, ...over,
  });

  it('says idle before the walk and intro during the film, with nothing else to press', () => {
    expect(state({ introStarted: false, pathStarted: false }).phase).toBe('idle');
    expect(state({ pathStarted: false }).phase).toBe('intro');
    expect(state({ pathStarted: false }).week).toEqual([]);
  });

  it('lists the whole week for the tablet, with each event\'s version and what is an emergency', () => {
    const s = state({ paths: { E1: ['A'] } });
    expect(s.phase).toBe('week');
    expect(s.week.map((d) => d.day)).toEqual(['월', '화', '수', '목', '금', '토', '일']);
    expect(s.week.find((d) => d.day === '화')!.events).toEqual([]);
    expect(s.week.find((d) => d.day === '월')!.events[0]).toMatchObject({ id: 'E1', version: 2, noChoice: false });
    expect(s.week.flatMap((d) => d.events).find((e) => e.id === 'E3')!.version).toBe(1);
    expect(s.week.flatMap((d) => d.events).find((e) => e.id === 'E6')!.noChoice).toBe(true);
    expect(s.runs).toBe(1);
  });

  it('tells where in a telling the wall is, and says it is done only on the last line', () => {
    const event = week.events.find((e) => e.id === 'E1')!;
    const last = event.before.scenes.reduce((n, s) => n + s.lines.length, 0) - 1;
    const first = state({ step: 'telling', eventId: 'E1', lineIndex: 0 });
    expect(first).toMatchObject({ phase: 'telling', toldAll: false, line: 0, version: 1 });
    expect(first.scene).toMatchObject({ index: 0, of: event.before.scenes.length });
    expect(state({ step: 'telling', eventId: 'E1', lineIndex: last }).toldAll).toBe(true);
  });

  it('offers each request by its place in the event: the tablet shows its number, the wall shows the card', () => {
    const s = state({ step: 'choose', eventId: 'E1' });
    const event = week.events.find((e) => e.id === 'E1')!;
    expect(s.requests).toEqual(event.requests.map((r) => ({ id: r.id, label: r.label })));
  });

  it('offers an emergency no requests, and says there is nothing to choose', () => {
    expect(state({ step: 'evaluations', eventId: 'E6' }).requests).toEqual([]);
    expect(state({ step: 'evaluations', eventId: 'E6' }).event?.noChoice).toBe(true);
    expect(state({ step: 'evaluations', eventId: 'E6' }).leaf).toBe(true);
    expect(state({ step: 'evaluations', eventId: 'E1' }).leaf).toBe(false);
  });

  it('says which version is being read and what it offers: ver2 offers what that request leads to', () => {
    const E1 = week.events.find((e) => e.id === 'E1')!;
    const second = state({ step: 'choose', eventId: 'E1', paths: { E1: ['A'] } });
    expect(second.version).toBe(2);
    expect(second.requests).toEqual(E1.requests.find((r) => r.id === 'A')!.after.requests.map((r) => ({ id: r.id, label: r.label })));
    expect(second.leaf).toBe(false);
    expect(state({ step: 'choose', eventId: 'E1', paths: { E1: ['A', 'B'] } })).toMatchObject({ version: 3, leaf: true });
  });

  it('tells the scene of the version being read, not always the event\'s own', () => {
    const event = week.events.find((e) => e.id === 'E1')!;
    expect(scenesOf(event, [])).toEqual(event.before.scenes);
    expect(scenesOf(event, ['A'])).toEqual([event.requests.find((r) => r.id === 'A')!.after.scene]);
    expect(evaluationsOf(event, ['A'])).toEqual(event.requests.find((r) => r.id === 'A')!.after.evaluations);
    expect(evaluationsOf(event, [])).toEqual(event.before.evaluations);
    expect(scenesOf(event, ['Z'])).toEqual([]);
  });
});

describe('the waiting screen', () => {
  it('asks the visitor to use the tablet, and has nothing to press itself', () => {
    const { container } = render(<IdleScreen art={new Set()} />);
    expect(screen.getByAltText('Desimer')).toBeDefined();
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

describe('the rules as they stand', () => {
  it('open over a page of the walk, close when pressed again or when anything else is pressed', () => {
    apply({ name: 'rules' });
    expect(walk().rulesOpen).toBe(false); // not before the walk
    at({ introStarted: true, pathStarted: true, step: 'week' });
    apply({ name: 'rules' });
    expect(walk().rulesOpen).toBe(true);
    apply({ name: 'rules' });
    expect(walk().rulesOpen).toBe(false);
    apply({ name: 'rules' });
    apply({ name: 'openEvent', id: 'E1' });
    expect(walk()).toMatchObject({ rulesOpen: false, step: 'telling', eventId: 'E1' });
  });

  it('are not opened on the draft, which is the rules, nor on the closing', () => {
    at({ introStarted: true, pathStarted: true, step: 'draft' });
    apply({ name: 'rules' });
    expect(walk().rulesOpen).toBe(false);
    at({ step: 'closing' });
    apply({ name: 'rules' });
    expect(walk().rulesOpen).toBe(false);
  });
});
