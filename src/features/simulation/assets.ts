import { create } from 'zustand';
import { api, ApiError } from './api/client';
import type { Village, VoiceClip } from './api/types';
import { preloadVoices } from './scene/voice';

// What the screens draw and play, fetched once: the scene pictures that exist, the recorded voices and the village
// map. All are optional - a figure without a picture is the schematic one, a line without a recording is paced
// by reading time and silent, a missing map says so - so a missing set is never an error. The week itself is
// week/store.ts.

interface AssetState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** Names of the scene pictures that exist (scripts/art.mjs). */
  art: Set<string>;
  /** The recorded voice of each spoken line, by 'speaker|text'; empty when there are none. */
  voices: Record<string, VoiceClip>;
  /** Where the places and homes are, for the scene's map column. */
  village: Village;
  load: () => Promise<void>;
}

function describe(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export const useAssets = create<AssetState>((set, get) => ({
  status: 'idle',
  error: null,
  art: new Set(),
  voices: {},
  village: { available: false },

  load: async () => {
    // React StrictMode invokes effects twice in development.
    if (get().status !== 'idle') return;
    set({ status: 'loading', error: null });
    try {
      const [art, voice, village] = await Promise.all([
        api.art().catch(() => ({ names: [] as string[] })),
        api.voices().catch(() => ({ lines: {} as Record<string, VoiceClip> })),
        api.village().catch((): Village => ({ available: false })),
      ]);
      preloadVoices(voice.lines);
      set({ art: new Set(art.names), voices: voice.lines, village, status: 'ready' });
    } catch (error) {
      set({ status: 'error', error: describe(error) });
    }
  },
}));
