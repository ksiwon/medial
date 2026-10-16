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
}

/** What the wall is showing, as the tablet needs it. Small on purpose: where the walk is, and the things to press. */
export interface StageState {
  phase: Phase;
  /** "1일차", "2일차" ...; null before the walk starts. */
  day: string | null;
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
  /** The ending: the closing words have taken the page. */
  closing: boolean;
}

export const IDLE_STATE: StageState = {
  phase: 'idle', day: null, scene: null, playing: false, progress: 0, atMs: 0, dayStartMs: 0, dayEndMs: 0,
  dayOver: false, tasks: [], residents: [], page: 0, pages: 0, openActor: null, issues: false, hasIssues: false,
  went: [], hasChoice: false, choices: [], closing: false,
};

export const STAGE_API = '/api/sim/stage';

/** A press said to the server. A failure to reach it is the tablet's to show. */
export async function sendCommand(command: Command): Promise<void> {
  const response = await fetch(`${STAGE_API}/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

/** What the wall shows, said to the server (and on to every tablet). */
export async function sendState(state: StageState): Promise<void> {
  await fetch(`${STAGE_API}/state`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state),
  });
}

/** The role is in the address: `/?role=wall` on the big screen, `/?role=pad` on the tablet. */
export type Role = 'wall' | 'pad';

export function roleOf(search: string = typeof window === 'undefined' ? '' : window.location.search): Role | null {
  const role = new URLSearchParams(search).get('role');
  return role === 'wall' || role === 'pad' ? role : null;
}
