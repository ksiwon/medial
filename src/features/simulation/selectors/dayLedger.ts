import type { Episode } from '../scene/types';

// The day so far, as the right column reads it: one line per request, in the
// order they began, and the tally MEDial's dashboard shows when no scene is on.
//
// Everything here is read off the day's episodes and the playhead - nothing is
// authored and nothing looks ahead. A request is the run of Tasks that share a
// subject and a kind of need ("응답 없는 안부 확인 · P1": reaching them, asking
// the village head, going to the house), so the ledger says what the day was
// about rather than listing every call.

/** One Task of a request: what was done, when, and whether it has started. */
export interface LedgerStep {
  requestId: string;
  title: string;
  atMs: number;
  /** The playhead is at or past this step's start. */
  started: boolean;
  /** The playhead is inside this step. */
  live: boolean;
}

export interface LedgerRow {
  /** The request's name: its need and who it is for. */
  key: string;
  need: string;
  subjectId: string | null;
  firstMs: number;
  lastMs: number;
  steps: LedgerStep[];
  /** MEDial took part in at least one beat of this request. */
  medial: boolean;
  /** Not begun yet at the playhead - the ledger never shows these. */
  state: 'open' | 'done';
  /** Someone the request has asked so far, in order, once each. */
  asked: string[];
}

export interface Ledger {
  /** Requests MEDial took part in. A scene it was not in is not its request
   *  (the timeline says those apart: timelineAt). */
  rows: LedgerRow[];
  /** Requests MEDial has taken on, finished, and still has open at the playhead. */
  taken: number;
  done: number;
  open: number;
  /** How many requests each person has been asked to help with so far. */
  load: { actorId: string; count: number }[];
}

/** "응답 없는 안부 확인 · P1 ◯◯◯" -> "응답 없는 안부 확인". */
export const needOf = (subtitle: string | null | undefined, fallback: string): string =>
  (subtitle?.split(' · ')[0] || fallback).trim();

/**
 * Group a day's episodes into requests and read them at `atMs`.
 *
 * `subtitleOf` gives a Task's panel subtitle (the stored record carries one per
 * Task); a log read without panels falls back to the Task's own title, which
 * makes each Task its own row - honest, if less summarised.
 */
export function ledgerAt(
  episodes: Episode[],
  atMs: number,
  subtitleOf: (requestId: string) => string | null | undefined,
  /** The people a Task asked, when the record says (judgement panel). */
  askedOf: (requestId: string) => string[] = () => [],
): Ledger {
  const tasks = new Map<string, Episode[]>();
  for (const episode of episodes) {
    const list = tasks.get(episode.requestId) ?? [];
    list.push(episode);
    tasks.set(episode.requestId, list);
  }

  const byKey = new Map<string, LedgerRow>();
  for (const [requestId, parts] of tasks) {
    const first = parts[0];
    const need = needOf(subtitleOf(requestId), first.title);
    const key = `${need}|${first.subjectId ?? ''}`;
    const last = parts[parts.length - 1];
    const row = byKey.get(key) ?? {
      key, need, subjectId: first.subjectId, firstMs: first.startMs, lastMs: last.endMs,
      steps: [], state: 'open' as const, asked: [], medial: false,
    };
    // One beat with MEDial in it makes the whole request its own; a Task it was
    // never in (two brothers on a pier) does not.
    if (parts.some((part) => part.beats.some((beat) => beat.medial))) row.medial = true;
    row.firstMs = Math.min(row.firstMs, first.startMs);
    row.lastMs = Math.max(row.lastMs, last.endMs);
    row.steps.push({
      requestId, title: first.title, atMs: first.startMs,
      started: atMs >= first.startMs,
      live: atMs >= first.startMs && atMs <= Math.max(last.endMs, first.startMs + 60_000),
    });
    for (const id of askedOf(requestId)) if (!row.asked.includes(id)) row.asked.push(id);
    byKey.set(key, row);
  }

  const rows = [...byKey.values()].filter((row) => atMs >= row.firstMs && row.medial)
    .map((row): LedgerRow => ({
      ...row,
      steps: row.steps.sort((a, b) => a.atMs - b.atMs),
      state: row.steps.every((s) => s.started && !s.live) ? 'done' : 'open',
    }))
    .sort((a, b) => a.firstMs - b.firstMs);

  const counts = new Map<string, number>();
  for (const row of rows) for (const id of row.asked) counts.set(id, (counts.get(id) ?? 0) + 1);

  return {
    rows,
    taken: rows.length,
    done: rows.filter((r) => r.state === 'done').length,
    open: rows.filter((r) => r.state === 'open').length,
    load: [...counts].map(([actorId, count]) => ({ actorId, count })).sort((a, b) => b.count - a.count),
  };
}

/** One Task on the day's timeline. */
export interface TimelineItem {
  requestId: string;
  /** Unique among the rows: the request, and the minute when it has a later row of its own. */
  key: string;
  title: string;
  /** The request it belongs to, said once it has begun ("응답 없는 안부 확인"). */
  need: string | null;
  subjectId: string | null;
  startMs: number;
  endMs: number;
  /** Over, happening at the playhead, or not begun but known ahead (scheduled). */
  state: 'done' | 'now' | 'planned';
  /** MEDial took part. A Task it was never in is something it did not see. */
  medial: boolean;
}

