// What the wall and the tablet say to each other (server/app/simulation/api/stage.py
// carries it and keeps none of it).
//
// The tablet sends presses. The wall does them - it owns the playhead, the timers
// and every choice's consequence - and says what it now shows. The tablet draws
// that and nothing else: it holds no copy of the walk, so the two cannot disagree
// about where the walk is. (The one-screen version of the exhibition lives on the
// `single-screen` branch; this branch has the two screens only.)

export type Phase = 'idle' | 'intro' | 'week' | 'before' | 'evaluations' | 'choose' | 'after' | 'result' | 'closing';

/** A press. `id` is only what the named press needs. */
export type Command =
  | { name: 'start' }
  | { name: 'skipIntro' }
  | { name: 'openEvent'; id: string }
  | { name: 'line'; value: -1 | 1 }
  | { name: 'skipScene' }
  | { name: 'toEvaluations' }
  | { name: 'openResident'; id: string }
  | { name: 'closeResident' }
  | { name: 'toChoose' }
  | { name: 'consider'; id: string | null }
  | { name: 'choose'; id: string }
  | { name: 'toResult' }
  | { name: 'week' }
  | { name: 'finish' }
  | { name: 'closingWords' }
  | { name: 'home' };

/** One day of the week, for the tablet's list: which events fall on it. */
export interface DayBrief {
  day: string;
  events: { id: string; title: string; noChoice: boolean; seen: boolean }[];
}

export interface ResidentBrief {
  id: string;
  name: string;
  /** The first line of what they said: enough to tell the cards apart. */
  said: string;
}

export interface RequestBrief {
  id: string;
  label: string;
  expect: string;
  cost: string;
  /** How well the residents' own words support it: shown, never hidden. */
  basis: 'direct' | 'weak';
  /** Whose words it came from. */
  from: string | null;
}

/** What the wall is showing, as the tablet needs it. Small on purpose: where the walk is, and the things to press. */
export interface StageState {
  phase: Phase;
  /** The week, always: the tablet's list of events to pick from. */
  week: DayBrief[];
  seen: number;
  total: number;
  /** The open event, and the weekday it falls on this session. */
  event: { id: string; title: string; day: string | null; noChoice: boolean } | null;
  /** Reading a telling (before / after): the scene it is in, how far through, and whether it is done. */
  scene: { time: string; place: string | null; index: number; of: number } | null;
  line: number;
  lines: number;
  toldAll: boolean;
  /** Evaluations: the residents who were asked, and whose card is open. */
  residents: ResidentBrief[];
  openActor: string | null;
  /** Choose: the requests (none for an emergency). After: the one that was chosen. */
  requests: RequestBrief[];
  chosen: string | null;
  /** Choose: the request a finger rests on, not yet confirmed. */
  considering: string | null;
  /** The clock the wall's page is on (week/auto.ts), so the tablet can say it too; a new key is a new count. */
  auto: { key: string; seconds: number; say: string } | null;
  /** Closing: the closing words are up (rather than the list of what was changed). */
  closingWords: boolean;
}

export const IDLE_STATE: StageState = {
  phase: 'idle', week: [], seen: 0, total: 0, event: null, scene: null, line: 0, lines: 0, toldAll: false,
  residents: [], openActor: null, requests: [], chosen: null, considering: null, auto: null, closingWords: false,
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
