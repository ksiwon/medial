// What the wall and the tablet say to each other (server/app/simulation/api/stage.py
// carries it and keeps none of it).
//
// The tablet sends presses. The wall does them - it owns the playhead, the timers
// and every choice's consequence - and says what it now shows. The tablet draws
// that and nothing else: it holds no copy of the walk, so the two cannot disagree
// about where the walk is. (The one-screen version of the exhibition lives on the
// `single-screen` branch; this branch has the two screens only.)

export type Phase = 'idle' | 'intro' | 'draft' | 'week' | 'telling' | 'evaluations' | 'choose' | 'closing';

/** A press. `id` is only what the named press needs. */
export type Command =
  | { name: 'start' }
  | { name: 'skipIntro' }
  | { name: 'openEvent'; id: string }
  | { name: 'line'; value: -1 | 1 }
  | { name: 'skipScene' }
  | { name: 'toEvaluations' }
  | { name: 'toTelling' }
  | { name: 'toChoose' }
  | { name: 'consider'; id: string | null }
  | { name: 'choose'; id: string }
  | { name: 'week' }
  | { name: 'finish' }
  | { name: 'closingWords' }
  /** The rules as they stand, over the wall's page; pressed again (or anything else pressed) it goes. */
  | { name: 'rules' }
  | { name: 'home' };

/** One day of the week, for the tablet's list: which events fall on it. */
export interface DayBrief {
  day: string;
  /** version: which version of the event the wall would read now (1 = as it first ran). */
  events: { id: string; title: string; noChoice: boolean; version: number }[];
}

/** A request to pick: its number and its sentence - what it hopes for, what it costs and its basis are on the wall. */
export interface RequestBrief {
  id: string;
  label: string;
}

/** What the wall is showing, as the tablet needs it: where the walk is, the things to press, and as many words as it
 *  takes to know what a press does - no more: the tablet is touched, the wall is read (2026-10-18). */
export interface StageState {
  phase: Phase;
  /** Every picture and voice the walk uses is held on the wall, and the week is read: only then is "start" taken. */
  ready: boolean;
  /** The week, always: the tablet's list of events to pick from. */
  week: DayBrief[];
  /** How many times the visitor has had the AI changed so far (a request chosen). */
  runs: number;
  /** How many versions the visitor has read so far (the closing opens at five), and in how many different events. */
  reads: number;
  events: number;
  /** The open event, and the weekday it falls on this session. */
  event: { id: string; title: string; day: string | null; noChoice: boolean } | null;
  /** Reading a telling: the scene it is in, how far through, and whether it is done. */
  scene: { time: string; index: number; of: number } | null;
  /** The version of the open event being read (1 = as it first ran) and whether it has nothing to choose. */
  version: number;
  leaf: boolean;
  line: number;
  lines: number;
  toldAll: boolean;
  /** Choose: the requests (none for an emergency). */
  requests: RequestBrief[];
  /** Choose: the request a finger rests on, not yet confirmed. */
  considering: string | null;
  /** After a choice: the wall is making the new simulation (for a few seconds), the telling has not begun. */
  generating: boolean;
  /** Closing: the closing words are up (rather than the list of what was changed). */
  closingWords: boolean;
  /** The rules as they stand are open over the wall's page. */
  rulesOpen: boolean;
}

export const IDLE_STATE: StageState = {
  phase: 'idle', ready: false, week: [], runs: 0, reads: 0, events: 0, event: null, scene: null, version: 1, leaf: false, line: 0, lines: 0, toldAll: false,
  requests: [], considering: null, generating: false, closingWords: false, rulesOpen: false,
};

export const STAGE_API = '/api/sim/stage';

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
