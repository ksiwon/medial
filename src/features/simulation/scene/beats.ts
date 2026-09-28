import type { DomainEvent, Timeline, ViewMode, VillagePayload } from '../api/types';
import { medialKnowledge, placeLabel, posesAt, type ActorPose } from '../positions';
import { personName, sentenceFor } from '../selectors/story';
import type { Beat, Episode, Frame, Pose, SceneLine } from './types';

// The day's log, cut into what the screen zooms into.
//
// A *beat* is a run of events of one request that show the same places and
// people - a call and its answer, a visit, a hand-off. An *episode* is a run of
// one request's beats with no silent stretch in between; the screen plays one
// episode at a time and goes back to the map for anything quiet. Everything is
// read off events: where someone is comes from the timeline (researcher view)
// or from what MEDial was told (MEDial's view), words from the payload, and an
// act without words is shown as the log's own sentence, never as speech.

/** A silence at least this long between two beats is a map shot, not a cut. */
export const MAP_GAP_MS = 3 * 60_000;

export const MEDIAL = 'MEDial';
const INSTITUTION_LABEL: Record<string, string> = { HC_NURSE: '보건소', EMS_DISPATCH: '119 상황실' };
const DEVICE: Record<string, string> = { home_device: '안내 시계', phone: '전화' };

interface Input {
  events: DomainEvent[];
  timeline: Timeline | null;
  village: VillagePayload;
  viewMode: ViewMode;
}

/** What one event puts on screen. `null` from `stageOf` means it only feeds the
 *  judgement panel (a decision, a classification) or is bookkeeping. */
