// The week the exhibition reads (server/app/simulation/week.py). Joined and checked on the server: a screen
// never combines files, and nothing in it is a score.

export type Pose = 'stand' | 'phone' | 'work' | 'desk' | 'lying' | 'resting' | 'cpr';

/** One place on screen and who is standing in it. A phone call is two frames; a talk in one room is one. */
export interface Frame {
  /** The backdrop's name (art.ts): HOME · SHOP · FARM · CLINIC · PATROL · TOWN · HALL. */
  place: string;
  label: string | null;
  /** Where the AI's voice comes out in this frame, if it does. */
  device: string | null;
  who: Record<string, Pose>;
}

export interface Line { n: number; speaker: string; text: string }

export interface WeekScene {
  key: string;
  time: string;
  situation: string;
  /** high (7-8 lines) · mid (5-6) · low (3-4): how much the moment weighs. */
  importance: 'high' | 'mid' | 'low';
  frames: Frame[];
  cast: string[];
  lines: Line[];
}

/** A simulated resident's reading of what they went through. Never a real resident's opinion. */
export interface Evaluation {
  actor: string;
  name: string;
  source: 'simulated';
  paragraph: string;
  /** The line numbers of the variant's scenes this paragraph rests on: only lines the resident was in. */
  citedLines: number[];
  changeWish: string | null;
  disclaimer: string;
}

export type Basis = 'direct' | 'weak';

export interface WeekRequest {
  id: string;
  label: string;
  /** What the designer hopes for, and what it may cost. Both are read: no request is only good. */
  expect: string;
  cost: string;
  rules: { type: string; before: Record<string, unknown>; after: Record<string, unknown> }[];
  /** How well the residents' own words support this request. 'weak' is shown as such, never hidden. */
  basis: { verdict: Basis; actor: string | null; quote: string | null };
  after: { scene: WeekScene; evaluations: Evaluation[] };
}

export interface WeekEvent {
  id: string;
  title: string;
  gist: string;
  /** An emergency: it is read, not chosen. No request cards. */
  noChoice: boolean;
  precededBy: string | null;
  precedes: string | null;
  before: { scenes: WeekScene[]; evaluations: Evaluation[] };
  requests: WeekRequest[];
}

export interface Week {
  days: { day: string; events: string[] }[];
  people: Record<string, string>;
  events: WeekEvent[];
  disclaimer: string;
}

/** Where the walk is. One path: the week, an event, its scenes, the residents' words, the request, what came of it. */
export type Step = 'week' | 'before' | 'evaluations' | 'choose' | 'after' | 'result';