/**
 * The day as a timeline at `atMs`: every Task begun so far, in order, and the
 * Tasks the record says were scheduled ahead and have not begun.
 *
 * Nothing else ahead is listed. A call that comes because someone did not answer,
 * or an emergency in the evening, is not known until it happens - only what was
 * planned before the day (MEDial's own check-in call, a booked appointment) is.
 * A planned Task says what it is, never how it went: its request's name is the
 * panel's, which is written from the outcome ("응답 없는" 안부 확인), so it waits.
 * What MEDial never saw is listed only when `showUnseen` (the researcher's view).
 */
export function timelineAt(
  episodes: Episode[],
  atMs: number,
  scheduled: ReadonlySet<string>,
  subtitleOf: (requestId: string) => string | null | undefined,
  showUnseen: boolean,
): TimelineItem[] {
  const tasks = new Map<string, Episode[]>();
  for (const episode of episodes) tasks.set(episode.requestId, [...(tasks.get(episode.requestId) ?? []), episode]);
  // A Task belongs to MEDial when its request does (as in ledgerAt): the visit a
  // village head makes because MEDial asked is MEDial's work, though it is not there.
  const keyOf = (requestId: string, first: Episode) =>
    `${needOf(subtitleOf(requestId), first.title)}|${first.subjectId ?? ''}`;
  const ours = new Set([...tasks].filter(([, parts]) => parts.some((part) => part.beats.some((beat) => beat.medial)))
    .map(([requestId, parts]) => keyOf(requestId, parts[0])));
  const items: TimelineItem[] = [];
  for (const [requestId, parts] of tasks) {
    const first = parts[0];
    const startMs = Math.min(...parts.map((p) => p.startMs));
    const endMs = Math.max(...parts.map((p) => p.endMs));
    const medial = ours.has(keyOf(requestId, first));
    const begun = atMs >= startMs;
    if (!begun && !scheduled.has(requestId)) continue;
    if (!medial && !showUnseen) continue;
    items.push({
      requestId, key: requestId, title: first.title, subjectId: first.subjectId, startMs, endMs, medial,
      need: begun ? needOf(subtitleOf(requestId), first.title) : null,
      // Over at its end: the call that ends at 09:40 is not still lit when the next begins at 09:40.
      state: !begun ? 'planned' : atMs < Math.max(endMs, startMs + 60_000) ? 'now' : 'done',
    });
  }
  // A later stretch of a request that the day tells with a note of its own (the medicine arriving at 18:30)
  // is a row too: whatever the middle of the screen says, the timeline lists.
  for (const episode of episodes) {
    if (!episode.noteTitle || atMs < episode.startMs) continue;
    const parent = items.find((item) => item.requestId === episode.requestId);
    if (!parent) continue;
    items.push({
      requestId: episode.requestId, key: `${episode.requestId}@${Math.floor(episode.startMs / 60_000)}`, title: episode.noteTitle,
      subjectId: episode.subjectId, startMs: episode.startMs, endMs: episode.endMs, medial: parent.medial, need: parent.need,
      state: atMs < Math.max(episode.endMs, episode.startMs + 60_000) ? 'now' : 'done',
    });
  }
  return items.sort((a, b) => a.startMs - b.startMs);
}

/** Where the village is at the playhead: the routine the day sits on. */
export interface Routine {
  /** People where their ordinary day puts them. */
  onRoutine: number;
  /** People doing something other than their routine - the day's departures. */
  departed: number;
  /** Every place someone is, most-occupied first: who is there, and which of
   *  them are off their ordinary day. */
  where: { label: string; count: number; ids: string[]; departed: string[] }[];
}

export function routineAt(
  poses: { place: string | null; offMap: boolean; moving: boolean; divergesFromBaseline: boolean; id: string }[],
  labelOf: (place: string | null, id: string) => string | null,
): Routine {
  const groups = new Map<string, { ids: string[]; departed: string[] }>();
  for (const pose of poses) {
    // A home is a home. placeLabel leaves a person's own home unnamed (a person
    // is not told where they live), which is not the same as being on the road:
    // reading it so put five people "on the road" at noon who were indoors.
    const label = pose.offMap ? '마을 밖'
      : pose.moving ? '길 위'
        : pose.place?.startsWith('HOME:') ? '자택'
          : labelOf(pose.place, pose.id) ?? '길 위';
    const group = groups.get(label) ?? { ids: [], departed: [] };
    group.ids.push(pose.id);
    if (pose.divergesFromBaseline) group.departed.push(pose.id);
    groups.set(label, group);
  }
  const departed = poses.filter((p) => p.divergesFromBaseline).length;
  return {
    onRoutine: poses.length - departed,
    departed,
    where: [...groups].map(([label, g]) => ({ label, count: g.ids.length, ids: g.ids, departed: g.departed }))
      .sort((a, b) => b.count - a.count),
  };
}
