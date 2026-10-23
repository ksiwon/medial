import { create } from 'zustand';
import { api, ApiError } from './api/client';
import type { Village, VoiceClip } from './api/types';
import bgmUrl from './assets/bgm.mp3';

// What the screens draw and play, fetched once and held in the page before the walk can start: every scene picture,
// every recorded voice, the village map and the background sound. The walk does not start until all of them are here
// (researcher, 2026-10-23: "하나라도 로딩 안된게 있으면 시작하지마") - a picture asked for only when its scene came
// up arrived late or not at all, and a voice that was not there yet left a line silent. A file that cannot be had is
// tried again, and until it is, the tablet's start button says it is still loading. The week itself is week/store.ts.

/** How many files are fetched at once. */
const AT_ONCE = 6;
/** How long to wait before trying the files that could not be had again (ms). */
const RETRY_MS = 5000;

interface AssetState {
  /** loading: still fetching, or trying again what could not be had; ready: every file is held; error: the lists
   *  themselves could not be read (the server is not there). */
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** Names of the scene pictures that exist (scripts/art.mjs). */
  art: Set<string>;
  /** The recorded voice of each spoken line, by 'speaker|text'; empty when there are none. */
  voices: Record<string, VoiceClip>;
  /** Where the places and homes are, for the scene's map column. */
  village: Village;
  /** Files held so far, of how many, and how many could not be had on the last try. */
  held: number;
  total: number;
  missing: number;
  load: () => Promise<void>;
}

function describe(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/** Runs `jobs` `AT_ONCE` at a time; returns the ones that failed. */
async function runAll(jobs: (() => Promise<void>)[], done: () => void): Promise<(() => Promise<void>)[]> {
  const failed: (() => Promise<void>)[] = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next];
      next += 1;
      try { await job(); done(); } catch { failed.push(job); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, jobs.length) }, worker));
  return failed;
}

export const useAssets = create<AssetState>((set, get) => ({
  status: 'idle',
  error: null,
  art: new Set(),
  voices: {},
  village: { available: false },
  held: 0,
  total: 0,
  missing: 0,

  load: async () => {
    // React StrictMode invokes effects twice in development.
    if (get().status !== 'idle') return;
    set({ status: 'loading', error: null });
    let art: { names: string[] };
    let voice: { lines: Record<string, VoiceClip> };
    let village: Village;
    try {
      [art, voice, village] = await Promise.all([api.art(), api.voices(), api.village()]);
    } catch (error) {
      set({ status: 'error', error: describe(error) });
      return;
    }
    const files = [...new Set(Object.values(voice.lines).map((clip) => clip.file))];
    let jobs: (() => Promise<void>)[] = [
      ...art.names.map((name) => () => api.holdArt(name)),
      ...files.map((file) => () => api.holdVoice(file)),
      ...(village.available ? [() => api.holdVillageMap()] : []),
      () => api.holdBundled(bgmUrl),
    ];
    set({ art: new Set(art.names), voices: voice.lines, village, total: jobs.length, held: 0, missing: 0 });
    const done = () => set((s) => ({ held: s.held + 1 }));
    for (;;) {
      jobs = await runAll(jobs, done);
      set({ missing: jobs.length });
      if (jobs.length === 0) break;
      await new Promise((resolve) => { window.setTimeout(resolve, RETRY_MS); });
    }
    set({ status: 'ready' });
  },
}));

/** Everything the walk plays and draws is held: the start may be pressed. */
export const assetsReady = (): boolean => useAssets.getState().status === 'ready';
