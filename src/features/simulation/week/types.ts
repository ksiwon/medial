// The week the exhibition reads (server/app/simulation/week.py). Joined and checked on the server: a screen
// never combines files, and nothing in it is a score.

export type Pose = 'stand' | 'phone' | 'work' | 'desk' | 'lying' | 'fallen' | 'resting' | 'cpr';

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
  /** What they made of it, one thing at a time. A resident may have only good claims, only bad ones, or a mix. */
  claims: Claim[];
  /** Which part of their interview this reading rests on: the persona field and the model's one line about it.
   *  Both null when it rests on none - or the resident is a role nobody was interviewed as. */
  grounding: { field: string | null; note: string | null; interviewed: boolean };
  disclaimer: string;
}

/**
 * How one request moved one resident's feedback, in the claims' own words: their troubles (bad and wish) on the
 * version it was chosen on, sorted as resolved, remaining or unclear (their feedback does not say), and the troubles
 * the new version brought. A reading of two feedbacks (scripts/gen_week_evaluations.py compare), shown as one.
 * presence: 'before' - not in the new version, so nothing of theirs can be told; 'after' - new to it.
 */
export interface FeedbackChange {
  actor: string;
  name: string;
  presence: 'both' | 'before' | 'after';
  resolved: string[];
  remaining: string[];
  unclear: string[];
  new: string[];
}

/**
 * good: it helped · bad: it was uncomfortable or worrying · neutral: neither · unknown: what they went through
 * could not tell · wish: what they would have changed. The kind is the simulated resident's reading of one thing,
 * never a verdict on the whole and never a score.
 */
export type ClaimKind = 'good' | 'bad' | 'neutral' | 'unknown' | 'wish';

export interface Claim {
  kind: ClaimKind;
  text: string;
  /** Line numbers of the variant's scenes this claim rests on: only lines the resident was in. */
  citedLines: number[];
}

export type Basis = 'direct' | 'weak';

/** One of the AI's operating rules as it ran, in words. */
export interface Rule { type: string; label: string; sentence: string }

export interface RuleChange {
  type: string;
  label: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  beforeSentence: string;
  afterSentence: string;
}

export interface WeekRequest {
  id: string;
  label: string;
  /** What the designer hopes for, and what it may cost. Both are read: no request is only good. */
  expect: string;
  cost: string;
  /** The rules it changes, with the sentences the AI's judgment panel reads before and after (server rules.py). */
  rules: RuleChange[];
  /** How well the residents' own words support this request. 'weak' is shown as such, never hidden. */
  /** why: for a weak basis, what the words speak to and what they do not (scripts/gen_week_evaluations.py explain). */
  basis: { verdict: Basis; actor: string | null; quote: string | null; kind: ClaimKind | null; why: string | null };
  /** The version this request makes: its scene, what the residents made of it, and what can be chosen from there (nothing on the last version). */
  after: { scene: WeekScene; evaluations: Evaluation[]; change: FeedbackChange[]; requests: WeekRequest[] };
}

export interface WeekEvent {
  id: string;
  title: string;
  gist: string;
  /** An emergency: it is read, not chosen. No request cards. */
  noChoice: boolean;
  precededBy: string | null;
  precedes: string | null;
  /** The rules the AI ran this event under before anything was chosen (none for an emergency). */
  rules: Rule[];
  before: { scenes: WeekScene[]; evaluations: Evaluation[] };
  requests: WeekRequest[];
}

export interface Week {
  days: { day: string; events: string[] }[];
  people: Record<string, string>;
  events: WeekEvent[];
  /** The draft the designer brought: every rule's value before anything is chosen, one for the whole week. */
  draft: Rule[];
  disclaimer: string;
}

/** Where the walk is. One path: the draft the designer brought (once, after the introduction), the week, an event (its scenes, as they ran in the version being read), the residents'
 *  words, the request to choose - and a choice makes the next version, back at the week. When the visitor is done (or
 *  has gone), the closing words. */
export type Step = 'draft' | 'week' | 'telling' | 'evaluations' | 'choose' | 'closing';
