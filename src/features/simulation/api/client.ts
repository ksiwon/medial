import type { Week } from '../week/types';
import type { Village, VoiceClip } from './types';

// What the screens read from the local API. Every call here is a read of something written and checked before
// the exhibition. Nothing starts a run.

const BASE = '/api/sim';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** FastAPI puts the message in ``detail``; showing the raw JSON envelope instead would hide exactly the sentence
 *  that says which condition was refused. */
function readDetail(body: string, fallback: string): string {
  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    if (typeof parsed.detail === 'string') return parsed.detail;
  } catch {
    /* not JSON; fall through to the raw text */
  }
  return body || fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    // A dead server is a tooling problem, never a simulation result.
    throw new ApiError('시뮬레이션 서버에 연결하지 못했습니다 (python server/sim_main.py)', 0);
  }
  if (!response.ok) {
    throw new ApiError(readDetail(await response.text(), response.statusText), response.status);
  }
  return (await response.json()) as T;
}

/** Recordings and pictures are renumbered and redrawn between runs under the same names; a browser that kept one by its date
 *  would show the old picture or play the old voice. A new address for every page load asks again. */
const LOADED_AT = Date.now();

/** Every picture and recording the walk uses, once fetched (assets.ts holds them all before the walk can start): the
 *  server address -> an address of the copy in this page. A scene then never waits on the network for a picture or a
 *  voice - a picture asked for only when its scene came up arrived late, or not before the scene was over (2026-10-23). */
const held = new Map<string, string>();
const served = (url: string): string => held.get(url) ?? url;
/** The other way round: which server file a held copy is (the recording tool reads it off the sound elements). */
const source = new Map<string, string>();

/** Fetch `url` and keep it in the page. Throws if it cannot be had: a missing file stops the start, it is never skipped. */
async function hold(url: string): Promise<void> {
  if (held.has(url)) return;
  const response = await fetch(url);
  if (!response.ok) throw new ApiError(`${response.status} ${url}`, response.status);
  const copy = URL.createObjectURL(await response.blob());
  held.set(url, copy);
  source.set(copy, url);
}

const artAt = (name: string) => `${BASE}/village/art/${encodeURIComponent(name)}?t=${LOADED_AT}`;
const voiceAt = (file: string) => `${BASE}/village/voice/${encodeURIComponent(file)}?t=${LOADED_AT}`;
const mapAt = () => `${BASE}/village/map.png`;

export const api = {
  /** The week the exhibition reads: events, scenes, evaluations, requests - joined and checked on the server. */
  week: () => request<Week>('/week'),
  /** Scene pictures (scripts/art.mjs → local-data/art/): served locally, never bundled. */
  art: () => request<{ names: string[] }>('/village/art'),
  artUrl: (name: string) => served(artAt(name)),
  holdArt: (name: string) => hold(artAt(name)),
  /** The village map (local-data/normalized/, git-ignored): places, homes and the source raster, never bundled. */
  village: () => request<Village>('/village/map'),
  villageMapUrl: () => served(mapAt()),
  holdVillageMap: () => hold(mapAt()),
  /** The spoken lines (scripts/tts_scenes.py → local-data/audio/), keyed 'speaker|text'. */
  voices: () => request<{ lines: Record<string, VoiceClip> }>('/village/voice'),
  voiceUrl: (file: string) => served(voiceAt(file)),
  holdVoice: (file: string) => hold(voiceAt(file)),
  /** A file bundled with the page (the background sound), held like the rest. */
  bundledUrl: (url: string) => served(url),
  /** The server address a (held) address stands for: a sound element carries it as `data-source`, so a recording of
   *  the wall can tell which file played (scripts/record_walk.cjs). */
  sourceOf: (url: string) => source.get(url) ?? url,
  holdBundled: (url: string) => hold(url),
};
