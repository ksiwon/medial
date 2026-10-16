// What the wall and the tablet say to each other (server/app/simulation/api/stage.py
// carries it and keeps none of it).
//
// The tablet sends presses. The wall does them - it owns the playhead, the timers
// and every choice's consequence - and says what it now shows. The tablet draws
// that and nothing else: it holds no copy of the walk, so the two cannot disagree
// about where the walk is. (The one-screen version of the exhibition lives on the
// `single-screen` branch; this branch has the two screens only.)

export type Phase = 'idle' | 'intro' | 'day' | 'evaluations' | 'choose' | 'ending';

/** A press. `value` and `id` are only what the named press needs. */
export type Command =
  | { name: 'start' }
  | { name: 'skipIntro' }
  | { name: 'togglePlay' }
  | { name: 'skipScene' }
  | { name: 'seek'; value: number }
  | { name: 'commit' }
  | { name: 'readEvaluations' }
  | { name: 'evalPage'; value: -1 | 1 }
  | { name: 'evalOpen'; id: string }
  | { name: 'evalClose' }
  | { name: 'evalIssues' }
  | { name: 'openScene'; id: string }
  | { name: 'goImprove' }
  | { name: 'choose'; id: string }
  | { name: 'closing' }
  | { name: 'home' };

export type CommandName = Command['name'];

export interface ResidentBrief {
  id: string;
  name: string;
  /** The first thing they asked to change, else the start of what they said. */
  said: string;
}

export interface TaskBrief {
  startMs: number;
  title: string;
}

export interface WentBrief {
  /** The event a press opens as a scene. */
  id: string;
  time: string;
  title: string;
}

export interface ChoiceBrief {
  /** The version that choosing it opens; null for an option that was never run. */
  id: string | null;
  label: string;
  kind: string;
  goal: string | null;
  rule: { before: string; after: string } | null;
  /** Whose experience the request came from: the link from an evaluation to a revision. */
  from: string[];
}

/** What the wall is showing, as the tablet needs it. Small on purpose: where the walk is, and the things to press. */
export interface StageState {
  phase: Phase;
  /** "1일차", "2일차" ...; null before the walk starts. */
  day: string | null;
  /** Which day of how many (0-based index), for the tablet's day dots. */
  dayIndex: number;
  dayCount: number;
  /** The scene's title while one is on, else null. */
  scene: string | null;
  playing: boolean;
  /** 0..1 through the day's reel. */
  progress: number;
  /** The day's clock, in ms since midnight, and its two ends, for the time slider. */
  atMs: number;
  dayStartMs: number;
  dayEndMs: number;
  dayOver: boolean;
  /** The day's requests, in time order: the timeline the visitor used to press on the wall. */
  tasks: TaskBrief[];
  /** Evaluations: everyone who was asked, which page the wall shows, and what is open on it. */
  residents: ResidentBrief[];
  page: number;
  pages: number;
  openActor: string | null;
  issues: boolean;
  /** Issue groups exist for this day. */
  hasIssues: boolean;
  /** What the open resident went through, each one a scene the wall can open. */
  went: WentBrief[];
  /** Whether the day's evaluations lead to a choice (otherwise to the result). */
  hasChoice: boolean;
  choices: ChoiceBrief[];
  /** The requests the visitor chose on the way to this day, in their words. */
  chosen: string[];
  /** The ending: the closing words have taken the page. */
  closing: boolean;
}

export const IDLE_STATE: StageState = {
  phase: 'idle', day: null, dayIndex: 0, dayCount: 0, scene: null, playing: false, progress: 0, atMs: 0,
  dayStartMs: 0, dayEndMs: 0, dayOver: false, tasks: [], residents: [], page: 0, pages: 0, openActor: null,
  issues: false, hasIssues: false, went: [], hasChoice: false, choices: [], chosen: [], closing: false,
};

export const STAGE_API = '/api/sim/stage';

/** Residents to a page of the wall's evaluations: five columns on a wall screen. The tablet pages the same way. */
export const PER_PAGE = 5;

/** The tablet's connection to the exhibition, as the page can tell it. */
export type Link = 'connecting' | 'live' | 'lost' | 'released' | 'refused';

// ---- who is who ------------------------------------------------------------

/** The role is in the address: `/?role=wall` on the big screen, `/?role=pad&t=...` on the tablet. */
export type Role = 'wall' | 'pad';

export function roleOf(search: string = typeof window === 'undefined' ? '' : window.location.search): Role | null {
  const role = new URLSearchParams(search).get('role');
  return role === 'wall' || role === 'pad' ? role : null;
}

/** The address the QR code sends a tablet to. */
export function padAddress(origin: string, token: string): string {
  return `${origin}/?role=pad&t=${encodeURIComponent(token)}`;
}

// ---- the pairing token -----------------------------------------------------
//
// The QR code carries a token that is new every run of the server. The tablet keeps it for the rest of this
// visit so a reload is still the same tablet. What it keeps is only ever one token and whether this tablet
// has already said "connect" for *that* token: after the server restarts, the old token is refused, and a
// fresh scan starts from the connect button again.

const TOKEN_KEY = 'medial.pad.token';
const JOINED_KEY = 'medial.pad.joined';

export interface PadKeep {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserKeep(): PadKeep | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

/** The token for this load: the address's if it has one (and keeps it), else the one kept. */
export function padToken(search: string = typeof window === 'undefined' ? '' : window.location.search, keep: PadKeep | null = browserKeep()): string | null {
  const given = new URLSearchParams(search).get('t');
  try {
    if (given) {
      // A different code from the one kept is a new pairing: the connect button is asked again.
      if (keep && keep.getItem(TOKEN_KEY) !== given) keep.removeItem(JOINED_KEY);
      keep?.setItem(TOKEN_KEY, given);
      return given;
    }
    return keep?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return given; // storage can be blocked (a private tab); the address still works for this load
  }
}

export function forgetPadToken(keep: PadKeep | null = browserKeep()): void {
  try { keep?.removeItem(TOKEN_KEY); keep?.removeItem(JOINED_KEY); } catch { /* nothing kept */ }
}

export function hasJoined(token: string | null, keep: PadKeep | null = browserKeep()): boolean {
  try { return token !== null && keep?.getItem(JOINED_KEY) === token; } catch { return false; }
}

export function rememberJoined(token: string, keep: PadKeep | null = browserKeep()): void {
  try { keep?.setItem(JOINED_KEY, token); } catch { /* the visit just asks again after a reload */ }
}
