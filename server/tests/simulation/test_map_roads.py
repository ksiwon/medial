"""Journeys follow the roads that are drawn on the map (2026-09-15).

The registry carries two road networks and they are not interchangeable:

* ``roadGraph`` is the source simulator's own - straight chords between the
  buildings it cared about. Provenance-clean, and the number to quote;
* ``mapRoads`` is the network traced off the map raster by
  scripts/trace_map_roads.py, with every door snapped onto it. It is what a
  journey *follows*, so nobody walks across a field or over the bay.

What is checked here: the traced network is used when it is there, the walk up
the drive is counted rather than free, a trip that leaves the map goes out by
the road first, and a registry without the block behaves exactly as before.

    python -m pytest server/tests/simulation/test_map_roads.py -q
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))

from app.simulation.service import _past_map_edge  # noqa: E402
from app.simulation.village import Village  # noqa: E402
from app.simulation.world import leg  # noqa: E402

SYNTHETIC = REPO_ROOT / "fixtures" / "synthetic" / "village.synthetic.json"


def _registry() -> dict:
    return json.loads(SYNTHETIC.read_text(encoding="utf-8"))


def _key(x: float, y: float) -> str:
    return "%.1f,%.1f" % (x, y)


def _lane(points: list[tuple[float, float]], m_per_px: float) -> dict:
    """A hand-drawn network: one bent lane, as nodes and metres."""
    nodes = {_key(*p): [p[0], p[1]] for p in points}
    adjacency: dict[str, list] = {k: [] for k in nodes}
    for a, b in zip(points, points[1:]):
        metres = round(math.dist(a, b) * m_per_px, 3)
        adjacency[_key(*a)].append([_key(*b), metres])
        adjacency[_key(*b)].append([_key(*a), metres])
    return {"nodes": nodes, "adjacency": adjacency}


@pytest.fixture()
def village() -> Village:
    """The synthetic village with a traced-road block bolted on.

    The block is written here rather than into the fixture so the fixture stays
    exactly what every other test reads, and so the geometry under test is
    visible in one place: a lane that goes around the houses, not through them.
    """
    data = _registry()
    m_per_px = data["geometry"]["frame"]["mPerPx"]
    # A dog-leg from the shop corner up to where the road leaves the map.
    lane = [(400.0, 450.0), (300.0, 300.0), (200.0, 150.0), (200.0, 1.0)]
    data["mapRoads"] = {
        "polylines": [[list(p) for p in lane]],
        "graph": _lane(lane, m_per_px),
        "anchors": {
            "FOOD": {"node": _key(400.0, 450.0), "offsetPx": 0.0},
            "MIGA": {"node": _key(200.0, 150.0), "offsetPx": 0.0},
            "TOWNEXIT": {"node": _key(200.0, 1.0), "offsetPx": 0.0},
            # P10 lives off the lane: the walk up the drive is 60px.
            "HOME:P10": {"node": _key(200.0, 150.0), "offsetPx": 60.0},
        },
        "offRoad": ["SEA", "TOWN"],
        "provenance": {"method": "test fixture"},
    }
    return Village(data, SYNTHETIC)


def test_a_journey_follows_the_traced_lane_and_not_the_straight_line(village: Village):
    line, metres = village.path_between("FOOD", "MIGA")
    assert village.follows_map_roads()
    # Every bend of the lane is in the line, doors at both ends.
    assert line[0] == [400.0, 450.0]
    assert [300.0, 300.0] in line and [200.0, 150.0] in line
    assert line[-1] == list(village.position_of_place("MIGA"))
    # Longer than the crow flight, because it is a road.
    straight = math.dist((400.0, 450.0), village.position_of_place("MIGA"))
    assert metres > straight * village.geometry["frame"]["mPerPx"]


def test_the_walk_up_the_drive_is_counted_not_free(village: Village):
    m_per_px = village.geometry["frame"]["mPerPx"]
    lane_px = (math.dist((400.0, 450.0), (300.0, 300.0))
               + math.dist((300.0, 300.0), (200.0, 150.0)))
    _, metres = village.path_between("FOOD", "HOME:P10")
    # The lane, plus the 60px from where it passes to P10's own door. A house
    # set back from the road is not free to reach.
    assert metres == pytest.approx((lane_px + 60.0) * m_per_px, abs=0.5)
    assert metres > lane_px * m_per_px


def test_leaving_the_village_goes_out_by_the_road(village: Village):
    line = village.off_map_polyline("FOOD", "TOWN")
    assert line[0] == list(village.position_of_place("FOOD"))
    assert [200.0, 1.0] in line, "the road out is on the line"
    assert line[-1] == list(village.position_of_place("TOWN"))
    # Coming home is the same line read backwards.
    back = village.off_map_polyline("TOWN", "FOOD")
    assert back[0] == list(village.position_of_place("TOWN"))
    assert back[-1] == list(village.position_of_place("FOOD"))


def test_a_trip_to_town_is_on_the_map_until_it_actually_leaves(village: Village):
    segment = leg(village, "P1", 0, "FOOD", "TOWN", drive=False,
                  fixed_minutes=None, origin="baseline", label="읍내")
    assert segment.mode == "offmap"
    row = segment.as_dict(with_polyline=True)
    span = row["endMs"] - row["startMs"]
    assert not _past_map_edge(row, row["startMs"] + span // 10), "still on the road"
    assert _past_map_edge(row, row["endMs"]), "off the map by the end"


def test_a_registry_without_the_block_is_unchanged(village: Village):
    plain = Village(_registry(), SYNTHETIC)
    assert not plain.follows_map_roads()
    assert plain.map_anchor_of_place("FOOD") is None
    line, metres = plain.path_between("FOOD", "MIGA")
    assert (line, metres) == plain.route(plain.anchor_of_place("FOOD"),
                                         plain.anchor_of_place("MIGA"))
