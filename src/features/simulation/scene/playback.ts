import { create } from 'zustand';
import { api, ApiError } from '../api/client';
import type { AttemptDetail, DomainEvent, ViewMode, VillagePayload } from '../api/types';
import { buildEpisodes } from './beats';
import { buildReel, type Reel } from './reel';
import type { Position } from './types';

// Playback of one stored run.
//
// The playhead `rt` is real seconds into the reel (reel.ts); the clock and the
// replay cursor are read off it. The cursor is still what the server stores -
// play, pause and seek are recorded commands on the attempt, and a reload lands
// on the same event - but it is no longer what drives the screen: a scene's
// lines have to be readable, which a cursor stepping through events cannot pace.
// Nothing here runs the simulation; the server said so (`replayOnly`).

/** The village day runs 05:00-22:00, as in the source diorama. */
export const DAY_START_MS = 5 * 60 * 60 * 1000;
export const DAY_END_MS = 22 * 60 * 60 * 1000;

interface Run {
  attemptId: string;
  detail: AttemptDetail;
  events: DomainEvent[];
  village: VillagePayload;
}

interface PlaybackState {
  run: Run | null;
  reel: Reel | null;
  viewMode: ViewMode;
  /** Multiplies how long lines stay up; see PACES in reel.ts. */
  pace: number;
  rt: number;
  position: Position | null;
  playing: boolean;
  error: string | null;
  /** The map's open card: which marker, and which person in it. */
  selectedCluster: string | null;
  selectedActor: string | null;

  load: (run: Run) => void;
  setViewMode: (mode: ViewMode) => void;
  setPace: (pace: number) => void;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  tick: (deltaMs: number) => void;
  /** Move without recording; `commit` records where it stopped. */
  seekTime: (ms: number) => void;
  seekSeq: (seq: number) => Promise<void>;
  commit: () => Promise<void>;
  /** The previous or next scene, from wherever the playhead is. */
  jumpScene: (direction: -1 | 1) => Promise<void>;
  restart: () => Promise<void>;
  selectCluster: (key: string | null, actorId?: string | null) => void;
  dismissError: () => void;
}

let commandCounter = 0;
const commandId = (name: string) => `cmd-${name}-${Date.now()}-${commandCounter++}`;
const describe = (error: unknown) =>
  error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error);

function reelFor(run: Run, viewMode: ViewMode, pace: number): Reel {
  const timeline = run.detail.timeline ?? null;
  return buildReel({
    episodes: buildEpisodes({ events: run.events, timeline, village: run.village, viewMode }),
    events: run.events,
    timeline,
    dayStartMs: DAY_START_MS,
    dayEndMs: timeline?.horizonMs ?? DAY_END_MS,
    pace,
  });
}

export const usePlayback = create<PlaybackState>((set, get) => {
  /** Put the playhead somewhere and derive everything else from it. */
  const at = (rt: number, reel = get().reel) => {
    if (!reel) return;
    const t = Math.max(0, Math.min(reel.total, rt));
    set({ rt: t, position: reel.locate(t) });
  };
  const send = async (name: 'play' | 'pause' | 'seek' | 'cancel', seq?: number) => {
    const run = get().run;
    if (!run) return null;
    try {
      return await api.command(run.attemptId, commandId(name), name, seq);
    } catch (error) {
      set({ error: describe(error), playing: false });
      return null;
    }
  };
  const cursor = () => get().position?.cursorSeq ?? 0;

  return {
    run: null,
    reel: null,
    viewMode: 'researcher',
    pace: 1,
    rt: 0,
    position: null,
    playing: false,
    error: null,
    selectedCluster: null,
    selectedActor: null,

    load: (run) => {
      const reel = reelFor(run, get().viewMode, get().pace);
      set({ run, reel, playing: false, selectedCluster: null, selectedActor: null });
      // Reopen where the researcher left off: the cursor lives in the database.
      at(reel.atSeq(run.detail.attempt.cursorSeq ?? 0), reel);
    },

    setViewMode: (viewMode) => {
      const { run, pace } = get();
      if (!run) return set({ viewMode });
      const seq = cursor();
      const reel = reelFor(run, viewMode, pace);
      set({ viewMode, reel, selectedCluster: null });
      at(reel.atSeq(seq), reel);
    },

    setPace: (pace) => {
      const { run, viewMode, position } = get();
      if (!run || !position) return set({ pace });
      // Same layout, other durations: keep the segment and how far into it.
      const reel = reelFor(run, viewMode, pace);
      const share = position.segment.dur ? position.offset / position.segment.dur : 0;
      const segment = reel.segments[position.index];
      set({ pace, reel });
      at(segment ? segment.r0 + segment.dur * share : 0, reel);
    },

    play: async () => {
      const reel = get().reel;
      if (!reel) return;
      if (get().rt >= reel.total) at(0);
      set({ playing: true });
      await send('play');
    },

    pause: async () => {
      set({ playing: false });
      if (await send('seek', cursor())) await send('pause');
    },

    tick: (deltaMs) => {
      const { playing, reel, rt } = get();
      if (!playing || !reel) return;
      at(rt + deltaMs / 1000);
      if (get().rt >= reel.total) void get().pause();
    },

    seekTime: (ms) => {
      const reel = get().reel;
      if (!reel) return;
      set({ playing: false });
      at(reel.atTime(ms));
    },

    seekSeq: async (seq) => {
      const reel = get().reel;
      if (!reel) return;
      set({ playing: false });
      at(reel.atSeq(seq));
      await send('seek', cursor());
    },

    commit: async () => {
      await send('seek', cursor());
    },

    jumpScene: async (direction) => {
      const { reel, position } = get();
      if (!reel || !position) return;
      const leads = reel.segments.filter((s) => s.kind === 'lead' && s.beat === 0);
      const here = position.segment.r0;
      const target = direction > 0
        ? leads.find((s) => s.r0 > here)
        : [...leads].reverse().find((s) => s.r0 < here - 0.01);
      set({ playing: false });
      at(target ? target.r0 : direction > 0 ? reel.total : 0);
      await send('seek', cursor());
    },

    restart: async () => {
      set({ playing: false });
      at(0);
      await send('cancel');
    },

    selectCluster: (key, actorId = null) => set({ selectedCluster: key, selectedActor: actorId }),
    dismissError: () => set({ error: null }),
  };
});

/** Events the current view may show, up to the cursor. MEDial's view keeps only
 *  what was addressed to it. */
export function visibleEvents(events: DomainEvent[], cursorSeq: number, viewMode: ViewMode): DomainEvent[] {
  return events.filter(
    (event) => event.seq <= cursorSeq && (viewMode === 'researcher' || event.visibility.includes('MEDial')),
  );
}
