import type { AgentReview, GenerationDetail } from '../api/iteration';
import type { DomainEvent } from '../api/types';
import { formatClock } from '../positions';
import { sentenceFor } from './story';

// Who is on the evaluations page, in what order, and what each of them went
// through. The wall draws it and the tablet lists it, so both read it here.

/** How many residents a page holds: what fits side by side on a wall screen (five columns). */
export const PER_PAGE = 5;

export function byActor(a: AgentReview, b: AgentReview) {
  return a.actorId.localeCompare(b.actorId, undefined, { numeric: true });
}

/** Only those who went through the day and were asked. A review of someone who went
 *  through nothing says nothing, so it is not shown. */
export function askedReviews(generation: GenerationDetail | null | undefined): AgentReview[] {
  return (generation?.reviews ?? []).filter((r) => r.usageStatus !== 'no_experience').sort(byActor);
}

export const pagesOf = (count: number) => Math.ceil(count / PER_PAGE);

export interface WentRow { id: string; time: string; title: string }

/** What someone went through, as the log says it: "09:30 본인에게 연락". A Task
 *  event says its title; any other event its own sentence. */
export function wentThrough(review: AgentReview, eventsById: Map<string, DomainEvent> | null): WentRow[] {
  if (!eventsById) return [];
  const said: WentRow[] = [];
  const seen = new Set<string>();
  for (const id of review.experiencedEventIds) {
    const event = eventsById.get(id);
    if (!event) continue;
    const title = typeof event.payload.title === 'string' ? event.payload.title : sentenceFor(event)?.text;
    if (!title) continue;
    const time = formatClock(event.simTimeMs);
    if (seen.has(`${time} ${title}`)) continue;
    seen.add(`${time} ${title}`);
    said.push({ id, time, title });
  }
  return said;
}

/** What they asked to change, as the card says it: the first request, else the start of what they said. */
export function saidOf(review: AgentReview): string {
  const ask = review.items.map((i) => i.requestedChange).find((c): c is string => Boolean(c));
  if (ask) return ask;
  const text = review.overallNarrative.trim();
  return text.length > 60 ? `${text.slice(0, 58)}…` : text;
}
