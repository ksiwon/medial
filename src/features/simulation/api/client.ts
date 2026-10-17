import type { IterationSession, SessionDetail } from './iteration';
import type { Week } from '../week/types';
import type { AttemptDetail, CommandResult, DomainEvent, VideoClip, VillagePayload, VoiceClip } from './types';

// What the screens read from the local API. Every call here is a read of a
// stored record - except `command`, which moves a stored attempt's playhead
// (play, pause, seek). Nothing starts a run.

const BASE = '/api/sim';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** FastAPI puts the message in ``detail``; showing the raw JSON envelope instead
 *  would hide exactly the sentence that says which condition was refused. */
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
  village: () => request<VillagePayload>('/village'),
  /** The week the exhibition reads: events, scenes, evaluations, requests - joined and checked on the server. */
  week: () => request<Week>('/week'),
  /** The raster is served by the local API from the git-ignored registry, so it
   *  is never part of the built bundle. */
  mapImageUrl: () => `${BASE}/village/map`,
  /** Scene pictures (scripts/art.mjs → local-data/art/), same arrangement as
   *  the map: served locally, never bundled. Empty for a synthetic village. */
  art: () => request<{ names: string[] }>('/village/art'),
  artUrl: (name: string) => `${BASE}/village/art/${encodeURIComponent(name)}`,
  /** The spoken lines (scripts/tts_scenes.py → local-data/audio/), keyed 'speaker|text'. */
  voices: () => request<{ lines: Record<string, VoiceClip> }>('/village/voice'),
  voiceUrl: (file: string) => `${BASE}/village/voice/${encodeURIComponent(file)}`,
  /** The video mode's clips (scripts/video3_manifest.py → local-data/video/clips/), keyed 'speaker|text'. */
  videos: () => request<{ lines: Record<string, VideoClip> }>('/village/video'),
  videoUrl: (file: string) => `${BASE}/village/video/${encodeURIComponent(file)}`,

  attempt: (id: string) => request<AttemptDetail>(`/attempts/${id}`),
  events: (id: string, after = 0) =>
    request<{ events: DomainEvent[] }>(`/attempts/${id}/events?after=${after}`),
  command: (id: string, commandId: string, name: string, seq?: number) =>
    request<CommandResult>(`/attempts/${id}/commands`, {
      method: 'POST',
      body: JSON.stringify({ commandId, name, seq }),
    }),

  iteration: {
    sessions: () => request<{ sessions: IterationSession[] }>('/iteration/sessions'),
    detail: (id: string) => request<SessionDetail>(`/iteration/sessions/${id}`),
  },
};
