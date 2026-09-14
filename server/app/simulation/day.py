"""Drawing the day a run takes place on.

The registry holds one recorded day per resident. Running that same day forever
says the source measured a law; running a freshly invented day says we know more
than we do. This module takes the middle position: the recorded departure times
are one observation, so a run may draw a nearby day from its seed, and every
difference from the record is written down with a reason.

Three rules keep this from becoming fiction.

* **Nothing new is invented.** Times move and outings are dropped. No destination
  that is not already in that person's own recorded day is ever produced.
* **People with no recorded routine are left alone.** P9, P10 and P11 have a
  single all-day step. Varying them would be authorship, not uncertainty, so
  they are excluded by name and the screen says why.
* **The draw is a pure function of (village, environment, seed).** A rerun and a
  fork inherit the parent's seed and therefore land on the same day without
  copying anything. Changing the seed is an explicit decision to study a
  different day, and it changes the attempt's input hash.

Per-resident streams are seeded from the run seed and the resident id alone, so
adding a thirteenth resident - or correcting a typo in the registry - does not
silently redraw the other twelve.
"""
from __future__ import annotations

import copy
import hashlib
import json
import random
from typing import Any

from .contracts import DayRealization, EnvironmentRevision, ResidentDay, StepChange

MIN_MS = 60_000
#: Only used to keep a drawn departure off the very end of the day.
MIN_GAP_MS = MIN_MS


def _stream(seed: int, actor_id: str) -> random.Random:
    """One stream per person, keyed on who they are and nothing else.

    Deliberately *not* keyed on the registry hash. If it were, correcting a typo
    in one resident's job title would redraw everybody else's day, and a
    comparison that spanned the fix would quietly stop being controlled. Which
    registry a run used is already recorded in ``inputHashes["village"]``.
    """
    digest = hashlib.sha256(("%s|%s" % (seed, actor_id)).encode("utf-8")).digest()
    return random.Random(int.from_bytes(digest[:8], "big"))


def _is_home(step: dict[str, Any], actor_id: str) -> bool:
    if step["targetKind"] == "go_to_home_of":
        return step["target"] == actor_id
    return step["target"] == "HOME"


def _outings(steps: list[dict[str, Any]], actor_id: str) -> list[tuple[int, int]]:
    """Half-open ranges of consecutive away-from-home steps.

    An outing that never returns home is still an outing; it simply runs to the
    end of the day, and dropping it means the person stayed in.
    """
    spans: list[tuple[int, int]] = []
    start: int | None = None
    for index, step in enumerate(steps):
        away = not _is_home(step, actor_id)
        if away and start is None:
            start = index
        elif not away and start is not None:
            spans.append((start, index))
            start = None
    if start is not None:
        spans.append((start, len(steps)))
    return spans


