"""Baseline day, realized day, and where everybody actually is.

Three plan layers are kept apart, as doc 02 requires:

* ``baseline``  - what the resident would do if nothing happened today.
* ``realized``  - the baseline with accepted tasks spliced in and the rest
                  re-planned around them.
* ``history``   - the segments that have already been executed, i.e. the part of
                  ``realized`` behind the simulation clock.

An actor never teleports: a diversion truncates the realized plan at the moment
of acceptance, inserts travel segments computed from the road graph, and then
computes a fresh route back onto whatever the baseline says next.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from .village import Village

MIN_MS = 60_000

# Which baseline activities may be interrupted by a coordination task.
# This is a researcher assumption, not something the interviews establish; it is
# surfaced through ``INTERRUPTIBILITY_PROVENANCE`` wherever it is reported.
#: Where a person staying put could break off and go somewhere else. Moved to
#: ``EnvironmentRevision.availability`` so that the rule travels with the attempt
#: and can be revised without silently changing what stored runs meant. This is
#: the fallback used when no environment is supplied - a plain WorldState built
#: for geometry questions in a test, say - and it reproduces ``env-v1``.
FALLBACK_AVAILABLE_PLACES = {"PATROL", "HALL", "FARM"}
LOCKED_PLACES = {"FOOD", "PORT", "SEA", "TOWN", "EXP", "MIGA"}
INTERRUPTIBILITY_PROVENANCE = "researcher-assumption"

OFF_MAP_PLACES = {"TOWN"}
BOAT_PLACES = {"SEA"}


@dataclass
class Segment:
    start_ms: int
    end_ms: int
    kind: str                      # stay | travel | patrol
    origin: str                    # baseline | task
    label: str
    place: str | None = None
    from_place: str | None = None
    to_place: str | None = None
    mode: str = "stay"             # walk | drive | boat | offmap | stay
    metres: float = 0.0
    polyline: list[list[float]] = field(default_factory=list)
    request_id: str | None = None
    #: Passengers aboard this vehicle for this leg. Empty for everything that is
    #: not somebody driving somebody else.
    riders: list[str] = field(default_factory=list)

    def clone(self, **overrides: Any) -> "Segment":
        """A copy that shares no mutable list with the original.

        ``Segment(**s.__dict__)`` looks like a copy but hands the new segment the
        *same* ``riders`` list. Two actors then share one passenger list, and
        appending a rider to a driver's leg silently also makes the passenger
        carry themselves. ``polyline`` is treated as read-only geometry and may
        be shared; ``riders`` is state and never is.
        """
        data = dict(self.__dict__)
        data["riders"] = list(self.riders)
        data.update(overrides)
        return Segment(**data)

    def interruptible_under(self, environment: Any | None = None) -> bool:
        """Whether this person could be asked to break off, right here.

        The first three answers are structural and belong to the segment: work
        already taken on is not dropped, a patrol is a loop that can absorb a
        detour, and somebody on the road is on the road. Only the last one - can
        you leave *this place* - is a rule about the world, and that is the one
        the environment owns.
        """
        if self.origin == "task":
            return False
        if self.kind == "patrol":
            return True
        if self.kind == "travel":
            return False
        place = self.place or ""
        if environment is None:
            return place in FALLBACK_AVAILABLE_PLACES
        return environment.available(place).available

    def as_dict(self, with_polyline: bool = False,
                environment: Any | None = None) -> dict[str, Any]:
        out = {
            "startMs": self.start_ms,
            "endMs": self.end_ms,
            "kind": self.kind,
            "origin": self.origin,
            "label": self.label,
            "place": self.place,
            "fromPlace": self.from_place,
            "toPlace": self.to_place,
            "mode": self.mode,
            "metres": round(self.metres, 1),
            "requestId": self.request_id,
            "interruptible": self.interruptible_under(environment),
            "riders": list(self.riders),
        }
        if with_polyline and self.polyline:
            out["polyline"] = [[round(p[0], 1), round(p[1], 1)] for p in self.polyline]
        return out


def _resolve_place(step_kind: str, target: str, actor_id: str) -> str:
    if step_kind == "go_to_home_of":
        return "HOME:" + target
    if step_kind == "ride_with":
        raise ValueError("ride_with steps belong to the task overlay, not the baseline")
    if target == "HOME":
        return "HOME:" + actor_id
    return target


def leg(village: Village, actor_id: str, start_ms: int, origin_place: str, dest_place: str,
        drive: bool, fixed_minutes: float | None, origin: str, label: str,
        request_id: str | None = None) -> Segment:
    """One movement, priced from the road graph unless the source fixed it."""
    if origin_place == dest_place:
        return Segment(start_ms, start_ms, "stay", origin, label, place=dest_place)

    off_map = origin_place in OFF_MAP_PLACES or dest_place in OFF_MAP_PLACES
    by_boat = origin_place in BOAT_PLACES or dest_place in BOAT_PLACES

    a = village.position_of_place(origin_place)
    b = village.position_of_place(dest_place)

    if off_map:
        duration = village.off_map_town_ms()
        metres = math.nan
        mode = "offmap"
        # Leaving the village is not a straight line out of one's own yard: you
        # take the road to where it leaves the map, and only then are you off
        # it. The clock is still the source's fixed 30 minutes to town - only
        # the line the map draws changes.
        polyline = village.off_map_polyline(origin_place, dest_place, actor_id)
    elif by_boat:
        metres = math.hypot(a[0] - b[0], a[1] - b[1]) * village.geometry["frame"]["mPerPx"]
        duration = max(2 * MIN_MS, int(metres / village.travel["boatMPerMin"] * MIN_MS))
        mode = "boat"
        polyline = [list(a), list(b)]
    else:
        route = village.path_between(origin_place, dest_place, actor_id)
        if route is None:
            raise ValueError("no road route between %s and %s" % (origin_place, dest_place))
        polyline, metres = route
        mode = "drive" if drive else "walk"
        duration = village.travel_ms(metres, mode)

    if fixed_minutes is not None:
        duration = int(round(fixed_minutes * MIN_MS))

    return Segment(start_ms, start_ms + duration, "travel", origin, label,
                   from_place=origin_place, to_place=dest_place, mode=mode,
                   metres=0.0 if math.isnan(metres) else metres,
                   polyline=polyline, request_id=request_id)


def build_baseline(village: Village, resident: dict[str, Any], horizon_ms: int) -> list[Segment]:
    actor_id = resident["id"]
    steps = resident["plan"]["baseline"]
    segments: list[Segment] = []
    if not steps:
        return segments

    current = _resolve_place(steps[0]["targetKind"], steps[0]["target"], actor_id)
    cursor = int(steps[0]["departMs"])

    for step in steps[1:]:
        depart = int(step["departMs"])
        if depart > cursor:
            segments.append(Segment(cursor, depart, "stay", "baseline",
                                    _stay_label(current), place=current))
        target = step["target"]
        if target == "PATROL":
            # The patrol runs until the next step departs; it is a loop, so the
            # actor ends where it started.
            nxt = _next_depart(steps, step, horizon_ms)
            segments.append(Segment(depart, nxt, "patrol", "baseline", "마을 순찰",
                                    place="PATROL", polyline=village.patrol))
            cursor = nxt
            continue
        dest = _resolve_place(step["targetKind"], target, actor_id)
        travel = leg(village, actor_id, depart, current, dest, step.get("car", False),
                     step.get("fixedDurationMin"), "baseline", "이동")
        if travel.kind == "travel":
            segments.append(travel)
            cursor = travel.end_ms
        else:
            cursor = depart
        current = dest

    if cursor < horizon_ms:
        segments.append(Segment(cursor, horizon_ms, "stay", "baseline",
                                _stay_label(current), place=current))
    return segments


def _next_depart(steps: list[dict[str, Any]], step: dict[str, Any], horizon_ms: int) -> int:
    idx = steps.index(step)
    if idx + 1 < len(steps):
        return int(steps[idx + 1]["departMs"])
    return horizon_ms


_STAY_LABELS = {
    "FARM": "밭일", "PORT": "항구", "SEA": "조업", "FOOD": "마을식품 근무",
    "HALL": "마을회관", "MIGA": "가게", "EXP": "어촌체험마을", "TOWN": "읍내",
    "TOWNEXIT": "읍내 방향",
}


def _stay_label(place: str) -> str:
    if place.startswith("HOME:"):
        return "자택"
    return _STAY_LABELS.get(place, place)


def place_at(segments: list[Segment], t_ms: int) -> tuple[str, Segment | None]:
    """Where the actor is, and which segment says so."""
    for seg in segments:
        if seg.start_ms <= t_ms < seg.end_ms:
            if seg.kind == "stay":
                return (seg.place or "UNKNOWN", seg)
            if seg.kind == "patrol":
                return ("PATROL", seg)
            return ("EN_ROUTE", seg)
    if segments and t_ms >= segments[-1].end_ms:
        last = segments[-1]
        return (last.place or last.to_place or "UNKNOWN", last)
    return ("UNKNOWN", None)


def position_at(village: Village, segments: list[Segment], t_ms: int) -> tuple[float, float]:
    place, seg = place_at(segments, t_ms)
    if seg is None:
        return (0.0, 0.0)
    if seg.kind == "stay":
        return village.position_of_place(seg.place or "HALL")
    if seg.kind == "patrol":
        span = max(1, seg.end_ms - seg.start_ms)
        return village.patrol_position((t_ms - seg.start_ms) / span)
    span = max(1, seg.end_ms - seg.start_ms)
    return _along(seg.polyline, (t_ms - seg.start_ms) / span)


def _along(polyline: list[list[float]], fraction: float) -> tuple[float, float]:
    if not polyline:
        return (0.0, 0.0)
    if len(polyline) == 1:
        return (polyline[0][0], polyline[0][1])
    cum = [0.0]
    for a, b in zip(polyline, polyline[1:]):
        cum.append(cum[-1] + math.hypot(a[0] - b[0], a[1] - b[1]))
    total = cum[-1]
    if total <= 0:
        return (polyline[0][0], polyline[0][1])
    target = max(0.0, min(1.0, fraction)) * total
    for i in range(1, len(cum)):
        if cum[i] >= target:
            seg_len = cum[i] - cum[i - 1]
            t = 0.0 if seg_len == 0 else (target - cum[i - 1]) / seg_len
            a, b = polyline[i - 1], polyline[i]
            return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    last = polyline[-1]
    return (last[0], last[1])


@dataclass
class ActorRuntime:
    actor_id: str
    baseline: list[Segment]
    realized: list[Segment]
    plan_changes: list[dict[str, Any]] = field(default_factory=list)
    contacts_received: int = 0
    #: Split from ``contacts_received`` on purpose. When a neighbour hands work
    #: along, MEDial's ledger says it asked one person while three were actually
    #: involved, and "MEDial reduced the burden" is false. One counter could not
    #: show that.
    asked_by_medial: int = 0
    asked_by_neighbour: int = 0
    task_ms: int = 0
    task_metres: float = 0.0
    interruptions: int = 0

    def place_at(self, t_ms: int) -> str:
        return place_at(self.realized, t_ms)[0]

    def segment_at(self, t_ms: int) -> Segment | None:
        return place_at(self.realized, t_ms)[1]

    def is_interruptible_at(self, t_ms: int, environment: Any | None = None) -> bool:
        seg = self.segment_at(t_ms)
        return bool(seg and seg.interruptible_under(environment))


class WorldState:
    """Ground truth. Only the engine and the researcher view may read this."""

    def __init__(self, village: Village, horizon_ms: int):
        self.village = village
        self.horizon_ms = horizon_ms
        self.actors: dict[str, ActorRuntime] = {}
        for resident in village.residents:
            baseline = build_baseline(village, resident, horizon_ms)
            self.actors[resident["id"]] = ActorRuntime(
                actor_id=resident["id"],
                baseline=baseline,
                realized=[s.clone() for s in baseline],
            )

    # -- queries -------------------------------------------------------
    def actors_at(self, place: str, t_ms: int, exclude: str | None = None) -> list[str]:
        """Who else is standing there right now.

        Ground truth, and therefore researcher-only when it is published. MEDial
        has no sensor in the village; a resident knows it because they are there.
        """
        return sorted(
            actor_id for actor_id in self.actors
            if actor_id != exclude and self.place_of(actor_id, t_ms) == place)

    def place_of(self, actor_id: str, t_ms: int) -> str:
        return self.actors[actor_id].place_at(t_ms)

    def position_of(self, actor_id: str, t_ms: int) -> tuple[float, float]:
        return position_at(self.village, self.actors[actor_id].realized, t_ms)

    def is_at_own_home(self, actor_id: str, t_ms: int) -> bool:
        return self.place_of(actor_id, t_ms) == "HOME:" + actor_id

    def co_located(self, t_ms: int) -> dict[str, list[str]]:
        groups: dict[str, list[str]] = {}
        for actor_id in self.actors:
            groups.setdefault(self.place_of(actor_id, t_ms), []).append(actor_id)
        return groups

    # -- mutation ------------------------------------------------------
    def divert(self, actor_id: str, from_ms: int, task_segments: list[Segment],
               reason: str) -> dict[str, Any]:
        """Splice a task into the realized plan and re-plan the way back."""
        actor = self.actors[actor_id]
        kept = [s for s in actor.realized if s.end_ms <= from_ms]
        cut = [s for s in actor.realized if s.start_ms < from_ms < s.end_ms]
        for seg in cut:
            kept.append(Segment(seg.start_ms, from_ms, seg.kind, seg.origin, seg.label,
                                place=seg.place, from_place=seg.from_place,
                                to_place=seg.to_place, mode=seg.mode, metres=seg.metres,
                                polyline=seg.polyline, request_id=seg.request_id))

        kept.extend(task_segments)
        end_ms = task_segments[-1].end_ms if task_segments else from_ms
        end_place = _end_place(task_segments, from_ms, actor)

        resume = self._resume(actor, end_ms, end_place)
        kept.extend(resume)
        actor.realized = kept
        actor.interruptions += 1
        actor.task_ms += sum(s.end_ms - s.start_ms for s in task_segments)
        actor.task_metres += sum(s.metres for s in task_segments if s.kind == "travel")
        change = {
            "fromMs": from_ms,
            "reason": reason,
            "insertedSegments": [s.as_dict() for s in task_segments],
            "resumeSegments": [s.as_dict() for s in resume],
        }
        actor.plan_changes.append(change)
        return change

    def _resume(self, actor: ActorRuntime, at_ms: int, at_place: str) -> list[Segment]:
        """Get back onto the baseline: travel to wherever the baseline says the
        actor should be, then follow the remaining baseline segments."""
        target_place, _ = place_at(actor.baseline, at_ms)
        if target_place in ("EN_ROUTE", "UNKNOWN", "PATROL"):
            # The baseline has the actor moving or patrolling; rejoin at the next
            # stationary baseline segment instead of guessing a midpoint.
            future = [s for s in actor.baseline if s.start_ms >= at_ms and s.kind == "stay"]
            if not future:
                return [Segment(at_ms, self.horizon_ms, "stay", "baseline",
                                _stay_label(at_place), place=at_place)]
            target_place = future[0].place or at_place

        out: list[Segment] = []
        cursor = at_ms
        if target_place != at_place:
            back = leg(self.village, actor.actor_id, cursor, at_place, target_place,
                       False, None, "baseline", "일과 복귀")
            out.append(back)
            cursor = back.end_ms
        tail = [s for s in actor.baseline if s.start_ms >= cursor]
        if tail:
            first = tail[0]
            if cursor < first.start_ms:
                out.append(Segment(cursor, first.start_ms, "stay", "baseline",
                                   _stay_label(target_place), place=target_place))
            out.extend(s.clone() for s in tail)
        else:
            out.append(Segment(cursor, self.horizon_ms, "stay", "baseline",
                               _stay_label(target_place), place=target_place))
        return out


def _end_place(task_segments: list[Segment], from_ms: int, actor: ActorRuntime) -> str:
    for seg in reversed(task_segments):
        if seg.to_place:
            return seg.to_place
        if seg.place:
            return seg.place
    return actor.place_at(from_ms)
