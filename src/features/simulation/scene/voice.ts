import { useEffect, useRef } from 'react';
import { api } from '../api/client';
import type { VideoClip, VoiceClip } from '../api/types';
import { duckAmbient } from '../ui/ambient';
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

/**
 * The video mode (3안) is a switch in the address, `?video=1`: the lines that have a clip play as video and every
 * other line stays a picture. Without it the screen is the picture mode, whether or not clips exist.
 */
export const videoMode = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('video') === '1';

/** Fetch every clip now (the browser keeps it by address), so a line's video does not start from black. */
export function preloadVideos(clips: Record<string, VideoClip>) {
  if (typeof document === 'undefined') return;
  for (const file of new Set(Object.values(clips).map((c) => c.file))) {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.src = api.videoUrl(file);
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

/**
 * Plays one narration clip (the opening film's and the closing page's big captions) and keeps the background
 * pad low under it. Returns what stops it: the film skipped or left, the page gone.
 */
export function playNarration(file: string): () => void {
  const audio = audioOf(file);
  if (!audio) return () => {};
  audio.currentTime = 0;
  duckAmbient(true);
  const done = () => duckAmbient(false);
  audio.addEventListener('ended', done, { once: true });
  const result = audio.play() as Promise<void> | undefined;
  if (result && typeof result.catch === 'function') result.catch(done);
  return () => { audio.removeEventListener('ended', done); audio.pause(); done(); };
}

/** The clip of a narrator's line, by its text (the manifest keys it 'NARRATOR|text'). */
export const narrationOf = (voices: Record<string, VoiceClip> | null | undefined, text: string): VoiceClip | null =>
  voices?.[`NARRATOR|${text}`] ?? null;
