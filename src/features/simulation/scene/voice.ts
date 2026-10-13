import { useEffect, useRef } from 'react';
import { api } from '../api/client';
import type { VoiceClip } from '../api/types';
import type { Position } from './types';

// The voices of the scenes. Every said line of a played scene was spoken once ahead of time
// (scripts/tts_scenes.py) and nothing is generated while the screen runs. A line that has a
// recording is paced by it (reel.ts: its length is the clip's) and plays when its "typing" dots
// are done; a line without one is read, silently, as before.
//
// A browser may refuse sound before anyone has touched the page. play() then rejects and the
// scene simply goes on in silence; the wall's browser is started with autoplay allowed
// (README, "전시장 브라우저").

const pool = new Map<string, HTMLAudioElement>();

/** Fetch every recording now, so a line never waits for its sound to arrive. */
export function preloadVoices(clips: Record<string, VoiceClip>) {
  if (typeof Audio === 'undefined') return;
  for (const { file } of Object.values(clips)) {
    if (pool.has(file)) continue;
    const audio = new Audio(api.voiceUrl(file));
    audio.preload = 'auto';
    pool.set(file, audio);
  }
}

const audioOf = (file: string) => {
  let audio = pool.get(file);
  if (!audio && typeof Audio !== 'undefined') {
    audio = new Audio(api.voiceUrl(file));
    pool.set(file, audio);
  }
  return audio ?? null;
};

/** Plays the recording of the line under the playhead while the day is playing, and stops it when it stops. */
export function useLineVoice(position: Position | null, playing: boolean) {
  const current = useRef<HTMLAudioElement | null>(null);
  const lastIndex = useRef<number | null>(null);
  const segment = position?.segment ?? null;
  const file = segment?.kind === 'line' ? segment.audio ?? null : null;
  const started = segment?.kind === 'line' && position !== null && position.offset >= segment.typing;
  const index = position?.index ?? null;

  useEffect(() => {
    if (!playing || !file || !started) {
      current.current?.pause();
      return;
    }
    const audio = audioOf(file);
    if (!audio) return;
    if (current.current !== audio) current.current?.pause();
    // A new line starts from its beginning; the same line resumed after a pause goes on from where it stopped.
    if (lastIndex.current !== index) audio.currentTime = 0;
    lastIndex.current = index;
    current.current = audio;
    const result = audio.play() as Promise<void> | undefined;
    if (result && typeof result.catch === 'function') result.catch(() => {});
  }, [playing, file, started, index]);

  useEffect(() => () => current.current?.pause(), []);
}
