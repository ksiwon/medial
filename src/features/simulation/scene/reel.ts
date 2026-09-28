import type { DomainEvent, Timeline } from '../api/types';
import { MAP_GAP_MS } from './beats';
import type { Episode, Position, Segment } from './types';

// The day in real seconds.
//
// Playback is not "simulated minutes per second" any more: a scene is paced by
// how long its lines take to read, and the quiet stretches between scenes run
// fast on the map. So the day is laid out once as segments - map, lead, line,
// hold - and the playhead is a number of real seconds into that layout. Any
// point of it can be drawn directly (a seek never has to replay what came
// before), and the stored cursor is read off whichever segment is under it.
//
// The values (decided 2026-09-28 for the exhibition wall, D108):
//   · a said line: '· · ·' 0.5 s, then 1.2 s + 0.14 s per character, held 2-8 s
//   · a caption: 1.0 s + 0.07 s per character, 1.8-5 s
//   · entering a scene from the map 0.8 s, cutting between beats 0.45 s; a
//     request seen for the first time lights its four judgement steps 0.6 s apart
//   · the map: 240 sim-minutes a second when nobody is on an errand, 20 while
//     someone is travelling for a request, 6 in the last 8 minutes before a
//     scene; at least 1.4 s between two scenes so the transition can be seen
//   · pace multiplies the reading times only (천천히 1.35 · 보통 1 · 빠르게 0.7)

export const TYPING_S = 0.5;
export const ENTER_S = 0.8;
export const CUT_S = 0.45;
export const REVEAL_STEP_S = 0.6;
export const REVEAL_STEPS = 4;
export const PACES = [
  { value: 1.35, label: '천천히' },
  { value: 1, label: '보통' },
  { value: 0.7, label: '빠르게' },
] as const;

const MINUTE = 60_000;
/** A segment before it is placed on the reel. */
type Draft = Segment extends infer S ? (S extends Segment ? Omit<S, 'r0'> : never) : never;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export const sayDuration = (text: string, pace: number) => (TYPING_S + clamp(1.2 + 0.14 * text.length, 2, 8)) * pace;
export const captionDuration = (text: string, pace: number) => clamp(1 + 0.07 * text.length, 1.8, 5) * pace;

export interface Reel {
  segments: Segment[];
  total: number;
  episodes: Episode[];
  dayStartMs: number;
  dayEndMs: number;
  locate: (rt: number) => Position;
  /** The playhead for a clock time: inside a map shot, or the start of the scene there. */
  atTime: (ms: number) => number;
  /** The playhead for an event: its line if it has one, otherwise its time on the map. */
  atSeq: (seq: number) => number;
}

interface Input {
  episodes: Episode[];
  events: DomainEvent[];
  timeline: Timeline | null;
  dayStartMs: number;
  dayEndMs: number;
  pace: number;
}

