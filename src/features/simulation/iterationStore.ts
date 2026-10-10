import { create } from 'zustand';
import { api, ApiError } from './api/client';
import type { SessionDetail } from './api/iteration';
import { usePlayback } from './scene/playback';
import { useSimStore } from './store';

// The walk through a stored record, as the exhibition wall has it: a first
// setting, the day it ran, the residents' evaluations, the revisions to choose
// from, the next day. Every day shown was run when the record was made, so
// nothing here starts a run: choosing opens a day that already happened.
//
// A separate store from the attempt/replay one (store.ts, scene/playback.ts).
// They share the map and the event log; this one holds which session is read,
// which version of it, and where in the walk the reader is.

/**
 * What to show a person when a call failed.
 *
 * The server's own refusals already say which condition was refused, in Korean,
 * and those must pass through untouched. What must not reach the screen is a
 * transport failure's stock English: with the server down, the dev proxy answers
 * "Internal Server Error", which tells the reader nothing they can act on.
 */
function describe(error: unknown): string {
  const unreachable =
    '연구 서버가 응답하지 않습니다. 서버(python server/sim_main.py)가 떠 있는지 확인한 뒤 다시 시작하세요.';
  if (error instanceof ApiError) {
    const stock = /^(internal server error|bad gateway|service unavailable|gateway timeout|not found)$/i;
    if (error.status >= 500 && stock.test(error.message.trim())) {
      return `${unreachable} (HTTP ${error.status})`;
    }
    return error.message;
  }
  // fetch() rejects with a TypeError when it cannot reach the host at all.
  if (error instanceof TypeError) return unreachable;
  return error instanceof Error ? error.message : String(error);
}

/** The screens of the walk (doc 19 section 9): the day, its evaluations, and the
 *  revision to choose. */
export type Screen = 'case' | 'evaluations' | 'improve';

interface IterationState {
  /** False until the server has been asked for a session, so "no record" is not
   *  shown while it is still loading. */
  loaded: boolean;
  detail: SessionDetail | null;
  /** The version whose day is being read. */
  viewGenerationId: string | null;
  screen: Screen;
  /** Whether the opening film is over and a day has been walked into. */
  pathStarted: boolean;
  error: string | null;

  /** Open the newest stored session. A read: it starts nothing. */
  init: () => Promise<void>;
  setScreen: (screen: Screen) => void;
  setViewGeneration: (id: string) => void;
  /** Walk to this version: its day opens from 05:00 and plays. */
  choose: (generationId: string) => Promise<void>;
  /** Back to the opening film. */
  restartPath: () => void;
  /** Open the scene an evaluation cites: switch to that attempt and seek to the
   *  event. A read of a stored log; no adapter runs. */
  openScene: (attemptId: string, eventId: string) => Promise<void>;
}

export const useIterationStore = create<IterationState>((set, get) => ({
  loaded: false,
  detail: null,
  viewGenerationId: null,
  screen: 'case',
  pathStarted: false,
  error: null,

  init: async () => {
    if (get().loaded) return;
    try {
      const { sessions } = await api.iteration.sessions();
      const newest = [...sessions].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).pop();
      if (newest) {
        const detail = await api.iteration.detail(newest.id);
        set({ detail, viewGenerationId: detail.generations[0]?.id ?? null });
      }
      set({ loaded: true });
    } catch (error) {
      set({ loaded: true, error: describe(error) });
    }
  },

  setScreen: (screen) => set({ screen }),
  setViewGeneration: (viewGenerationId) => set({ viewGenerationId }),

  choose: async (generationId) => {
    const attemptId = get().detail?.generations.find((g) => g.id === generationId)?.attemptIds[0];
    if (!attemptId) return;
    set({ viewGenerationId: generationId, pathStarted: true, screen: 'case' });
    await useSimStore.getState().setActive(attemptId);
    const playback = usePlayback.getState();
    await playback.restart();
    await playback.play();
  },

  restartPath: () => {
    void usePlayback.getState().pause();
    set({ pathStarted: false, screen: 'case' });
  },

  openScene: async (attemptId, eventId) => {
    try {
      await useSimStore.getState().setActive(attemptId);
      const event = useSimStore.getState().attempts[attemptId]?.events.find((e) => e.id === eventId);
      if (!event) {
        set({ error: `이 시도의 로그에서 사건 ${eventId} 을(를) 찾지 못했습니다.` });
        return;
      }
      await usePlayback.getState().seekSeq(event.seq);
      set({ screen: 'case' });
    } catch (error) {
      set({ error: describe(error) });
    }
  },
}));
