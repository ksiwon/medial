import { create } from 'zustand';
import { api, ApiError } from './api/client';
import { usePlayback } from './scene/playback';
import { learnPlaces } from './selectors/story';
import type {
  AttemptDetail,
  Catalog,
  Comparison,
  DesignFinding,
  DomainEvent,
  PersonasPayload,
  VillagePayload,
} from './api/types';

// The workspace: the village, the catalogue, and the stored runs that have been
// opened. Watching a run is the playback store's (scene/playback.ts); this one
// only loads what it plays and keeps the advanced attempt comparison.

interface Loaded {
  detail: AttemptDetail;
  events: DomainEvent[];
}

interface SimState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  notice: string | null;
  village: VillagePayload | null;
  catalog: Catalog | null;
  personas: PersonasPayload | null;
  /** Names of the scene pictures that exist for this village. */
  art: Set<string>;
  /** Recorded design findings, read-only. The manual A/B flow that created
   *  them is gone (26번 F10): one new-execution path remains. */
  findings: DesignFinding[];
  attempts: Record<string, Loaded>;
  activeId: string | null;
  compareIds: string[];
  comparison: Comparison | null;

  bootstrap: () => Promise<void>;
  setActive: (id: string) => Promise<void>;
  dismissNotice: () => void;
  toggleCompare: (id: string) => void;
  refreshComparison: () => Promise<void>;
}

function describe(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export const useSimStore = create<SimState>((set, get) => ({
  status: 'idle',
  error: null,
  notice: null,
  village: null,
  catalog: null,
  personas: null,
  art: new Set(),
  findings: [],
  attempts: {},
  activeId: null,
  compareIds: [],
  comparison: null,

  bootstrap: async () => {
    // React StrictMode invokes effects twice in development.
    if (get().status !== 'idle') return;
    set({ status: 'loading', error: null });
    try {
      const [village, catalog, personas, art] = await Promise.all([
        api.village(),
        api.catalog(),
        api.personas(),
        // Pictures are optional: without them every figure is the schematic one.
        api.art().catch(() => ({ names: [] as string[] })),
      ]);
      learnPlaces(Object.fromEntries(Object.entries(village.places).map(([k, v]) => [k, v.label])));
      set({ village, catalog, personas, art: new Set(art.names), findings: catalog.findings, status: 'ready' });
      // Loading the workspace *reads*: it never starts a run. The last stored
      // run is reopened where it was left; a record that fails to load is
      // reported and leaves the others usable.
      const last = catalog.attempts[catalog.attempts.length - 1];
      if (last) {
        try {
          await get().setActive(last.id);
          set({ compareIds: catalog.attempts.slice(-2).map((a) => a.id) });
        } catch (error) {
          set({
            notice: `마지막 시도(${last.id})를 불러오지 못했습니다: ${describe(error)}. 다른 시도는 그대로 있습니다.`,
          });
        }
      }
    } catch (error) {
      set({ status: 'error', error: describe(error) });
    }
  },

  setActive: async (id) => {
    const loaded = get().attempts[id] ?? (await load(set, id));
    const village = get().village;
    set({ activeId: id });
    if (village) usePlayback.getState().load({ attemptId: id, ...loaded, village });
  },

  dismissNotice: () => set({ notice: null }),

  toggleCompare: (id) =>
    set((state) => ({
      compareIds: state.compareIds.includes(id)
        ? state.compareIds.filter((x) => x !== id)
        : [...state.compareIds, id].slice(-3),
      comparison: null,
    })),

  refreshComparison: async () => {
    const ids = get().compareIds;
    if (ids.length < 2) {
      set({ comparison: null });
      return;
    }
    try {
      set({ comparison: await api.compare(ids) });
    } catch (error) {
      set({ error: describe(error) });
    }
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
