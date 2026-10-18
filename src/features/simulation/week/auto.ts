import { useEffect, useRef, useState } from 'react';

// The wall goes on by itself when nobody presses, and comes back to the start when the visitor has gone.
//
// In a hall a visitor walks off mid-way, and the next one must not find the end of someone else's story. So every
// page that waits has a clock, said on the page ("N초 뒤 …"), and any press on the tablet starts it over: someone
// is still there. The lengths are v3's where v3 had the page (an observation's end 5 s, the evaluations 15 s, the
// closing 90 s - the researcher kept them, 2026-10-16), and new where the page is new. Nothing here chooses for the
// visitor: the request page never goes on by itself, it only gives up to the closing when nobody is left.

export const AUTO_S = {
  /** After a telling's last line has been read. */
  told: 8,
  /** The residents' words, as a list. */
  evaluations: 15,
  /** One resident's card, opened from the tablet: then back to the list. */
  resident: 30,
  /** What came of the chosen request: the before and after side by side. */
  result: 30,
  /** The week or the request page with nobody pressing: the visitor has gone. */
  away: 90,
  /** The closing page's list of what was changed, before the closing words. */
  summary: 15,
  /** The closing words, before the start again. */
  closing: 90,
} as const;

export type AutoAction = 'toEvaluations' | 'toResult' | 'toChoose' | 'closeResident' | 'week' | 'finish' | 'closingWords' | 'home';

export interface Auto {
  /** What changes when it runs out; a new key starts the clock over. */
  key: string;
  seconds: number;
  action: AutoAction;
  /** Said on the page: "N초 뒤 {say}". */
  say: string;
}

export interface AutoState {
  pathStarted: boolean;
  step: string;
  eventId: string | null;
  openActor: string | null;
  /** The telling's last line is on screen. */
  toldAll: boolean;
  noChoice: boolean;
  seen: number;
  closingWords: boolean;
  lastPress: number;
}

/** The clock the page is on, or null for a page that waits for no one (the film, a telling still being told). */
export function autoOf(s: AutoState): Auto | null {
  if (!s.pathStarted) return null;
  const key = (what: string) => `${what}:${s.eventId ?? ''}:${s.openActor ?? ''}:${s.lastPress}`;
  switch (s.step) {
    case 'before':
      return s.toldAll ? { key: key('told'), seconds: AUTO_S.told, action: 'toEvaluations', say: '주민 평가로 넘어갑니다' } : null;
    case 'after':
      return s.toldAll ? { key: key('told'), seconds: AUTO_S.told, action: 'toResult', say: '반영된 평가로 넘어갑니다' } : null;
    case 'evaluations':
      if (s.openActor) return { key: key('resident'), seconds: AUTO_S.resident, action: 'closeResident', say: '목록으로 돌아갑니다' };
      return { key: key('evaluations'), seconds: AUTO_S.evaluations, action: 'toChoose', say: s.noChoice ? '정리로 넘어갑니다' : '수정 요청 고르기로 넘어갑니다' };
    case 'result':
      if (s.openActor) return { key: key('resident'), seconds: AUTO_S.resident, action: 'closeResident', say: '목록으로 돌아갑니다' };
      return { key: key('result'), seconds: AUTO_S.result, action: 'week', say: '이번 주로 돌아갑니다' };
    case 'week':
    case 'choose':
      // Nobody seen anything yet: there is nothing to close, so the start comes back at once.
      return s.seen > 0
        ? { key: key(`away-${s.step}`), seconds: AUTO_S.away, action: 'finish', say: '아무도 누르지 않으면 마무리합니다' }
        : { key: key(`away-${s.step}`), seconds: AUTO_S.away, action: 'home', say: '아무도 누르지 않으면 처음으로 돌아갑니다' };
    case 'closing':
      return s.closingWords || s.seen === 0
        ? { key: key('closing'), seconds: AUTO_S.closing, action: 'home', say: '처음으로 돌아갑니다' }
        : { key: key('summary'), seconds: AUTO_S.summary, action: 'closingWords', say: '마무리 말로 넘어갑니다' };
    default:
      return null;
  }
}

/** Counts a clock down, one second at a time, and runs it out once. A new key starts over. Returns the seconds left. */
export function useCountdown(auto: Auto | null, run: (action: AutoAction) => void): number | null {
  const [left, setLeft] = useState<number | null>(auto?.seconds ?? null);
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (!auto) { setLeft(null); return undefined; }
    let n = auto.seconds;
    setLeft(n);
    const tick = window.setInterval(() => {
      n -= 1;
      setLeft(n);
      if (n <= 0) { window.clearInterval(tick); runRef.current(auto.action); }
    }, 1000);
    return () => window.clearInterval(tick);
  }, [auto?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return left;
}
