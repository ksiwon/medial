import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sessionFixture from '../../../../fixtures/ui/session.json';
import type { SessionDetail } from '../api/iteration';
import { useIterationStore } from '../iterationStore';
import { usePlayback } from '../scene/playback';
import IdleScreen from '../screens/IdleScreen';
import { askedReviews } from '../selectors/evaluations';
import { apply, describeStage } from './wall';
import { roleOf } from './protocol';

// The two screens' contract: a press from the tablet moves the wall's walk, only where it makes
// sense, and what the wall says it shows is what the tablet draws.

const session = sessionFixture as unknown as SessionDetail;
const first = session.generations.find((g) => !g.parentGenerationId) ?? session.generations[0];
const asked = askedReviews(first);

const reset = () => {
  usePlayback.setState({ playing: false });
  useIterationStore.setState({
    loaded: true, detail: session, viewGenerationId: first.id, screen: 'case', introStarted: false,
    pathStarted: false, page: 0, openActor: null, issues: false, closing: false, error: null,
  });
};
const at = (patch: Partial<ReturnType<typeof useIterationStore.getState>>) => useIterationStore.setState(patch);
const walk = () => useIterationStore.getState();

beforeEach(reset);
afterEach(cleanup);

describe('the tablet starts the walk', () => {
  it('does nothing else until it has started: no press moves a day that is not on', async () => {
    for (const name of ['skipScene', 'skipLine', 'readEvaluations', 'goImprove'] as const) {
      await apply({ name });
    }
    await apply({ name: 'evalOpen', id: asked[0]?.actorId ?? 'P1' });
    expect(walk()).toMatchObject({ introStarted: false, pathStarted: false, screen: 'case', openActor: null, closing: false });
  });

  it('start opens the film once; a second start changes nothing', async () => {
    await apply({ name: 'start' });
    expect(walk().introStarted).toBe(true);
    await apply({ name: 'start' });
    expect(walk()).toMatchObject({ introStarted: true, pathStarted: false });
  });

  it('home from anywhere goes back to the waiting screen and clears what was open', async () => {
    at({ introStarted: true, pathStarted: true, screen: 'evaluations', page: 1, openActor: 'P1', closing: true });
    await apply({ name: 'home' });
    expect(walk()).toMatchObject({ introStarted: false, pathStarted: false, screen: 'case', page: 0, openActor: null, closing: false });
  });
});

describe('the evaluations, from the tablet', () => {
  beforeEach(() => at({ introStarted: true, pathStarted: true, screen: 'evaluations' }));

  it('opens one resident\'s interview, and the same press for someone who was not asked opens nothing', async () => {
    if (asked.length === 0) return;
    await apply({ name: 'evalOpen', id: asked[0].actorId });
    expect(walk().openActor).toBe(asked[0].actorId);
    await apply({ name: 'evalOpen', id: 'P99' });
    expect(walk().openActor).toBe(asked[0].actorId);
  });

  it('closing the interview brings the cards back, and turning the page forgets the open one', async () => {
    if (asked.length === 0) return;
    await apply({ name: 'evalOpen', id: asked[0].actorId });
    await apply({ name: 'evalClose' });
    expect(walk()).toMatchObject({ openActor: null, issues: false });
    at({ page: 0 });
    await apply({ name: 'evalPage', value: -1 });
    expect(walk().page).toBe(0);
  });

  it('opens a day\'s choice only from the evaluations, and a late press from a screen that has gone is dropped', async () => {
    await apply({ name: 'goImprove' });
    expect(walk().screen).toBe('improve');
    await apply({ name: 'evalOpen', id: asked[0]?.actorId ?? 'P1' });
    expect(walk().openActor).toBeNull();
    await apply({ name: 'readEvaluations' });
    expect(walk().screen).toBe('improve');
  });
});

describe('choosing, from the tablet', () => {
  it('only a revision of this day that the record ran can be chosen', async () => {
    at({ introStarted: true, pathStarted: true, screen: 'improve' });
    const before = walk().viewGenerationId;
    await apply({ name: 'choose', id: 'no-such-version' });
    expect(walk().viewGenerationId).toBe(before);
    // a version that exists but is not a revision of this day (the first setting itself) is not offered either
    await apply({ name: 'choose', id: first.id });
    expect(walk().viewGenerationId).toBe(before);
  });

  it('a choose pressed while another screen is on does nothing', async () => {
    at({ introStarted: true, pathStarted: true, screen: 'evaluations' });
    const child = session.generations.find((g) => g.parentGenerationId === first.id);
    if (!child) return;
    await apply({ name: 'choose', id: child.id });
    expect(walk().screen).toBe('evaluations');
    expect(walk().viewGenerationId).toBe(first.id);
  });
});

describe('what the wall says it shows', () => {
  const state = (over: Partial<Parameters<typeof describeStage>[0]> = {}) => describeStage({
    detail: session, viewGenerationId: first.id, introStarted: true, pathStarted: true, screen: 'case', page: 0,
    openActor: null, issues: false, closing: false, playing: false, rt: 0, total: 100, atMs: 5 * 3_600_000,
    dayEndMs: 22 * 3_600_000, tasks: [], sceneTitle: null, events: null, eventsAttemptId: null, ...over,
  });

  it('says idle before the walk and intro during the film, with nothing else to press', () => {
    expect(state({ introStarted: false, pathStarted: false }).phase).toBe('idle');
    expect(state({ pathStarted: false }).phase).toBe('intro');
    expect(state({ pathStarted: false }).residents).toEqual([]);
  });

  it('follows the screen of the walk, and says a day is over only when the reel has run out', () => {
    expect(state().phase).toBe('day');
    expect(state({ rt: 40 }).dayOver).toBe(false);
    expect(state({ rt: 100 }).dayOver).toBe(true);
    expect(state({ screen: 'evaluations' }).phase).toBe('evaluations');
    expect(state({ screen: 'improve' }).phase).toBe(first.changeSets.length === 0 ? 'ending' : 'choose');
  });

  it('lists every resident who was asked, and only the one who is open as open', () => {
    if (asked.length === 0) return;
    const s = state({ screen: 'evaluations', openActor: asked[0].actorId });
    expect(s.residents.map((r) => r.id)).toEqual(asked.map((r) => r.actorId));
    expect(s.openActor).toBe(asked[0].actorId);
    expect(state({ screen: 'evaluations', openActor: 'P99' }).openActor).toBeNull();
  });

  it('offers each revision with the rule before and after, and marks the one that was never run', () => {
    const s = state({ screen: 'improve' });
    expect(s.choices).toHaveLength(first.changeSets.length);
    for (const c of s.choices) expect(c.rule === null || (c.rule.before !== '' || c.rule.after !== '')).toBe(true);
  });
});

describe('the waiting screen', () => {
  it('asks the visitor to use the tablet, and has nothing to press itself', () => {
    const { container } = render(<IdleScreen art={new Set()} />);
    expect(screen.getByText('MEDial')).toBeDefined();
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



