import { placeWord } from './selectors/story';
import type { DomainEvent, Segment, Timeline, TimelineActor, VillagePayload } from './api/types';

// Position interpolation for the map. This mirrors the server snapshot endpoint
// (server/app/simulation/service.py) so animation stays smooth without a request
// per frame; the server version is what the tests check, and requestAnimationFrame
// here only interpolates - it never decides anything.

export interface ActorPose {
  id: string;
  displayName: string;
  isVillageHead: boolean;
  group: string;
  x: number;
  y: number;
  place: string | null;
  activity: string;
  baselineActivity: string;
  moving: boolean;
  mode: Segment['mode'];
  onTask: boolean;
  requestId: string | null;
  offMap: boolean;
  divergesFromBaseline: boolean;
  /** Riders sharing this vehicle at this moment, for the seat marker. */
  riders: string[];
  ridingWith: string | null;
}

export function segmentAt(segments: Segment[], atMs: number): Segment | null {
  for (const seg of segments) {
    if (seg.startMs <= atMs && atMs < seg.endMs) return seg;
  }
  if (segments.length && atMs >= segments[segments.length - 1].endMs) {
    return segments[segments.length - 1];
  }
  return segments[0] ?? null;
}

function along(polyline: [number, number][], fraction: number): [number, number] {
  if (polyline.length === 1) return polyline[0];
  const cum = [0];
  for (let i = 1; i < polyline.length; i += 1) {
    const [ax, ay] = polyline[i - 1];
    const [bx, by] = polyline[i];
    cum.push(cum[i - 1] + Math.hypot(ax - bx, ay - by));
  }
  const total = cum[cum.length - 1];
  if (total <= 0) return polyline[0];
  const target = Math.max(0, Math.min(1, fraction)) * total;
  for (let i = 1; i < cum.length; i += 1) {
    if (cum[i] >= target) {
      const segLen = cum[i] - cum[i - 1];
      const t = segLen === 0 ? 0 : (target - cum[i - 1]) / segLen;
      const [ax, ay] = polyline[i - 1];
      const [bx, by] = polyline[i];
      return [ax + (bx - ax) * t, ay + (by - ay) * t];
    }
  }
  return polyline[polyline.length - 1];
}

function poseFor(actor: TimelineActor, atMs: number): ActorPose {
  const realized = segmentAt(actor.realized, atMs);
  const baseline = segmentAt(actor.baseline, atMs);

  let x = actor.homeXY[0];
  let y = actor.homeXY[1];
  if (realized) {
    if ((realized.kind === 'travel' || realized.kind === 'patrol') && realized.polyline?.length) {
      const span = Math.max(1, realized.endMs - realized.startMs);
      [x, y] = along(realized.polyline, (atMs - realized.startMs) / span);
    } else if (realized.xy) {
      [x, y] = realized.xy;
    } else if (realized.polyline?.length) {
      [x, y] = realized.polyline[0];
    }
  }

  const place = realized ? (realized.place ?? realized.toPlace) : null;
  const offMap =
    realized != null &&
    (realized.place === 'TOWN' || (realized.kind === 'travel' && realized.toPlace === 'TOWN'));

  return {
    id: actor.id,
    displayName: actor.displayName,
    isVillageHead: actor.isVillageHead,
    group: actor.group,
    x,
    y,
    place,
    activity: realized?.label ?? '알 수 없음',
    baselineActivity: baseline?.label ?? '알 수 없음',
    moving: realized?.kind === 'travel',
    mode: realized?.mode ?? 'stay',
    onTask: realized?.origin === 'task',
    requestId: realized?.requestId ?? null,
    offMap,
    divergesFromBaseline: Boolean(realized && baseline && realized.label !== baseline.label),
    riders: realized?.riders ?? [],
    ridingWith: null,
  };
}

export function posesAt(timeline: Timeline | null, atMs: number): ActorPose[] {
  if (!timeline) return [];
  const poses = Object.values(timeline.actors)
    .map((actor) => poseFor(actor, atMs))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  // A passenger is not driving. Mark who is in whose car so the map can show one
  // vehicle carrying two people instead of two people who happen to coincide.
  const byId = new Map(poses.map((p) => [p.id, p]));
  for (const pose of poses) {
    for (const rider of pose.riders) {
      const passenger = byId.get(rider);
      if (passenger) passenger.ridingWith = pose.id;
    }
  }
  return poses;
}

