import { useEffect } from 'react';
import { api } from '../api/client';
import type { VoiceClip } from '../api/types';
import { duckAmbient } from '../ui/ambient';

// The voices of the exhibition. Every line of every scene, and the opening and closing narration, is spoken once
// ahead of time (scripts/tts_scenes.py) and nothing is generated while the screen runs. A line that has a
// recording plays as it appears; a line without one is read, silently, at the pace of the screen.
//
// A browser may refuse sound before anyone has touched the page. play() then rejects and the scene simply goes on
// in silence; the wall's browser is started with autoplay allowed (README, "전시장 브라우저").

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

/** The recording of a spoken line, by who said it and what: the manifest keys it 'speaker|text'. */
export const clipOf = (voices: Record<string, VoiceClip> | null | undefined, speaker: string, text: string): VoiceClip | null =>
  voices?.[`${speaker}|${text}`] ?? null;

/** Plays the recording of the line on screen, and stops it when the line goes. A line with no recording is silent. */
export function useLineVoice(voices: Record<string, VoiceClip> | null | undefined, speaker: string | null, text: string | null) {
  useEffect(() => {
    if (!speaker || !text) return undefined;
    const clip = clipOf(voices, speaker, text);
    const audio = clip ? audioOf(clip.file) : null;
    if (!audio) return undefined;
    audio.currentTime = 0;
    const result = audio.play() as Promise<void> | undefined;
    if (result && typeof result.catch === 'function') result.catch(() => {});
    return () => audio.pause();
  }, [voices, speaker, text]);
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
  clipOf(voices, 'NARRATOR', text);