def _retime(village: Any, steps: list[dict[str, Any]], rng: random.Random,
            bound_min: int, actor_id: str, horizon_ms: int) -> list[StepChange]:
    """Move recorded departures within ``bound_min``, keeping the day possible.

    The minimum gap between two steps is not a constant: it is how long it takes
    to walk or drive there. This mirrors ``world.build_baseline`` - departure
    starts a leg, and the next step cannot leave before that leg lands - so a
    drawn day can never put one person in two places at once.

    Step 0 is never moved. It says where the person starts the day, which is not
    a departure anyone observed.
    """
    from .world import _resolve_place, leg

    changes: list[StepChange] = []
    if not steps:
        return changes
    bound_ms = max(0, bound_min) * MIN_MS
    current = _resolve_place(steps[0]["targetKind"], steps[0]["target"], actor_id)
    cursor = int(steps[0]["departMs"])
    ceiling = max(0, horizon_ms - MIN_GAP_MS)

    for index, step in enumerate(steps):
        if index == 0:
            continue
        before = int(step["departMs"])
        movable = bound_ms and step.get("timeProvenance") == "source"
        proposed = before + rng.randint(-bound_ms, bound_ms) if movable else before
        depart = max(cursor, min(max(0, proposed), ceiling))

        if depart != before:
            if depart != proposed:
                changes.append(StepChange(
                    index=index, kind="clamp", target=str(step["target"]),
                    beforeMs=before, afterMs=depart,
                    note=("이동에 걸리는 시간을 지키도록 되돌렸다. 한 사람이 동시에 두 곳에 "
                          "있을 수는 없고, 순서는 원본이 고정한 구조다.")))
            else:
                changes.append(StepChange(
                    index=index, kind="jitter", target=str(step["target"]),
                    beforeMs=before, afterMs=depart,
                    note="원본 시각은 하루치 기록이므로 ±%d분 안에서 흔들었다." % bound_min))
        step["departMs"] = depart
        step["departMin"] = depart / MIN_MS

        if step["target"] == "PATROL":
            # The patrol is a loop: it ends where it started, and it runs until
            # whatever departs next, so it constrains only the clock.
            cursor = depart
            continue
        dest = _resolve_place(step["targetKind"], step["target"], actor_id)
        travel = leg(village, actor_id, depart, current, dest, step.get("car", False),
                     step.get("fixedDurationMin"), "baseline", "이동")
        cursor = travel.end_ms if travel.kind == "travel" else depart
        current = dest
    return changes


def _skip_one_outing(steps: list[dict[str, Any]], rng: random.Random, actor_id: str,
                     probability: float) -> list[StepChange]:
    """Drop at most one outing. The person stays where they already were.

    At most one, because the frequency of staying in is not recorded at all and
    dropping several would compound an assumption we cannot check.
    """
    if probability <= 0:
        return []
    spans = _outings(steps, actor_id)
    if not spans or rng.random() >= probability:
        return []
    start, end = spans[rng.randrange(len(spans))]
    dropped = steps[start:end]
    del steps[start:end]
    # The return home that followed is now a second HOME step in a row. Removing
    # it keeps the plan a list of changes of place rather than of repeats.
    if start < len(steps) and start > 0 and _is_home(steps[start], actor_id) \
            and _is_home(steps[start - 1], actor_id):
        del steps[start]
    return [StepChange(
        index=start, kind="skip_outing",
        target=" → ".join(str(step["target"]) for step in dropped),
        beforeMs=int(dropped[0]["departMs"]), afterMs=None,
        note=("그날 이 외출을 하지 않았다고 가정했다. 외출을 거르는 빈도는 원자료에 없으며 "
              "연구자 설정 확률(%.2f)에서 뽑았다." % probability))]


def _repeat_one_outing(steps: list[dict[str, Any]], rng: random.Random, actor_id: str,
                       probability: float, horizon_ms: int) -> list[StepChange]:
    """Go somewhere this person already goes, a second time.

    Only a destination already in their own recorded day is reused: a new place
    would be a claim about where they go, which is exactly what we do not know.
    Off by default.
    """
    if probability <= 0 or rng.random() >= probability:
        return []
    spans = [(a, b) for a, b in _outings(steps, actor_id) if b < len(steps)]
    if not spans:
        return []
    start, end = spans[rng.randrange(len(spans))]
    block = copy.deepcopy(steps[start:end])
    span_ms = int(steps[end]["departMs"]) - int(block[0]["departMs"])
    if span_ms <= 0:
        return []

    # Find the widest stretch at home that could hold it, and put it there.
    best: tuple[int, int] | None = None
    for index in range(len(steps) - 1):
        if not _is_home(steps[index], actor_id):
            continue
        room = int(steps[index + 1]["departMs"]) - int(steps[index]["departMs"])
        if room > span_ms + 2 * MIN_GAP_MS and (best is None or room > best[1]):
            best = (index, room)
    if best is None:
        tail = horizon_ms - int(steps[-1]["departMs"])
        if not _is_home(steps[-1], actor_id) or tail <= span_ms + 2 * MIN_GAP_MS:
            return []
        best = (len(steps) - 1, tail)

    at, _room = best
    depart = int(steps[at]["departMs"]) + MIN_GAP_MS
    shift = depart - int(block[0]["departMs"])
    for step in block:
        step["departMs"] = int(step["departMs"]) + shift
        step["departMin"] = step["departMs"] / MIN_MS
        step["provenance"] = "researcher-assumption"
        step["timeProvenance"] = "researcher-assumption"
    home = copy.deepcopy(steps[at])
    home["departMs"] = depart + span_ms
    home["departMin"] = home["departMs"] / MIN_MS
    home["provenance"] = "researcher-assumption"
    home["timeProvenance"] = "researcher-assumption"
    steps[at + 1:at + 1] = [*block, home]
    return [StepChange(
        index=at + 1, kind="repeat_outing",
        target=" → ".join(str(step["target"]) for step in block),
        beforeMs=None, afterMs=depart,
        note=("본인 일과에 이미 있는 장소로 한 번 더 다녀왔다고 가정했다. "
              "새 목적지는 만들지 않는다."))]