// ---------------------------------------------------------------------------
// The 'MEDial이 아는 것' projection.
// ---------------------------------------------------------------------------

export interface MedialKnown {
  actorId: string;
  place: string | null;
  atMs: number;
  basis: string;
  confidence: 'observed' | 'reported';
  outcome?: string;
}

/** Where MEDial believes each person is, built only from events addressed to it.
 *
 * This is not a filtered view of the truth: MEDial holds a place for somebody
 * only when an event it could actually read carried one. Everyone else is
 * "위치 미확인", which is the honest answer and usually most of the village.
 */
export function medialKnowledge(events: DomainEvent[], cursorSeq: number): Map<string, MedialKnown> {
  const known = new Map<string, MedialKnown>();
  const put = (row: MedialKnown) => known.set(row.actorId, row);

  for (const event of events) {
    if (event.seq > cursorSeq) break;
    if (!event.visibility.includes('MEDial')) continue;
    const p = event.payload as Record<string, string | undefined>;

    switch (event.type) {
      case 'task.travel_started':
        put({
          actorId: event.actorId,
          place: null,
          atMs: event.simTimeMs,
          basis: `${p.to ?? '목적지'}(으)로 이동 중이라고 보고받음`,
          confidence: 'observed',
        });
        break;
      case 'task.travel_arrived':
        put({
          actorId: event.actorId,
          place: p.place ?? null,
          atMs: event.simTimeMs,
          basis: '도착 보고',
          confidence: 'observed',
        });
        break;
      case 'task.check_performed':
        put({
          actorId: event.actorId,
          place: p.place ?? null,
          atMs: event.simTimeMs,
          basis: '확인 수행 보고',
          confidence: 'observed',
        });
        if (p.subjectId) {
          put({
            actorId: p.subjectId,
            place: p.outcome === 'subject_found_well' ? (p.place ?? null) : null,
            atMs: event.simTimeMs,
            basis:
              p.outcome === 'subject_found_well'
                ? '그 장소에서 확인됨'
                : '그 장소에는 없었음. 어디 있는지는 여전히 미확인',
            confidence: 'observed',
            outcome: p.outcome,
          });
        }
        break;
      case 'medial.observed':
        if (p.subjectId && p.suggestedPlace) {
          put({
            actorId: p.subjectId,
            place: p.suggestedPlace,
            atMs: event.simTimeMs,
            basis: '이장이 평소 일과를 근거로 추정해 알려줌',
            confidence: 'reported',
          });
        }
        break;
      case 'transport.pickup':
      case 'transport.dropoff':
        for (const who of [p.riderId, p.driverId]) {
          if (who) {
            put({
              actorId: who,
              place: p.place ?? null,
              atMs: event.simTimeMs,
              basis: event.type === 'transport.pickup' ? '픽업 보고' : '하차 보고',
              confidence: 'observed',
            });
          }
        }
        break;
      default:
        break;
    }
  }
  return known;
}

/** Place a MEDial-known actor on the map, using the registry coordinate for the
 *  place they were last reported at. Nothing is interpolated: MEDial does not
 *  watch anyone move. */
export function medialPoses(
  known: Map<string, MedialKnown>,
  village: VillagePayload,
  all: ActorPose[],
): { located: ActorPose[]; unlocated: { pose: ActorPose; row: MedialKnown | null }[] } {
  const located: ActorPose[] = [];
  const unlocated: { pose: ActorPose; row: MedialKnown | null }[] = [];

  for (const pose of all) {
    const row = known.get(pose.id) ?? null;
    const xy = row?.place ? placeXY(village, row.place) : null;
    if (row && xy) {
      located.push({
        ...pose,
        x: xy[0],
        y: xy[1],
        place: row.place,
        activity: row.basis,
        moving: false,
        mode: 'stay',
        riders: [],
        ridingWith: null,
        offMap: row.place === 'TOWN',
      });
    } else {
      unlocated.push({ pose, row });
    }
  }
  return { located, unlocated };
}

/**
 * A place id as a place a reader knows.
 *
 * Ids like `FARM`, `SEA`, `HOME:P6` are the world's own keys. The map has always
 * shown the label; the people board printed the key, so a row read "자택 ·
 * HOME:P6" - an internal identifier in the same line as a person's name.
 * `viewerId` is whose day is being read, so their own home is just 자택 and
 * somebody else's is named.
 */
