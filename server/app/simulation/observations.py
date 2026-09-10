"""Who is allowed to know what.

The engine holds ground truth. Every other actor - MEDial included - only ever
sees a ``DomainEvent`` that names it in ``visibility``, and only ever reads the
``Observation`` rows derived from those events.

Beyond its observations, MEDial holds one standing thing: a *shared routine* per
resident. That used to be the whole baseline plan, place ids and all, which
contradicted the story the rest of the system tells - that the village head knows
P1 is out in the field and MEDial does not. So the routine is now projected per
holder:

* MEDial receives ``home_or_away`` windows: whether the resident is usually home,
  never where they are when they are not;
* the village head holds ``place_level`` windows as *his own* memory, and MEDial
  acquires a place only when he chooses to report one.

Consent is recorded rather than assumed silently. The interviews describe a
support worker phoning and the village head checking; they do not record anyone
agreeing to a coordination system holding their day, so the status is
``assumed`` and every screen that shows the routine says so.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

from .contracts import (
    MEDIAL,
    RESEARCHER,
    WORLD_TRUTH_EVENTS,
    ConsentStatus,
    DomainEvent,
    Observation,
    RoutineWindow,
    SharedRoutine,
)

CONSENT_BASIS = (
    "원자료에 이 조율 시스템에 대한 동의 기록이 없다. 생활지원사 전화와 이장 확인이라는 "
    "기존 관행에서 유추한 연구자 가정이며, 검증된 동의가 아니다."
)


class ObservationLeak(RuntimeError):
    """Raised when the engine tries to hand an actor something it may not see."""


def visible_to(actor_id: str, event: DomainEvent) -> bool:
    if actor_id == RESEARCHER:
        return True
    if event.type in WORLD_TRUTH_EVENTS:
        return False
    return actor_id in event.visibility


def assert_no_leak(actor_id: str, events: Iterable[DomainEvent]) -> None:
    for event in events:
        if not visible_to(actor_id, event):
            raise ObservationLeak(
                "actor %s may not read event %s (%s)" % (actor_id, event.id, event.type.value)
            )


@dataclass
class ActorView:
    """Everything an adapter is allowed to reason over."""

    actor_id: str
    sim_time_ms: int
    observations: list[Observation]
    own_place: str | None = None
    own_activity: str | None = None
    own_interruptible: bool = False
    commitments: list[dict[str, Any]] = field(default_factory=list)
    shared_routine: dict[str, Any] = field(default_factory=dict)
    contacts_received_today: int = 0
    local_knowledge: list[dict[str, Any]] = field(default_factory=list)
    persona: dict[str, Any] = field(default_factory=dict)
    reservations: list[dict[str, Any]] = field(default_factory=list)
    policy: dict[str, Any] = field(default_factory=dict)
    resources: dict[str, Any] = field(default_factory=dict)

    def latest(self, kind: str) -> Observation | None:
        for obs in reversed(self.observations):
            if obs.kind == kind:
                return obs
        return None

    @property
    def observation_ids(self) -> set[str]:
        return {o.id for o in self.observations}


class ObservationLog:
    def __init__(self) -> None:
        self._by_actor: dict[str, list[Observation]] = {}
        self._counter = 0

    def record(self, attempt_id: str, actor_id: str, event: DomainEvent, kind: str,
               subject_id: str | None = None, payload: dict[str, Any] | None = None,
               ttl_ms: int | None = None,
               confidence: str = "observed") -> Observation:
        if not visible_to(actor_id, event):
            raise ObservationLeak(
                "refusing to give %s an observation derived from %s" % (actor_id, event.id)
            )
        self._counter += 1
        obs = Observation(
            id="obs-%d" % self._counter,
            attemptId=attempt_id,
            actorId=actor_id,
            simTimeMs=event.simTimeMs,
            kind=kind,
            subjectId=subject_id,
            payload=payload or {},
            sourceEventId=event.id,
            ttlMs=ttl_ms,
            confidence=confidence,  # type: ignore[arg-type]
        )
        self._by_actor.setdefault(actor_id, []).append(obs)
        return obs

    def for_actor(self, actor_id: str, now_ms: int | None = None) -> list[Observation]:
        rows = self._by_actor.get(actor_id, [])
        if now_ms is None:
            return list(rows)
        fresh = []
        for obs in rows:
            if obs.simTimeMs > now_ms:
                continue
            if obs.ttlMs is not None and obs.simTimeMs + obs.ttlMs < now_ms:
                continue
            fresh.append(obs)
        return fresh

    def all(self) -> list[Observation]:
        out: list[Observation] = []
        for rows in self._by_actor.values():
            out.extend(rows)
        return sorted(out, key=lambda o: (o.simTimeMs, o.id))


def _baseline_windows(resident: dict[str, Any], horizon_ms: int) -> list[tuple[int, int, str]]:
    """(start, end, place) for the consented baseline day."""
    steps = resident["plan"]["baseline"]
    if not steps:
        return []
    out: list[tuple[int, int, str]] = []
    actor_id = resident["id"]

    def resolve(step: dict[str, Any]) -> str:
        if step["targetKind"] == "go_to_home_of":
            return "HOME:" + step["target"]
        if step["target"] == "HOME":
            return "HOME:" + actor_id
        return step["target"]

    current = resolve(steps[0])
    cursor = int(steps[0]["departMs"])
    for step in steps[1:]:
        depart = int(step["departMs"])
        if depart > cursor:
            out.append((cursor, depart, current))
        current = resolve(step)
        cursor = depart
    out.append((cursor, horizon_ms, current))
    return out


def shared_routine(resident: dict[str, Any], holder_id: str, horizon_ms: int,
                   granularity: str = "home_or_away") -> SharedRoutine:
    """Project a resident's baseline day for one holder.

    ``home_or_away`` is the projection MEDial gets. It answers "is this person
    usually home at this hour", which is what a routing decision needs, and it
    cannot answer "where are they instead", which is what would make the
    simulation pointless.
    """
    actor_id = resident["id"]
    home = "HOME:" + actor_id
    windows = [
        RoutineWindow(
            startMs=start, endMs=end, atHome=(place == home),
            place=place if granularity == "place_level" else None)
        for start, end, place in _baseline_windows(resident, horizon_ms)
    ]
    return SharedRoutine(
        subjectId=actor_id,
        holderId=holder_id,
        granularity=granularity,  # type: ignore[arg-type]
        consent=ConsentStatus.assumed,
        consentBasis=CONSENT_BASIS,
        windows=windows,
    )


def routine_says_home(routine: dict[str, Any], t_ms: int) -> bool | None:
    """True / False / None(=no window covers this time)."""
    for window in routine.get("windows", []):
        if window["startMs"] <= t_ms < window["endMs"]:
            return bool(window["atHome"])
    windows = routine.get("windows") or []
    if windows and t_ms >= windows[-1]["endMs"]:
        return bool(windows[-1]["atHome"])
    return None


def routine_place(routine: dict[str, Any], t_ms: int) -> str | None:
    """Place-level answer. Returns None for a ``home_or_away`` routine, which is
    the point: a holder without place-level consent cannot get one by asking."""
    if routine.get("granularity") != "place_level":
        return None
    for window in routine.get("windows", []):
        if window["startMs"] <= t_ms < window["endMs"]:
            return window.get("place")
    return None


def home_window(routine: dict[str, Any], after_ms: int) -> int | None:
    """Next time the shared routine has the resident at home.

    Used by the health-centre rule to pick a call-back time instead of driving
    out. It is an inference from a *shared routine*, never from live position.
    """
    for window in routine.get("windows", []):
        if window["startMs"] >= after_ms and window["atHome"]:
            return int(window["startMs"])
    return None


MEDIAL_READABLE = frozenset({MEDIAL})
