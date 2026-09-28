import type { DomainEvent } from '../api/types';
import type { Episode } from './types';

// One colour per request that is still open, so "this request" reads the same
// wherever it appears: the ring on the people doing it on the map, its bar on
// the timeline, the dot on the judgement panel.
//
// The index is the request's place in the day, not among the open ones, so a
// colour never moves to another request when an earlier one closes; a request
// that closed is history and loses its colour.
const PALETTE = ['#2f7d5b', '#b4671a', '#3667a6', '#8b4a9c', '#a8383f'];

export function requestColour(episodes: Episode[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const episode of episodes) {
    if (!out.has(episode.requestId)) out.set(episode.requestId, PALETTE[out.size % PALETTE.length]);
  }
  return out;
}

/**
 * The requests open at the cursor. A request closes at its resolution; one that
 * never gets one - a routine check-in, answered or handed on to a request of its
 * own - closes at its last event rather than staying "open" all day.
 */
export function openRequests(events: DomainEvent[], cursorSeq: number): Set<string> {
  const span = new Map<string, { first: number; close: number }>();
  for (const e of events) {
    if (!e.correlationId || e.correlationId === 'world' || e.correlationId === 'report') continue;
    if (e.type.startsWith('world.')) continue;
    const row = span.get(e.correlationId) ?? { first: e.seq, close: Number.POSITIVE_INFINITY };
    if (e.type === 'need.resolved' || e.type === 'need.unresolved') row.close = e.seq;
    span.set(e.correlationId, row);
  }
  for (const [id, row] of span) {
    if (row.close === Number.POSITIVE_INFINITY) {
      row.close = Math.max(...events.filter((e) => e.correlationId === id).map((e) => e.seq));
    }
  }
  return new Set([...span].filter(([, row]) => row.first <= cursorSeq && cursorSeq < row.close).map(([id]) => id));
}
