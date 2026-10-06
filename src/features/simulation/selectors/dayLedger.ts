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
  /** Requests MEDial took part in. A scene it was not in is not its request. */
  rows: LedgerRow[];
  /** What happened that MEDial never saw - said apart from its own work, because
   *  the study's premise is that people who bear things quietly are not seen. */
  unseen: LedgerRow[];
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

  const started = [...byKey.values()].filter((row) => atMs >= row.firstMs);
  const unseen = started.filter((row) => !row.medial);
  const rows = started.filter((row) => row.medial)
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
    unseen: unseen.map((row): LedgerRow => ({ ...row, steps: row.steps.sort((a, b) => a.atMs - b.atMs), state: 'done' })),
    taken: rows.length,
    done: rows.filter((r) => r.state === 'done').length,
    open: rows.filter((r) => r.state === 'open').length,
    load: [...counts].map(([actorId, count]) => ({ actorId, count })).sort((a, b) => b.count - a.count),
  };
}

/** Where the village is at the playhead, in words: the routine the day sits on. */
export interface Routine {
  /** People where their ordinary day puts them. */
  onRoutine: number;
  /** People doing something other than their routine - the day's departures. */
  departed: number;
  /** A few of the places people are, most-occupied first, with a head count. */
  where: { label: string; count: number }[];
}

export function routineAt(
  poses: { place: string | null; offMap: boolean; moving: boolean; divergesFromBaseline: boolean; id: string }[],
  labelOf: (place: string | null, id: string) => string | null,
): Routine {
  const counts = new Map<string, number>();
  for (const pose of poses) {
    // A home is a home. placeLabel leaves a person's own home unnamed (a person
    // is not told where they live), which is not the same as being on the road:
    // reading it so put five people "on the road" at noon who were indoors.
    const label = pose.offMap ? '마을 밖'
      : pose.moving ? '길 위'
        : pose.place?.startsWith('HOME:') ? '자택'
          : labelOf(pose.place, pose.id) ?? '길 위';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const departed = poses.filter((p) => p.divergesFromBaseline).length;
  return {
    onRoutine: poses.length - departed,
    departed,
    where: [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 5),
  };
}
