import type { Line, Week, WeekEvent, WeekRequest, WeekScene } from './types';

// What the screens ask of the week. Pure: the same week always answers the same.

export const eventOf = (week: Week, id: string | null): WeekEvent | null =>
  week.events.find((e) => e.id === id) ?? null;

export const requestOf = (event: WeekEvent | null, id: string | null): WeekRequest | null =>
  event?.requests.find((r) => r.id === id) ?? null;

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

/** The sentences a card reads: the part of the rule that changes, before and after, in the designer's own words. */
export function requestsOf(event: WeekEvent): WeekRequest[] {
  return event.noChoice ? [] : event.requests;
}

/** Events in the order the week tells them: by day, and within a day the order the session placed them. */
export function eventsInOrder(week: Week): WeekEvent[] {
  const ids = week.days.flatMap((d) => d.events);
  return ids.map((id) => eventOf(week, id)).filter((e): e is WeekEvent => e !== null);
}

/** How many events are read and how many are left, for the week's own caption. */
export function progress(week: Week, seen: ReadonlySet<string>): { seen: number; of: number } {
  const ids = week.days.flatMap((d) => d.events);
  return { seen: ids.filter((id) => seen.has(id)).length, of: ids.length };
}
