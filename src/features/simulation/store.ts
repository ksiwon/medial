import { create } from 'zustand';
import { api, ApiError } from './api/client';
import { usePlayback } from './scene/playback';
import { learnPeople, learnPlaces } from './selectors/story';
import type { AttemptDetail, DomainEvent, VillagePayload } from './api/types';

// The workspace: the village, and the stored runs that have been opened. Watching
// a run is the playback store's (scene/playback.ts); this one only loads what it
// plays. Loading it reads: it never starts a run.

interface Loaded {
  detail: AttemptDetail;
  events: DomainEvent[];
}

interface SimState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  village: VillagePayload | null;
  /** Names of the scene pictures that exist for this village. */
  art: Set<string>;
  attempts: Record<string, Loaded>;
  activeId: string | null;

  bootstrap: () => Promise<void>;
  setActive: (id: string) => Promise<void>;
  /** Read a stored run into the cache without opening it: the opening film's
   *  time is the time to fetch day one, so day one plays the moment the film ends. */
  prefetch: (id: string) => Promise<void>;
}

function describe(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export const useSimStore = create<SimState>((set, get) => ({
  status: 'idle',
  error: null,
  village: null,
  art: new Set(),
  attempts: {},
  activeId: null,

  bootstrap: async () => {
    // React StrictMode invokes effects twice in development.
    if (get().status !== 'idle') return;
    set({ status: 'loading', error: null });
    try {
      const [village, art] = await Promise.all([
        api.village(),
        // Pictures are optional: without them every figure is the schematic one.
        api.art().catch(() => ({ names: [] as string[] })),
      ]);
      learnPlaces(Object.fromEntries(Object.entries(village.places).map(([k, v]) => [k, v.label])));
      set({ village, art: new Set(art.names), status: 'ready' });
    } catch (error) {
      set({ status: 'error', error: describe(error) });
    }
  },

  setActive: async (id) => {
    const loaded = get().attempts[id] ?? (await load(set, id));
    const village = get().village;
    // Whose names the lines use: only a record that carries them sets any.
    learnPeople(loaded.detail.scenes?.people);
    set({ activeId: id });
    if (village) usePlayback.getState().load({ attemptId: id, ...loaded, village });
  },

  prefetch: async (id) => {
    if (get().attempts[id]) return;
    try { await load(set, id); } catch { /* setActive reads it again and says why */ }
  },
}));

async function load(
  set: (partial: (s: SimState) => Partial<SimState>) => void,
  id: string,
): Promise<Loaded> {
  const [detail, { events }] = await Promise.all([api.attempt(id), api.events(id)]);
  const loaded: Loaded = { detail, events };
  set((state) => ({ attempts: { ...state.attempts, [id]: loaded } }));
  return loaded;
}
