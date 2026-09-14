"""The day a run happens on.

The draw exists so that a recorded day is not mistaken for a law. These tests
pin the three things that would turn it back into fiction:

* it must stay a *possible* day - the travel-time bug that let one person leave
  a place before arriving there was found by the invariant below, not by review;
* it must invent nothing - no destination a person's own record does not already
  contain;
* it must be a pure function of (village, environment, seed), because that is
  the only reason a rerun and a fork land on the same day.

    python -m pytest server/tests/simulation/test_day.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))

from app.simulation.day import apply_realization, realize_day  # noqa: E402
from app.simulation.decks.p1_no_response import DECK  # noqa: E402
from app.simulation.environment import ENV_V1, ENV_V1_FIXED  # noqa: E402
from app.simulation.village import load_village  # noqa: E402
from app.simulation.world import WorldState  # noqa: E402

SYNTHETIC = str(REPO_ROOT / "fixtures" / "synthetic" / "village.synthetic.json")
HORIZON = DECK.horizonMs
SEEDS = [0, 1, 7, 17, 42, 99, 123, 512, 2026, 31337]


def village():
    return load_village(SYNTHETIC)


def draw(seed: int, environment=ENV_V1):
    source = village()
    return source, realize_day(source, environment, seed, HORIZON)


# ------------------------------------------------------------- still possible
@pytest.mark.parametrize("seed", SEEDS)
def test_a_drawn_day_never_puts_one_person_in_two_places(seed):
    """The invariant that caught the first version of the jitter."""
    source, day = draw(seed)
    world = WorldState(apply_realization(source, day), HORIZON)
    for actor_id, runtime in world.actors.items():
        for previous, current in zip(runtime.baseline, runtime.baseline[1:]):
            assert previous.end_ms <= current.start_ms, (
                "%s leaves %s before arriving" % (actor_id, current.place))


@pytest.mark.parametrize("seed", SEEDS)
def test_a_drawn_day_keeps_departures_in_order(seed):
    _source, day = draw(seed)
    for resident in day.residents:
        times = [int(step["departMs"]) for step in resident.steps]
        assert times == sorted(times), resident.actorId
        assert all(0 <= t <= HORIZON for t in times), resident.actorId


# ------------------------------------------------------------ invents nothing
@pytest.mark.parametrize("seed", SEEDS)
def test_a_drawn_day_never_sends_anyone_somewhere_new(seed):
    """Times move and outings drop. Destinations are never authored."""
    source, day = draw(seed)
    recorded = {r["id"]: {str(s["target"]) for s in r["plan"]["baseline"]}
                for r in source.residents}
    for resident in day.residents:
        drawn = {str(step["target"]) for step in resident.steps}
        assert drawn <= recorded[resident.actorId], resident.actorId


@pytest.mark.parametrize("seed", SEEDS)
def test_residents_without_a_recorded_routine_are_left_alone(seed):
    """P9, P10 and P11 have one all-day step. Varying them would be authorship."""
    source, day = draw(seed)
    single = {r["id"] for r in source.residents if len(r["plan"]["baseline"]) < 2}
    assert single, "the fixture should still contain someone with no routine"
    for resident in day.residents:
        if resident.actorId in single:
            assert resident.changes == []
            assert resident.excludedReason
            assert "창작" in resident.excludedReason


@pytest.mark.parametrize("seed", SEEDS)
def test_every_difference_from_the_record_carries_a_reason(seed):
    _source, day = draw(seed)
    for resident in day.residents:
        for change in resident.changes:
            assert change.note.strip(), (resident.actorId, change.kind)


@pytest.mark.parametrize("seed", SEEDS)
def test_a_recorded_time_moves_no_further_than_the_stated_bound(seed):
    """Clamps may exceed it - travel time wins - but a free jitter may not."""
    bound_ms = ENV_V1.variation.departJitterMin * 60_000
    _source, day = draw(seed)
    for resident in day.residents:
        for change in resident.changes:
            if change.kind == "jitter":
                assert abs(change.afterMs - change.beforeMs) <= bound_ms


# --------------------------------------------------------------- reproducible
@pytest.mark.parametrize("seed", SEEDS)
def test_the_same_seed_draws_the_same_day(seed):
    """Why a rerun and a fork need copy nothing to be a controlled pair."""
    first = realize_day(village(), ENV_V1, seed, HORIZON)
    second = realize_day(village(), ENV_V1, seed, HORIZON)
    assert first.id == second.id
    assert first.model_dump() == second.model_dump()


def test_different_seeds_are_different_days():
    ids = {realize_day(village(), ENV_V1, seed, HORIZON).id for seed in SEEDS}
    assert len(ids) > 1, "a seed that changes nothing makes the sensitivity check empty"


def test_one_resident_more_does_not_redraw_the_others():
    """Streams are keyed per resident so the population is not one shared queue."""
    source = village()
    base = {d.actorId: d.steps for d in realize_day(source, ENV_V1, 17, HORIZON).residents}

    grown = load_village(SYNTHETIC)
    first = grown.raw["residents"][0]
    twin = {**first, "id": "P99", "plan": {**first["plan"]}}
    grown.raw["homes"]["P99"] = dict(grown.raw["homes"][first["id"]])
    grown.raw["residents"].append(twin)
    grown.residents = grown.raw["residents"]
    grown.homes = grown.raw["homes"]

    after = {d.actorId: d.steps for d in realize_day(grown, ENV_V1, 17, HORIZON).residents}
    for actor_id, steps in base.items():
        assert after[actor_id] == steps, actor_id


# -------------------------------------------------------------- switched off
def test_variation_off_reproduces_the_record_exactly():
    source = village()
    day = realize_day(source, ENV_V1_FIXED, 17, HORIZON)
    assert day.classification == "source_baseline"
    for resident in day.residents:
        recorded = source.by_id[resident.actorId]["plan"]["baseline"]
        assert resident.steps == recorded
        assert resident.changes == []


def test_a_drawn_day_says_which_kind_of_day_it_is():
    kinds = {realize_day(village(), ENV_V1, seed, HORIZON).classification for seed in SEEDS}
    assert kinds <= {"source_baseline", "source_jittered", "plausible_extension"}
    # A dropped outing is an assumption the source does not record, so at least
    # one of these days has to say so out loud.
    assert "plausible_extension" in kinds


def test_the_realized_village_keeps_the_registry_identity():
    """Which village this is and which day it is are two separate facts."""
    source, day = draw(17)
    realized = apply_realization(source, day)
    assert realized.content_hash == source.content_hash
    assert realized.day_realization_id == day.id


# --------------------------------------------------------------- end to end
def _service(store=None):
    from app.simulation.persistence.store import Store
    from app.simulation.service import SimulationService

    return SimulationService(store=store or Store(":memory:"), village=village(),
                             persona_path=str(REPO_ROOT / "fixtures" / "synthetic"
                                              / "personas.synthetic.json"))


def test_a_run_records_which_day_it_happened_on():
    """Default path, draw switched on, all the way through the service."""
    svc = _service()
    created = svc.create_attempt("policy-A-v1", "deck-p1-no-response-v1",
                                 "assumed-resources-v1")
    attempt = created["attempt"]
    assert attempt["environmentRevisionId"] == "env-v2"
    assert attempt["dayRealizationId"]
    assert attempt["inputHashes"]["day"] == attempt["dayRealizationId"]


def test_a_rerun_lands_on_the_same_day_as_its_parent():
    """The whole point of drawing from the seed: a comparison stays controlled."""
    svc = _service()
    parent = svc.create_attempt("policy-A-v1", "deck-p1-no-response-v1",
                                "assumed-resources-v1")["attempt"]
    child = svc.rerun_attempt(parent["id"], {"params": {"retryCount": 1}},
                              "재연락 한 번")["attempt"]
    assert child["dayRealizationId"] == parent["dayRealizationId"]
    assert child["inputHashes"]["environment"] == parent["inputHashes"]["environment"]


def test_a_different_seed_is_reported_as_a_different_input():
    svc = _service()
    a = svc.create_attempt("policy-A-v1", "deck-p1-no-response-v1",
                           "assumed-resources-v1", seed=17)["attempt"]
    b = svc.create_attempt("policy-A-v1", "deck-p1-no-response-v1",
                           "assumed-resources-v1", seed=18)["attempt"]
    assert a["inputHashes"]["day"] != b["inputHashes"]["day"]
