import type { Week } from '../week/types';
import type { VoiceClip } from './types';

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

export const api = {
  /** The week the exhibition reads: events, scenes, evaluations, requests - joined and checked on the server. */
  week: () => request<Week>('/week'),
  /** Scene pictures (scripts/art.mjs → local-data/art/): served locally, never bundled. */
  art: () => request<{ names: string[] }>('/village/art'),
  artUrl: (name: string) => `${BASE}/village/art/${encodeURIComponent(name)}`,
  /** The spoken lines (scripts/tts_scenes.py → local-data/audio/), keyed 'speaker|text'. */
  voices: () => request<{ lines: Record<string, VoiceClip> }>('/village/voice'),
  voiceUrl: (file: string) => `${BASE}/village/voice/${encodeURIComponent(file)}`,
};