interface Stage {
  frames: { place: string | null; who: string[]; device?: string; poses?: Record<string, Pose>; label?: string }[];
  speakers: string[];
  medial: boolean;
  waiting?: string;
  line: SceneLine | null;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

export function buildEpisodes({ events, timeline, village, viewMode }: Input): Episode[] {
  const shown = events.filter(
    (e) => e.correlationId && e.correlationId !== 'world' && !e.type.startsWith('world.')
      && (viewMode === 'researcher' || e.visibility.includes(MEDIAL)),
  );
  const where = locator(events, timeline, village, viewMode);
  const lying = emergencyWindows(shown);

  const beats: Beat[] = [];
  for (const event of shown) {
    const stage = stageOf(event, where);
    if (!stage) continue;
    const frames = mergeFrames(stage.frames.map((f) => ({
      key: f.place ?? `unknown:${f.who.join(',')}`,
      place: f.place,
      label: f.label ?? (f.place ? where.label(f.place) : '위치 모름'),
      device: f.device ?? null,
      who: f.who,
      poses: { ...f.poses },
    })));
    for (const frame of frames) {
      for (const id of frame.who) if (lying(id, event.seq)) frame.poses[id] = 'lying';
    }
    const last = beats[beats.length - 1];
    const same = last && last.requestId === event.correlationId
      && keyOf(last.frames) === keyOf(frames) && event.simTimeMs - last.endMs < MAP_GAP_MS;
    const beat: Beat = same ? last : {
      requestId: event.correlationId, firstSeq: event.seq, lastSeq: event.seq,
      startMs: event.simTimeMs, endMs: event.simTimeMs, frames, cast: [], medial: false,
      waiting: null, lines: [],
    };
    if (!same) beats.push(beat);
    beat.lastSeq = event.seq;
    beat.endMs = event.simTimeMs;
    beat.medial ||= stage.medial;
    beat.waiting ??= stage.waiting ?? null;
    for (const s of stage.speakers) if (!beat.cast.includes(s)) beat.cast.push(s);
    if (stage.line) beat.lines.push(stage.line);
  }
  for (const beat of beats) {
    if (beat.medial) beat.waiting = null;
    for (const frame of beat.frames) {
      for (const id of frame.who) frame.poses[id] ??= restingPose(frame, id, beat.cast);
    }
  }
  return episodesOf(beats, shown);
}

/** Someone in a frame who neither speaks nor acts is busy with what they were
 *  doing there - which is why they did not hear or did not pick up. */
function restingPose(frame: Frame, id: string, cast: string[]): Pose {
  if (frame.place?.startsWith('CAR:')) return frame.place === `CAR:${id}` ? 'drive' : 'seated';
  if (cast.includes(id)) return frame.device === DEVICE.phone ? 'phone' : 'stand';
  const base = frame.place?.split(':')[0];
  return base === 'FARM' || base === 'SEA' ? 'work' : 'stand';
}

const keyOf = (frames: Frame[]) => frames.map((f) => `${f.key}=${[...f.who].sort().join('+')}`).join('|');

function mergeFrames(frames: Frame[]): Frame[] {
  const out: Frame[] = [];
  for (const f of frames) {
    const same = out.find((o) => o.key === f.key);
    if (!same) { out.push({ ...f, who: [...f.who] }); continue; }
    for (const id of f.who) if (!same.who.includes(id)) same.who.push(id);
    same.device ??= f.device;
    same.poses = { ...same.poses, ...f.poses };
  }
  return out;
}

/** An emergency's subject is on the floor from the report until the hand-over. */
function emergencyWindows(events: DomainEvent[]) {
  const windows: { id: string; from: number; to: number }[] = [];
  for (const e of events) {
    if (e.type !== 'emergency.reported') continue;
    const end = events.find((x) => x.seq > e.seq && x.type === 'ems.handover' && x.correlationId === e.correlationId);
    const id = str(e.payload.subjectId);
    if (id) windows.push({ id, from: e.seq, to: end?.seq ?? Number.POSITIVE_INFINITY });
  }
  return (id: string, seq: number) => windows.some((w) => w.id === id && seq >= w.from && seq <= w.to);
}

// ---------------------------------------------------------------------------
// Where people are
// ---------------------------------------------------------------------------

interface Locator {
  /** Where this person is at this event, as the current view may know it. */
  of: (id: string, event: DomainEvent) => string | null;
  label: (place: string) => string;
}

function locator(events: DomainEvent[], timeline: Timeline | null, village: VillagePayload,
                 viewMode: ViewMode): Locator {
  const poses = new Map<number, Map<string, ActorPose>>();
  const poseAt = (ms: number) => {
    let row = poses.get(ms);
    if (!row) { row = new Map(posesAt(timeline, ms).map((p) => [p.id, p])); poses.set(ms, row); }
    return row;
  };
  return {
    of: (id, event) => {
      if (id in INSTITUTION_LABEL) return `INST:${id}`;
      if (viewMode === 'medial') return medialKnowledge(events, event.seq).get(id)?.place ?? null;
      const pose = poseAt(event.simTimeMs).get(id);
      if (!pose) return null;
      if (pose.moving && (pose.mode === 'drive' || pose.ridingWith)) return `CAR:${pose.ridingWith ?? id}`;
      if (pose.moving) return 'ROAD';
      if (pose.offMap) return 'TOWN';
      return pose.place;
    },
    label: (place) => {
      if (place.startsWith('INST:')) return INSTITUTION_LABEL[place.slice(5)] ?? place.slice(5);
      if (place.startsWith('CAR:')) return '차 안';
      if (place === 'ROAD') return '이동 중';
      return placeLabel(village, place) ?? '자택';
    },
  };
}

// ---------------------------------------------------------------------------
// What each event shows
// ---------------------------------------------------------------------------

/** The words the log carries for this event, or its sentence as a caption. */
function lineOf(event: DomainEvent, speaker: string): SceneLine | null {
  const p = event.payload;
  const words = str(p.utterance) ?? str(p.message) ?? (event.type === 'emergency.reported' ? str(p.report) : null);
  if (words) return { seq: event.seq, kind: 'say', speaker, text: words };
  const sentence = sentenceFor(event);
  return sentence ? { seq: event.seq, kind: 'caption', speaker, text: sentence.text } : null;
}

function stageOf(event: DomainEvent, where: Locator): Stage | null {
  const p = event.payload;
  const actor = event.actorId;
  const to = str(p.toActorId);
  const subject = str(p.subjectId);
  const at = (id: string) => where.of(id, event);
  const alone = (id: string, device?: string, poses?: Record<string, Pose>) => ({ place: at(id), who: [id], device, poses });

  switch (event.type) {
    case 'contact.attempted':
    case 'contact.no_response':
    case 'contact.answered': {
      if (!to) return null;
      const device = DEVICE[String(p.channel)];
      const answered = event.type === 'contact.answered';
      const frames = p.channel === 'home_device'
        ? [{ place: `HOME:${to}`, who: [], device }, { place: at(to), who: [to] }]
        : [alone(to, device, answered && device === DEVICE.phone ? { [to]: 'phone' } : undefined)];
      return { frames, speakers: answered ? [MEDIAL, to] : [MEDIAL], medial: true,
               line: lineOf(event, answered ? to : MEDIAL) };
    }
    case 'transport.need_raised':
      return { frames: [alone(actor)], speakers: [actor], medial: true, line: lineOf(event, actor) };
    case 'request.offered':
      if (!to) return null;
      return { frames: [alone(to)], speakers: [MEDIAL], medial: true, line: lineOf(event, MEDIAL) };
    case 'request.accepted':
    case 'request.declined':
    case 'request.deferred':
    case 'medial.observed':
      return { frames: [alone(actor)], speakers: [actor], medial: true, line: lineOf(event, actor) };
    case 'request.relayed':
      return { frames: [alone(actor), ...(to ? [alone(to)] : [])], speakers: [actor], medial: false,
               waiting: `${personName(actor)}의 확인 결과 대기 중`, line: lineOf(event, actor) };
    case 'task.check_performed': {
      const place = str(p.place) ?? at(actor);
      const found = str(p.outcome) === 'subject_found_well' && subject;
      return { frames: [{ place, who: found ? [actor, subject] : [actor] }], speakers: [actor], medial: false,
               waiting: `${personName(subject)} 확인 결과 대기 중`, line: lineOf(event, actor) };
    }
    case 'task.started':
      if (p.task !== 'stay_with' || !subject) return null;
      return { frames: [{ place: str(p.place) ?? at(actor), who: [actor, subject] }], speakers: [actor],
               medial: false, waiting: '구급대 도착 대기 중', line: null };
    case 'emergency.reported': {
      const place = str(p.place);
      const reporter = str(p.reporterId) ?? actor;
      const frames = [alone(reporter, DEVICE[String(p.channel)], { [reporter]: 'phone' }),
                      ...(subject ? [{ place, who: [subject] }] : [])];
      return { frames, speakers: [reporter], medial: true, line: lineOf(event, reporter) };
    }
    case 'handoff.requested':
      if (!to) return null;
      return { frames: [{ place: at(to), who: [to], device: '기관 회선', poses: { [to]: 'desk' } }],
               speakers: [MEDIAL], medial: true, line: lineOf(event, MEDIAL) };
    case 'handoff.accepted':
    case 'ems.dispatched':
      return { frames: [{ place: at(actor), who: [actor], device: '기관 회선', poses: { [actor]: 'desk' } }],
               speakers: [actor], medial: true, line: lineOf(event, actor) };
    case 'institution.report_sent':
      return { frames: [{ place: 'INST:HC_NURSE', who: ['HC_NURSE'], device: '기관 회선', poses: { HC_NURSE: 'desk' } }],
               speakers: [MEDIAL], medial: true, line: lineOf(event, MEDIAL) };
    case 'institution.report_reviewed':
    case 'institution.queued':
    case 'institution.review_started':
    case 'institution.review_completed':
      return { frames: [{ place: 'INST:HC_NURSE', who: ['HC_NURSE'], device: '기관 회선', poses: { HC_NURSE: 'desk' } }],
               speakers: ['HC_NURSE'], medial: event.type === 'institution.report_reviewed',
               waiting: '보건소 검토 대기 중', line: lineOf(event, 'HC_NURSE') };
    case 'ems.arrived':
    case 'ems.handover': {
      const place = str(p.place) ?? (subject ? at(subject) : null);
      return { frames: [{ place, who: ['EMS_CREW', ...(subject ? [subject] : [])] }], speakers: ['EMS_CREW'],
               medial: false, waiting: '구급대 인계 대기 중', line: lineOf(event, 'EMS_CREW') };
    }
    case 'transport.pickup':
    case 'transport.dropoff': {
      const driver = str(p.driverId) ?? actor;
      const rider = str(p.riderId);
      // The car is filmed from the windscreen looking back, so the driver's seat
      // (the left one in a Korean car) is on the right of the frame: rider first.
      return { frames: [{ place: `CAR:${driver}`, who: rider ? [rider, driver] : [driver],
                          poses: { [driver]: 'drive', ...(rider ? { [rider]: 'seated' } : {}) } }],
               speakers: [driver], medial: false, waiting: `${personName(rider)} 이동 중`, line: lineOf(event, driver) };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Episodes
// ---------------------------------------------------------------------------

function episodesOf(beats: Beat[], events: DomainEvent[]): Episode[] {
  const byRequest = new Map<string, Beat[]>();
  for (const beat of beats) byRequest.set(beat.requestId, [...(byRequest.get(beat.requestId) ?? []), beat]);

  const episodes: Episode[] = [];
  for (const [requestId, rows] of byRequest) {
    const subjectId = subjectOf(requestId, events);
    const title = titleOf(requestId, subjectId, events);
    let current: Episode | null = null;
    for (const beat of rows) {
      if (!current || beat.startMs - current.endMs >= MAP_GAP_MS) {
        current = { requestId, subjectId, title, firstOfRequest: current === null, startMs: beat.startMs,
                    endMs: beat.endMs, beats: [] };
        episodes.push(current);
      }
      // Two beats of one request split only by another request's beat are one
      // beat again once the episode plays on its own.
      const last = current.beats[current.beats.length - 1];
      if (last && keyOf(last.frames) === keyOf(beat.frames) && last.medial === beat.medial) {
        last.lastSeq = beat.lastSeq;
        last.endMs = beat.endMs;
        last.lines.push(...beat.lines);
        for (const s of beat.cast) if (!last.cast.includes(s)) last.cast.push(s);
      } else {
        current.beats.push(beat);
      }
      current.endMs = Math.max(current.endMs, beat.endMs);
    }
  }
  // One at a time, in the order they began. When one begins while another is
  // still going, it waits its turn and the clock steps back to its start.
  return episodes.sort((a, b) => a.startMs - b.startMs || a.beats[0].firstSeq - b.beats[0].firstSeq);
}

function subjectOf(requestId: string, events: DomainEvent[]): string | null {
  for (const e of events) {
    if (e.correlationId !== requestId) continue;
    const id = str(e.payload.subjectId) ?? str(e.payload.riderId);
    if (id) return id;
  }
  return requestId.split(/[-_]/).find((part) => /^[A-Z]+\d+$/.test(part)) ?? null;
}

/** A request's name, told apart from the other requests of the same person. */
function titleOf(requestId: string, subjectId: string | null, events: DomainEvent[]): string {
  if (requestId === 'report') return '보건소에 하루 보고';
  const types = new Set(events.filter((e) => e.correlationId === requestId).map((e) => e.type));
  const who = personName(subjectId);
  if (types.has('emergency.reported')) return `${who} 위급`;
  if (types.has('transport.need_raised')) return `${who} 이동 지원`;
  if ([...types].every((t) => t.startsWith('contact.'))) return `${who} 정기 안부 연락`;
  return `${who} 안부 확인`;
}
