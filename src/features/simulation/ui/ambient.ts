import { useEffect } from 'react';
import bgmUrl from '../assets/bgm.mp3';

// The exhibition's background sound: one quiet pad (scripts/make_bgm.py) looping under the whole walk,
// low enough that the voices of the scenes stay in front. Like the voices it needs the browser to allow
// sound; if it refuses, the first touch or key starts it, and the wall's browser is started with
// autoplay allowed (README, "전시장 브라우저").

const VOLUME = 0.12;

export function useAmbient() {
  useEffect(() => {
    if (typeof Audio === 'undefined') return undefined;
    const audio = new Audio(bgmUrl);
    audio.loop = true;
    audio.volume = VOLUME;
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
    };
  }, []);
}
