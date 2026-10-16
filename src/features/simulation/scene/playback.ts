import { create } from 'zustand';
import { api, ApiError } from '../api/client';
import type { AttemptDetail, DomainEvent, ViewMode, VideoClip, VillagePayload, VoiceClip } from '../api/types';
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
const DAY_END_MS = 22 * 60 * 60 * 1000;

interface Run {
  attemptId: string;
  detail: AttemptDetail;
  events: DomainEvent[];
  village: VillagePayload;
  /** The recorded voice of each spoken line, by 'speaker|text'. */
  voices?: Record<string, VoiceClip>;
  /** The video mode's clip of each line, by 'speaker|text'; none in the picture mode. */
  videos?: Record<string, VideoClip>;
}

interface PlaybackState {
  run: Run | null;
  reel: Reel | null;
  viewMode: ViewMode;
  rt: number;
  position: Position | null;
  playing: boolean;
  error: string | null;

  load: (run: Run) => void;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  tick: (deltaMs: number) => void;
  seekSeq: (seq: number) => Promise<void>;
  /** The previous or next scene, from wherever the playhead is. */
  jumpScene: (direction: -1 | 1) => Promise<void>;
  /** To the next scene, and on playing from there (jumpScene alone stops the clock). */
  skipScene: () => Promise<void>;
  /** Past the line being said, to the next one (in the same scene, or the next scene's first), and on playing. */
  skipLine: () => Promise<void>;
  restart: () => Promise<void>;
  dismissError: () => void;
}

let commandCounter = 0;
const commandId = (name: string) => `cmd-${name}-${Date.now()}-${commandCounter++}`;
const describe = (error: unknown) =>
  error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error);

function reelFor(run: Run, viewMode: ViewMode): Reel {
  const timeline = run.detail.timeline ?? null;
  return buildReel({
    // A record that carries its scenes plays them as recorded; otherwise they
    // are read off the log.
    episodes: run.detail.scenes?.episodes
      ?? buildEpisodes({ events: run.events, timeline, village: run.village, viewMode }),
    events: run.events,
    timeline,
    dayStartMs: DAY_START_MS,
    dayEndMs: timeline?.horizonMs ?? DAY_END_MS,
    // One pace for everyone (the exhibition has no speed control), and only the
    // scenes the record says tell the story.
    pace: 1,
    featured: run.detail.scenes?.featured?.length ? new Set(run.detail.scenes.featured) : null,
    voices: run.voices ?? null,
    videos: run.videos ?? null,
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
    rt: 0,
    position: null,
    playing: false,
    error: null,

    load: (run) => {
      const reel = reelFor(run, get().viewMode);
      set({ run, reel, playing: false });
      // Reopen where the researcher left off: the cursor lives in the database.
      at(reel.atSeq(run.detail.attempt.cursorSeq ?? 0), reel);
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

    seekSeq: async (seq) => {
      const reel = get().reel;
      if (!reel) return;
      set({ playing: false });
      at(reel.atSeq(seq));
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

    skipLine: async () => {
      const { reel, position } = get();
      if (!reel || !position) return;
      const here = position.segment.r0;
      // The next stretch where someone speaks. A scene's lead-in (the picture arriving) counts as a stop too, so
      // that a line at the end of a scene goes to the next scene's start and not past it.
      const next = reel.segments.find((s) => (s.kind === 'line' || s.kind === 'lead') && s.r0 > here + 0.01);
      at(next ? next.r0 : reel.total);
      await send('seek', cursor());
      if (get().rt < reel.total - 0.01) await get().play();
    },

    skipScene: async () => {
      const current = get().reel;
      await get().jumpScene(1);
      if (current && get().rt < current.total - 0.01) await get().play();
    },

    restart: async () => {
      set({ playing: false });
      at(0);
      await send('cancel');
    },

    dismissError: () => set({ error: null }),
  };
});

