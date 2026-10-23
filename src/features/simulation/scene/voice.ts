import { useEffect } from 'react';
import { api } from '../api/client';
import type { VoiceClip } from '../api/types';
import { duckAmbient } from '../ui/ambient';

// The voices of the exhibition. Every line of every scene, and the opening and closing narration, is spoken once
// ahead of time (scripts/tts_scenes.py) and nothing is generated while the screen runs. A line that has a
// recording plays as it appears; a line without one is read, silently, at the pace of the screen.
//
// Every recording is held in the page before the walk can start (assets.ts), so a line never waits for its sound.
//
// A browser may refuse sound before anyone has touched the page. play() then rejects and the scene simply goes on
// in silence; the wall's browser is started with autoplay allowed (README, "전시장 브라우저").

const pool = new Map<string, HTMLAudioElement>();

const audioOf = (file: string) => {
  let audio = pool.get(file);
  if (!audio && typeof Audio !== 'undefined') {
    audio = new Audio(api.voiceUrl(file));
    audio.dataset.source = api.sourceOf(audio.src);
    pool.set(file, audio);
  }
  return audio ?? null;
};

/** The recording of a spoken line, by who said it and what: the manifest keys it 'speaker|text'. */
export const clipOf = (voices: Record<string, VoiceClip> | null | undefined, speaker: string, text: string): VoiceClip | null =>
  voices?.[`${speaker}|${text}`] ?? null;

/** The beat between one speaker finishing and the next line coming up: long enough that nobody answers on top of the
 *  last word, short enough that a scene sounds like people talking. */
const TURN_GAP_S = 0.5;
/** A line is never gone faster than it can be read, however short its recording ("네."). */
const MIN_LINE_MS = 1600;

/** How long a line stays on screen: its recording and a breath after it, so the lines follow each other the way a
 *  conversation does (an earlier fixed pace of 4.5 s left 2-3 s of silence after every short line). A line with no
 *  recording is held for the screen's pace, and a recording is never cut short by it. */
export function lineMs(voices: Record<string, VoiceClip> | null | undefined, speaker: string, text: string, pace: number): number {
  const clip = clipOf(voices, speaker, text);
  return clip ? Math.max(MIN_LINE_MS, Math.round((clip.seconds + TURN_GAP_S) * 1000)) : pace;
}

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
