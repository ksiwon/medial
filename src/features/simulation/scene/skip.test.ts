import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import attemptFixture from '../../../../fixtures/ui/attempt.json';
import eventsFixture from '../../../../fixtures/ui/events.json';
import villageFixture from '../../../../fixtures/ui/village.json';
import type { AttemptDetail, DomainEvent, VillagePayload } from '../api/types';
import { usePlayback } from './playback';

// The two things a visitor does inside a day on the tablet: go on to the next scene, or get past the line
// that is being said. Both must land where someone speaks, never past the end of the day by accident, and
// both go on playing (a skip that left the day paused would look like the wall had stopped).

const village = villageFixture as unknown as VillagePayload;
const detail = attemptFixture as unknown as AttemptDetail;
const events = (eventsFixture as { events: DomainEvent[] }).events;

beforeEach(() => {
  // The playback store tells the server where it is (a stored cursor); there is no server here.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, cursorSeq: 0, state: {} }), { status: 200 })));
  usePlayback.setState({ playing: false, error: null });
  usePlayback.getState().load({ attemptId: detail.attempt.id, detail, events, village });
});
afterEach(() => { vi.unstubAllGlobals(); });

const state = () => usePlayback.getState();
const speaking = () => state().reel!.segments.filter((s) => s.kind === 'line' || s.kind === 'lead');

describe('skipLine', () => {
  it('goes to the next place where someone speaks, and keeps playing', async () => {
    const stops = speaking();
    expect(stops.length).toBeGreaterThan(2);
    usePlayback.setState({ rt: stops[0].r0 + 0.01, position: state().reel!.locate(stops[0].r0 + 0.01) });
    await state().skipLine();
    expect(state().rt).toBeCloseTo(stops[1].r0, 3);
    expect(state().playing).toBe(true);
  });

  it('moves forward every time it is pressed, and never back', async () => {
    let last = -1;
    for (let i = 0; i < 4; i += 1) {
      await state().skipLine();
      expect(state().rt).toBeGreaterThan(last);
      last = state().rt;
    }
  });

  it('from the last spoken line goes to the end of the day, and does not start it over', async () => {
    const reel = state().reel!;
    const lastStop = speaking().slice(-1)[0];
    usePlayback.setState({ rt: lastStop.r0 + 0.01, position: reel.locate(lastStop.r0 + 0.01) });
    await state().skipLine();
    expect(state().rt).toBeGreaterThanOrEqual(lastStop.r0);
    expect(state().rt).toBeLessThanOrEqual(reel.total);
    await state().skipLine();
    expect(state().rt).toBeLessThanOrEqual(reel.total);
  });
});

describe('skipScene', () => {
  it('goes to the start of the next scene, further than a single line, and keeps playing', async () => {
    const reel = state().reel!;
    const leads = reel.segments.filter((s) => s.kind === 'lead' && s.beat === 0);
    if (leads.length < 2) return;
    usePlayback.setState({ rt: leads[0].r0 + 0.01, position: reel.locate(leads[0].r0 + 0.01) });
    await state().skipScene();
    expect(state().rt).toBeCloseTo(leads[1].r0, 3);
    expect(state().playing).toBe(true);
  });
});