def realize_day(village: Any, environment: EnvironmentRevision, seed: int,
                horizon_ms: int) -> DayRealization:
    """Draw the day this run happens on."""
    variation = environment.variation
    village_hash = village.content_hash
    days: list[ResidentDay] = []
    skipped_or_repeated = False
    jittered = False

    for resident in village.residents:
        actor_id = resident["id"]
        steps = copy.deepcopy(resident["plan"]["baseline"])

        if not variation.enabled:
            days.append(ResidentDay(actorId=actor_id, steps=steps,
                                    excludedReason="이 실행은 변이를 끈 상태다."))
            continue
        if variation.excludeSingleStepResidents and len(steps) < 2:
            days.append(ResidentDay(
                actorId=actor_id, steps=steps,
                excludedReason=("원자료에 하루 일과가 한 단계뿐이라 흔들 근거가 없다. "
                                "변이를 주면 관측이 아니라 창작이 된다.")))
            continue

        rng = _stream(seed, actor_id)
        changes = _skip_one_outing(steps, rng, actor_id, variation.skipOutingProbability)
        changes += _repeat_one_outing(steps, rng, actor_id,
                                      variation.repeatOutingProbability, horizon_ms)
        # Always last: it is the pass that makes whatever the others produced a
        # day one person could actually live.
        changes += _retime(village, steps, rng, variation.departJitterMin, actor_id,
                           horizon_ms)
        for change in changes:
            if change.kind in ("skip_outing", "repeat_outing"):
                skipped_or_repeated = True
            else:
                jittered = True
        days.append(ResidentDay(actorId=actor_id, steps=steps, changes=changes))

    if not variation.enabled:
        classification = "source_baseline"
    elif skipped_or_repeated:
        classification = "plausible_extension"
    elif jittered:
        classification = "source_jittered"
    else:
        classification = "source_baseline"

    payload = json.dumps(
        [[day.actorId, day.steps] for day in days],
        ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()[:16]

    return DayRealization(
        id="day-%s" % digest,
        seed=seed,
        villageContentHash=village_hash,
        environmentRevisionId=environment.id,
        classification=classification,
        residents=days,
        assumptions=list(variation.assumptions),
    )


def apply_realization(village: Any, realization: DayRealization) -> Any:
    """A village whose residents live the realized day.

    The returned village reports the *source* registry's content hash. Which
    village this is and which day it is are two different facts, and collapsing
    them would make every seed look like a different village.
    """
    from .village import Village

    by_actor = {day.actorId: day for day in realization.residents}
    data = copy.deepcopy(village.raw)
    for resident in data["residents"]:
        day = by_actor.get(resident["id"])
        if day is not None:
            resident["plan"]["baseline"] = copy.deepcopy(day.steps)
    realized = Village(data, village.path)
    realized.source_content_hash = village.content_hash
    realized.day_realization_id = realization.id
    return realized