export function placeLabel(
  village: VillagePayload,
  place: string | null | undefined,
  viewerId?: string | null,
): string | null {
  if (!place) return null;
  const home = /^HOME:(.+)$/.exec(place);
  if (home) return home[1] === viewerId ? null : `${home[1]}의 집`;
  // PATROL is a route, not a registry place, so it has no label of its own;
  // the board printed the key beside 마을 순찰.
  return village.places[place]?.label ?? placeWord(place);
}

export function placeXY(village: VillagePayload, place: string): [number, number] | null {
  if (place.startsWith('HOME:')) {
    const home = village.homes[place.slice(5)];
    return home ? [home.x, home.y] : null;
  }
  const known = village.places[place];
  return known ? [known.x, known.y] : null;
}

export interface Cluster {
  key: string;
  x: number;
  y: number;
  members: ActorPose[];
  /** Why these people are one marker: the same building, or the same car. */
  reason: 'place' | 'vehicle' | 'alone';
  placeId: string | null;
}

/**
 * Group people who are actually together.
 *
 * Together means one of two facts the engine recorded: they are at the same
 * named place, or they are in the same vehicle. It deliberately does *not* mean
 * "their dots landed near each other" - the old distance test grouped whoever
 * happened to be within seven map units, so two neighbours walking past each
 * other became a group, and zooming changed who was in it. Overlapping marks
 * are a drawing problem and are solved in screen space by the map; who is with
 * whom is a fact and is settled here.
 */
export function clusterPoses(poses: ActorPose[]): Cluster[] {
  const groups = new Map<string, Cluster>();

  for (const pose of poses) {
    if (pose.offMap) continue;

    // A car and its passengers are one marker with one vehicle on it.
    const vehicle = pose.ridingWith ?? (pose.riders.length > 0 ? pose.id : null);
    const key = vehicle
      ? `vehicle:${vehicle}`
      : pose.place && !pose.moving
        ? `place:${pose.place}`
        : `alone:${pose.id}`;

    const found = groups.get(key);
    if (found) {
      found.members.push(pose);
    } else {
      groups.set(key, {
        key,
        x: pose.x,
        y: pose.y,
        members: [pose],
        reason: vehicle ? 'vehicle' : pose.place && !pose.moving ? 'place' : 'alone',
        placeId: pose.place,
      });
    }
  }

  for (const cluster of groups.values()) {
    // The anchor is the mean of the people in it, which for a shared place is
    // the place itself and for a car is where the car is.
    cluster.x = cluster.members.reduce((sum, m) => sum + m.x, 0) / cluster.members.length;
    cluster.y = cluster.members.reduce((sum, m) => sum + m.y, 0) / cluster.members.length;
    cluster.members.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }

  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Push overlapping markers apart in *screen* pixels, leaving each one's true
 * anchor untouched so the map can draw a leader line back to it.
 *
 * Purely cosmetic and deliberately separate from `clusterPoses`: moving a mark
 * so it can be read must never change who is standing with whom.
 */
export function spreadOverlaps<T extends { key: string; left: number; top: number }>(
  marks: T[],
  minGap: number,
): Map<string, { left: number; top: number; moved: boolean }> {
  const placed: { key: string; left: number; top: number }[] = [];
  const out = new Map<string, { left: number; top: number; moved: boolean }>();

  // Stable order: same input, same layout, so a re-render does not reshuffle.
  for (const mark of [...marks].sort((a, b) => a.top - b.top || a.key.localeCompare(b.key))) {
    let { left, top } = mark;
    for (let guard = 0; guard < 24; guard += 1) {
      const hit = placed.find((p) => Math.hypot(p.left - left, p.top - top) < minGap);
      if (!hit) break;
      // Walk outward along the line away from the mark we collided with.
      const dx = left - hit.left;
      const dy = top - hit.top || (dx === 0 ? 1 : 0);
      const length = Math.hypot(dx, dy) || 1;
      left = hit.left + (dx / length) * minGap;
      top = hit.top + (dy / length) * minGap;
    }
    placed.push({ key: mark.key, left, top });
    out.set(mark.key, {
      left,
      top,
      moved: Math.hypot(left - mark.left, top - mark.top) > 1,
    });
  }
  return out;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