export function buildReel({ episodes, events, timeline, dayStartMs, dayEndMs, pace }: Input): Reel {
  const segments: Segment[] = [];
  let total = 0;
  const push = (segment: Draft) => {
    segments.push({ ...segment, r0: total } as Segment);
    total += segment.dur;
  };
  const errands = errandsOf(timeline);

  let clock = dayStartMs;
  episodes.forEach((episode, e) => {
    const fromMap = episode.startMs - clock >= MAP_GAP_MS || e === 0;
    if (fromMap) push(mapSegment(clock, episode.startMs, episode.startMs, e === 0 ? 1 : 1.4, errands));
    episode.beats.forEach((beat, b) => {
      const enter = b === 0 && fromMap ? ENTER_S : CUT_S;
      const reveal = b === 0 && episode.firstOfRequest;
      const firstSeq = beat.lines[0]?.seq ?? beat.firstSeq;
      push({ kind: 'lead', episode: e, beat: b, enter, reveal, w0: beat.startMs, seq: Math.max(0, firstSeq - 1),
             dur: enter + (reveal ? REVEAL_STEPS * REVEAL_STEP_S * pace : 0.2) });
      const n = beat.lines.length;
      beat.lines.forEach((line, i) => {
        const say = line.kind === 'say';
        push({ kind: 'line', episode: e, beat: b, line: i, seq: line.seq,
               w0: beat.startMs + ((beat.endMs - beat.startMs) * i) / n,
               w1: beat.startMs + ((beat.endMs - beat.startMs) * (i + 1)) / n,
               typing: say ? TYPING_S * pace : 0,
               dur: say ? sayDuration(line.text, pace) : captionDuration(line.text, pace) });
      });
      if (!n) push({ kind: 'hold', episode: e, beat: b, seq: beat.lastSeq, w0: beat.startMs, w1: beat.endMs, dur: 2.6 * pace });
    });
    clock = Math.max(clock, episode.endMs);
  });
  push(mapSegment(clock, dayEndMs, null, episodes.length ? 1.4 : 1, errands));

  const seqAtMs = (ms: number) => {
    let seq = 0;
    for (const event of events) {
      if (event.simTimeMs <= ms) seq = event.seq;
      else break;
    }
    return seq;
  };

  const locate = (rt: number): Position => {
    const t = clamp(rt, 0, total);
    let lo = 0, hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segments[mid].r0 <= t) lo = mid; else hi = mid - 1;
    }
    const segment = segments[lo];
    const offset = clamp(t - segment.r0, 0, segment.dur);
    if (segment.kind === 'map') {
      const atMs = mapTime(segment, offset);
      return { index: lo, segment, offset, atMs, cursorSeq: seqAtMs(atMs) };
    }
    const atMs = segment.kind === 'lead' ? segment.w0
      : segment.w0 + (segment.w1 - segment.w0) * (segment.dur ? offset / segment.dur : 0);
    return { index: lo, segment, offset, atMs, cursorSeq: segment.seq };
  };

  const atTime = (ms: number) => {
    for (const s of segments) {
      if (s.kind === 'map' && ms >= s.w0 && ms <= s.w1) return s.r0 + mapOffset(s, ms);
      if (s.kind === 'lead' && s.w0 >= ms) return s.r0;
    }
    return total;
  };

  const atSeq = (seq: number) => {
    const line = segments.find((s) => s.kind === 'line' && s.seq >= seq
      && episodes[s.episode].beats[s.beat].firstSeq <= seq);
    if (line) return line.r0 + (line.kind === 'line' ? line.typing : 0);
    const event = events.find((x) => x.seq === seq);
    return event ? atTime(event.simTimeMs) : 0;
  };

  return { segments, total, episodes, dayStartMs, dayEndMs, locate, atTime, atSeq };
}

/** Whether somebody is travelling for a request at this moment. */
function errandsOf(timeline: Timeline | null) {
  const trips = Object.values(timeline?.actors ?? {}).flatMap((actor) =>
    actor.realized.filter((s) => s.origin === 'task' && s.kind === 'travel').map((s) => [s.startMs, s.endMs] as const));
  return (ms: number) => trips.some(([a, b]) => ms >= a && ms < b);
}

/** A map shot, integrated minute by minute so the playhead can be turned back
 *  into a clock time exactly. `next` is the scene it leads into, if any. */
function mapSegment(w0: number, w1: number, next: number | null, minDur: number,
                    errand: (ms: number) => boolean): Draft {
  const cum = [0];
  for (let m = w0; m < w1; m += MINUTE) {
    const rate = next !== null && next - m < 8 * MINUTE ? 6 : errand(m) ? 20 : 240;
    cum.push(cum[cum.length - 1] + Math.min(1, (w1 - m) / MINUTE) / rate);
  }
  const raw = cum[cum.length - 1];
  const scale = raw > 0 ? Math.max(1, minDur / raw) : 1;
  return { kind: 'map', w0, w1, cum: cum.map((c) => c * scale), dur: Math.max(minDur, raw) };
}

function mapTime(segment: Extract<Segment, { kind: 'map' }>, offset: number): number {
  const { cum, w0, w1 } = segment;
  let m = 0;
  while (m < cum.length - 2 && cum[m + 1] < offset) m += 1;
  const span = (cum[m + 1] ?? cum[m]) - cum[m];
  return Math.min(w1, w0 + (m + (span > 0 ? (offset - cum[m]) / span : 0)) * MINUTE);
}

function mapOffset(segment: Extract<Segment, { kind: 'map' }>, ms: number): number {
  const minutes = (ms - segment.w0) / MINUTE;
  const m = Math.min(Math.floor(minutes), segment.cum.length - 2);
  if (m < 0) return 0;
  return segment.cum[m] + ((segment.cum[m + 1] ?? segment.cum[m]) - segment.cum[m]) * (minutes - m);
}
