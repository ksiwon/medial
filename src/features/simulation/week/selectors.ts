import type { Evaluation, Line, Week, WeekEvent, WeekRequest, WeekScene } from './types';

// What the screens ask of the week. Pure: the same week always answers the same.

export const eventOf = (week: Week, id: string | null): WeekEvent | null =>
  week.events.find((e) => e.id === id) ?? null;

/**
 * An event as it can be read: ver1 is how it first ran; choosing a request on a version makes the next one, which is
 * that request's scene and the residents' words about it, and offers requests of its own. A version is named by the
 * path of requests that led to it (ver1: none).
 */
export interface Version {
  /** 1 for the event as it first ran, 2 after one request, 3 after two. */
  number: number;
  path: string[];
  /** The requests made along the path, in order. */
  chain: WeekRequest[];
  scenes: WeekScene[];
  evaluations: Evaluation[];
  /** What can be chosen from this version: nothing on the last one, and nothing in an emergency. */
  requests: WeekRequest[];
}

export function versionOf(event: WeekEvent | null, path: readonly string[]): Version | null {
  if (!event) return null;
  let offered = event.noChoice ? [] : event.requests;
  const chain: WeekRequest[] = [];
  let scenes = event.before.scenes;
  let evaluations = event.before.evaluations;
  for (const id of path) {
    const next = offered.find((r) => r.id === id);
    if (!next) return null;
    chain.push(next);
    scenes = [next.after.scene];
    evaluations = next.after.evaluations;
    offered = next.after.requests;
  }
  return { number: path.length + 1, path: [...path], chain, scenes, evaluations, requests: offered };
}

/** How many times the visitor has had the AI changed (a request chosen, a new simulation made) before the closing opens. */
export const RUNS_TO_CLOSE = 5;

/** The requests chosen so far in each event, in order: the event's version is the path's length + 1. */
export type Paths = Record<string, string[]>;

export const runsOf = (paths: Paths): number => Object.values(paths).reduce((n, p) => n + p.length, 0);

/** The weekday an event falls on this session. The pool does not know: the schedule does. */
export const dayOf = (week: Week, eventId: string): string | null =>
  week.days.find((d) => d.events.includes(eventId))?.day ?? null;

/** A resident's name on screen. The service is only ever 'AI'. */
export const nameOf = (week: Week, id: string): string => week.people[id] ?? id;

/** Every line of an event's before-scenes, in the order they are told, with the scene each belongs to. */
export function beforeLines(event: WeekEvent): { scene: WeekScene; line: Line }[] {
  return event.before.scenes.flatMap((scene) => scene.lines.map((line) => ({ scene, line })));
}

/**
 * Where an event's scenes are, as one reading position. The reader steps through lines one at a time; the
 * position says which scene that line is in, and how far through the whole telling they are.
 */
export function positionIn(scenes: WeekScene[], index: number): { scene: number; line: number; total: number; done: boolean } {
  const total = scenes.reduce((n, s) => n + s.lines.length, 0);
  const at = Math.min(Math.max(index, 0), Math.max(total - 1, 0));
  let seen = 0;
  for (let i = 0; i < scenes.length; i += 1) {
    const here = scenes[i].lines.length;
    if (at < seen + here) return { scene: i, line: at - seen, total, done: index >= total - 1 };
    seen += here;
  }
  return { scene: Math.max(scenes.length - 1, 0), line: 0, total, done: true };
}

/** The number a line has across a variant's scenes (the evaluations count that way). */
export function numberOf(scenes: WeekScene[], sceneIndex: number, lineIndex: number): number {
  let n = 0;
  for (let i = 0; i < sceneIndex; i += 1) n += scenes[i].lines.length;
  return n + lineIndex + 1;
}

/** Whether the residents' words only weakly support a request. Shown as such. */
export const isWeak = (request: WeekRequest): boolean => request.basis.verdict === 'weak';

/** Events in the order the week tells them: by day, and within a day the order the session placed them. */
export function eventsInOrder(week: Week): WeekEvent[] {
  const ids = week.days.flatMap((d) => d.events);
  return ids.map((id) => eventOf(week, id)).filter((e): e is WeekEvent => e !== null);
}

/** Hours as a number: '09:40' -> 9.67. */
export const hoursOf = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h + (m || 0) / 60;
};

export interface Block {
  event: WeekEvent;
  /** When it starts by its first scene (hours). */
  from: number;
  /** Where its block sits on the day's axis (fractions of the axis) - at least `minHours` tall, so it can be read. */
  top: number;
  height: number;
}

export interface TimetableDay { day: string; blocks: Block[] }

/**
 * The week as a timetable: a column a day, the hours down it, each event a block from the time it happened. A block
 * is at least `minHours` tall however short the event (a twelve-minute call still has to say what happened and how
 * the residents received it). Two events of one day never stand side by side: a block that would overlap the one
 * before it moves down below it, and blocks that would run off the end of the day move up together - so a block may
 * sit a little off its time. Blocks of one day keep `gapHours` apart.
 */
export function timetable(week: Week, axis: { from: number; to: number; minHours: number; gapHours: number }): TimetableDay[] {
  const span = axis.to - axis.from;
  const gap = axis.gapHours / span;
  return week.days.map(({ day, events: ids }) => {
    const blocks: Block[] = ids.map((id) => eventOf(week, id)).filter((e): e is WeekEvent => e !== null).map((event) => {
      const times = event.before.scenes.map((s) => hoursOf(s.time));
      const from = Math.min(...times);
      const height = Math.max(Math.max(...times) - from, axis.minHours) / span;
      return { event, from, top: Math.max((from - axis.from) / span, 0), height };
    }).sort((a, b) => a.top - b.top);
    // Down past the one before; then, from the last, up so nothing runs past the end of the day.
    for (let i = 1; i < blocks.length; i += 1) blocks[i].top = Math.max(blocks[i].top, blocks[i - 1].top + blocks[i - 1].height + gap);
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      const limit = i === blocks.length - 1 ? 1 : blocks[i + 1].top - gap;
      blocks[i].top = Math.max(Math.min(blocks[i].top, limit - blocks[i].height), 0);
    }
    return { day, blocks };
  });
}

/** How many events are read and how many are left, for the week's own caption. */
export function progress(week: Week, seen: ReadonlySet<string>): { seen: number; of: number } {
  const ids = week.days.flatMap((d) => d.events);
  return { seen: ids.filter((id) => seen.has(id)).length, of: ids.length };
}
