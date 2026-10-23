import { useEffect, useRef, useState } from 'react';

// The wall goes on by itself when nobody presses, and comes back to the start when the visitor has gone.
//
// In a hall a visitor walks off mid-way, and the next one must not find the end of someone else's story. So every
// page that waits has a clock, said on the page ("N초 뒤 …"), and any press on the tablet starts it over: someone
// is still there. The lengths are v3's where v3 had the page (an observation's end 5 s, the evaluations 15 s, the
// closing 90 s - the researcher kept them, 2026-10-16), and new where the page is new. Nothing here chooses for the
// visitor: the request page never goes on by itself, it only gives up to the closing when nobody is left.

export const AUTO_S = {
  /** The draft the designer brought, before the week. */
  draft: 25,
  /** After a telling's last line has been read. */
  told: 8,
  /** The residents' words, as a list. */
  evaluations: 15,
  /** The week or the request page with nobody pressing: the visitor has gone. */
  away: 90,
  /** The closing page's list of what was changed, before the closing words. */
  summary: 15,
  /** The closing words, before the start again. */
  closing: 90,
  /** The rules opened over a page, before they close by themselves. */
  rules: 30,
} as const;

export type AutoAction = 'toEvaluations' | 'toChoose' | 'week' | 'finish' | 'closingWords' | 'home' | 'rules';

export interface Auto {
  /** What changes when it runs out; a new key starts the clock over. */
  key: string;
  seconds: number;
  action: AutoAction;
  /** Said on the page: "조작이 없으면 N초 뒤 {say}". */
  say: string;
}

export interface AutoState {
  pathStarted: boolean;
  step: string;
  eventId: string | null;
  /** The telling's last line is on screen. */
  toldAll: boolean;
  /** Nothing to choose on the version being read (an emergency, or the last version of an event). */
  leaf: boolean;
  seen: number;
  closingWords: boolean;
  lastPress: number;
  /** The rules are open over the page: their own clock closes them, and the page's waits. */
  rulesOpen?: boolean;
}

/** The clock the page is on, or null for a page that waits for no one (the film, a telling still being told). */
export function autoOf(s: AutoState): Auto | null {
  if (!s.pathStarted) return null;
  const key = (what: string) => `${what}:${s.eventId ?? ''}:${s.lastPress}`;
  if (s.rulesOpen) return { key: key('rules'), seconds: AUTO_S.rules, action: 'rules', say: '규칙 창을 닫습니다' };
  switch (s.step) {
    case 'draft':
      return { key: key('draft'), seconds: AUTO_S.draft, action: 'week', say: '이번 주로 넘어갑니다' };
    case 'telling':
      return s.toldAll ? { key: key('told'), seconds: AUTO_S.told, action: 'toEvaluations', say: '주민의 피드백으로 넘어갑니다' } : null;
    case 'evaluations':
      return s.leaf
        ? { key: key('evaluations'), seconds: AUTO_S.evaluations, action: 'week', say: '이번 주로 돌아갑니다' }
        : { key: key('evaluations'), seconds: AUTO_S.evaluations, action: 'toChoose', say: '수정 요청 고르기로 넘어갑니다' };
    case 'week':
    case 'choose':
      // Nobody seen anything yet: there is nothing to close, so the start comes back at once.
      return s.seen > 0
        ? { key: key(`away-${s.step}`), seconds: AUTO_S.away, action: 'finish', say: '마무리합니다' }
        : { key: key(`away-${s.step}`), seconds: AUTO_S.away, action: 'home', say: '처음으로 돌아갑니다' };
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
