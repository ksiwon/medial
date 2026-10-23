import { useEffect } from 'react';
import { api } from '../api/client';
import bgmUrl from '../assets/bgm.mp3';

// The exhibition's background sound: one quiet pad (scripts/make_bgm.py) looping under the whole walk,
// low enough that the voices of the scenes stay in front. Like the voices it needs the browser to allow
// sound; if it refuses, the first touch or key starts it, and the wall's browser is started with
// autoplay allowed (README, "전시장 브라우저").

const VOLUME = 0.12;
/** While the narrator speaks the pad drops to this share of its volume. */
const DUCKED = 0.4;

let bed: HTMLAudioElement | null = null;
let ducked = false;
const level = () => { if (bed) bed.volume = ducked ? VOLUME * DUCKED : VOLUME; };

/** Lowers the background sound under a narration, and lifts it again after. */
export function duckAmbient(on: boolean) {
  ducked = on;
  level();
}

export function useAmbient(ready: boolean) {
  useEffect(() => {
    if (!ready || typeof Audio === 'undefined') return undefined;
    const audio = new Audio(api.bundledUrl(bgmUrl));
    audio.dataset.source = bgmUrl;
    audio.loop = true;
    bed = audio;
    level();
    const start = () => {
      const result = audio.play() as Promise<void> | undefined;
      if (result && typeof result.catch === 'function') result.catch(() => {});
    };
    start();
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
    return () => {
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
      audio.pause();
      bed = null;
    };
  }, [ready]);
}
