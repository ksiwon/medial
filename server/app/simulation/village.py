"""Load the normalized village registry and answer geometry questions about it.

The registry is produced by scripts/import_village. If the imported file is not
present (it lives in git-ignored local-data/), we fall back to the synthetic
fixture and say so loudly through ``data_source`` so that no screen or export
can pass invented geography off as the real village.
"""
from __future__ import annotations

import functools
import hashlib
import heapq
import json
import math
import os
from pathlib import Path
from typing import Any, Iterable

REPO_ROOT = Path(__file__).resolve().parents[3]
IMPORTED = REPO_ROOT / "local-data" / "normalized" / "village.v1.json"
SYNTHETIC = REPO_ROOT / "fixtures" / "synthetic" / "village.synthetic.json"

PATROL_PLACE = "PATROL"
HOME_PLACE = "HOME"


def _node_key(x: float, y: float) -> str:
    return "%.1f,%.1f" % (round(x, 1), round(y, 1))


class RoadGraph:
    def __init__(self, nodes: dict[str, list[float]], adjacency: dict[str, list[list[Any]]]):
        self.nodes = nodes
        self.adjacency = adjacency

    @functools.lru_cache(maxsize=4096)
    def path(self, start: str, goal: str) -> tuple[tuple[str, ...], float] | None:
        """Dijkstra over source-provided road segments only."""
        if start == goal:
            return ((start,), 0.0)
        if start not in self.adjacency or goal not in self.adjacency:
            return None
        dist = {start: 0.0}
        prev: dict[str, str] = {}
        pq: list[tuple[float, str]] = [(0.0, start)]
        while pq:
            d, node = heapq.heappop(pq)
            if node == goal:
                chain = [node]
                while chain[-1] != start:
                    chain.append(prev[chain[-1]])
                return (tuple(reversed(chain)), d)
            if d > dist.get(node, math.inf):
                continue
            for nxt, w in self.adjacency[node]:
                nd = d + w
                if nd < dist.get(nxt, math.inf):
                    dist[nxt] = nd
                    prev[nxt] = node
                    heapq.heappush(pq, (nd, nxt))
        return None

    def polyline(self, chain: Iterable[str]) -> list[list[float]]:
        return [list(self.nodes[k]) for k in chain]


SUPPORTED_SCHEMA = "village/2"

#: Blocks the server and the map depend on. A registry produced by an older
#: importer is missing some of them, and the failure that causes is far away from
#: the cause - so we refuse it here with the command that fixes it.
REQUIRED_BLOCKS = (
    ("geometry", "orientationChecks"),
    ("roadGraphProvenance",),
    ("namedRouteDistances",),
)


class StaleRegistryError(RuntimeError):
    pass


def _check_registry(data: dict[str, Any], path: Path) -> None:
    missing = []
    for keys in REQUIRED_BLOCKS:
        node: Any = data
        for key in keys:
            if not isinstance(node, dict) or key not in node:
                missing.append(".".join(keys))
                break
            node = node[key]
    version = data.get("schemaVersion")
    if version != SUPPORTED_SCHEMA or missing:
        raise StaleRegistryError(
            "%s 는 이 서버가 요구하는 %s 형식이 아닙니다 (현재 %s%s). "
            "`cd scripts && python -m import_village` 로 다시 만들거나, 원자료가 없다면 "
            "해당 파일을 지워 합성 픽스처로 실행하세요."
            % (path.name, SUPPORTED_SCHEMA, version,
               ", 누락: " + ", ".join(missing) if missing else "")
        )


class Village:
    def __init__(self, data: dict[str, Any], path: Path):
        _check_registry(data, path)
        self.raw = data
        self.path = path
        self.data_source: str = data.get("dataSource", "unknown")
        self.geometry: dict[str, Any] = data["geometry"]
        self.travel: dict[str, Any] = data["travel"]
        self.places: dict[str, Any] = data["places"]
        self.homes: dict[str, Any] = data["homes"]
        self.residents: list[dict[str, Any]] = data["residents"]
        self.groups: dict[str, Any] = data["groups"]
        self.roads: dict[str, Any] = data["roads"]
        self.patrol: list[list[float]] = data["patrol"]
        self.data_issues: list[dict[str, Any]] = data.get("dataIssues", [])
        #: Two distances per named route. ``sourceM`` is what the source itself
        #: drew and is the number to quote; ``graphM`` is the shortest path over
        #: the union of known road segments and is the number used to cost an
        #: assignment. They are kept apart on purpose - see DI-007.
        self.named_route_distances: dict[str, Any] = data.get("namedRouteDistances", {})
        #: The source's own map raster and how to place it north-up. Absent for
        #: the synthetic fixture, which says so on screen rather than drawing an
        #: invented coastline.
        self.map_image: dict[str, Any] | None = data.get("mapImage")
        self.road_graph_provenance: dict[str, Any] = data.get("roadGraphProvenance", {})
        self.graph = RoadGraph(data["roadGraph"]["nodes"], data["roadGraph"]["adjacency"])
        #: The roads as they are drawn on the map, traced out of the raster by
        #: scripts/trace_map_roads.py, with every door snapped onto them. The
        #: source's own graph is straight chords between buildings: good enough
        #: to cost a trip, but people walking it crossed fields and the bay. When
        #: this block is present it is what a journey follows; the source graph
        #: stays for its distances and its provenance proof.
        self.map_roads: dict[str, Any] | None = data.get("mapRoads")
        self.map_graph: RoadGraph | None = (
            RoadGraph(self.map_roads["graph"]["nodes"], self.map_roads["graph"]["adjacency"])
            if self.map_roads else None
        )
        self.by_id = {r["id"]: r for r in self.residents}
        self._patrol_cum = self._cumulative(self.patrol)
        #: Set by ``day.apply_realization`` on a village whose baselines were
        #: redrawn for a seed. Which village this is and which day it is are two
        #: separate facts; without this the two collapse and every seed looks
        #: like a different registry.
        self.source_content_hash: str | None = None
        self.day_realization_id: str | None = None

    # -- identity ------------------------------------------------------
    @property
    def content_hash(self) -> str:
        if self.source_content_hash is not None:
            return self.source_content_hash
        payload = json.dumps(self.raw, ensure_ascii=False, sort_keys=True).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()[:16]

    @property
    def is_synthetic(self) -> bool:
        return self.data_source == "synthetic"

    # -- geometry ------------------------------------------------------
    @staticmethod
    def _cumulative(line: list[list[float]]) -> list[float]:
        out = [0.0]
        for a, b in zip(line, line[1:]):
            out.append(out[-1] + math.hypot(a[0] - b[0], a[1] - b[1]))
        return out

    def position_of_place(self, place_id: str, actor_id: str | None = None) -> tuple[float, float]:
        if place_id == HOME_PLACE:
            if actor_id is None:
                raise ValueError("HOME needs an actor")
            home = self.homes[actor_id]
            return (home["x"], home["y"])
        if place_id.startswith("HOME:"):
            home = self.homes[place_id.split(":", 1)[1]]
            return (home["x"], home["y"])
        place = self.places[place_id]
        return (place["x"], place["y"])

    def anchor_of_place(self, place_id: str, actor_id: str | None = None) -> str:
        if place_id == HOME_PLACE:
            return self.homes[actor_id]["anchor"]["node"]  # type: ignore[index]
        if place_id.startswith("HOME:"):
            return self.homes[place_id.split(":", 1)[1]]["anchor"]["node"]
        return self.places[place_id]["anchor"]["node"]

    def patrol_position(self, fraction: float) -> tuple[float, float]:
        """Position along the closed patrol loop, 0.0 -> 1.0."""
        total = self._patrol_cum[-1]
        if total <= 0:
            return (self.patrol[0][0], self.patrol[0][1])
        target = max(0.0, min(1.0, fraction)) * total
        for i in range(1, len(self._patrol_cum)):
            if self._patrol_cum[i] >= target:
                seg = self._patrol_cum[i] - self._patrol_cum[i - 1]
                t = 0.0 if seg == 0 else (target - self._patrol_cum[i - 1]) / seg
                a, b = self.patrol[i - 1], self.patrol[i]
                return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        last = self.patrol[-1]
        return (last[0], last[1])

    def nearest_node(self, x: float, y: float) -> str:
        best, best_d = None, math.inf
        for key, pos in self.graph.nodes.items():
            d = math.hypot(pos[0] - x, pos[1] - y)
            if d < best_d:
                best, best_d = key, d
        assert best is not None
        return best

    # -- travel --------------------------------------------------------
    def follows_map_roads(self) -> bool:
        return self.map_graph is not None

    def map_anchor_of_place(self, place_id: str, actor_id: str | None = None) -> str | None:
        """Where this building meets the traced road, if it is on one at all."""
        if self.map_roads is None:
            return None
        anchors = self.map_roads["anchors"]
        if place_id == HOME_PLACE:
            key = "HOME:%s" % actor_id
        elif place_id.startswith("HOME:"):
            key = place_id
        else:
            key = place_id
        row = anchors.get(key)
        return row["node"] if row else None

    def path_between(self, origin_place: str, dest_place: str,
                     actor_id: str | None = None) -> tuple[list[list[float]], float] | None:
        """The way from one door to another, as a polyline and its metres.

        Over the traced roads when both ends are on them: door -> the point on
        the lane nearest the door -> the road -> the other door. The stub at
        each end is the walk up the drive, and it is counted in the metres, so
        a house set back from the lane is not free to reach.
        """
        a = self.position_of_place(origin_place, actor_id)
        b = self.position_of_place(dest_place, actor_id)
        m_per_px = self.geometry["frame"]["mPerPx"]

        if self.map_graph is not None:
            start = self.map_anchor_of_place(origin_place, actor_id)
            goal = self.map_anchor_of_place(dest_place, actor_id)
            if start and goal:
                found = self.map_graph.path(start, goal)
                if found is not None:
                    chain, metres = found
                    line = self.map_graph.polyline(chain)
                    stub_px = (math.dist(a, line[0]) + math.dist(line[-1], b)) if line else 0.0
                    polyline = [list(a)] + line + [list(b)]
                    return (polyline, metres + stub_px * m_per_px)

        route = self.route(self.anchor_of_place(origin_place, actor_id),
                           self.anchor_of_place(dest_place, actor_id))
        return route

    def off_map_polyline(self, origin_place: str, dest_place: str,
                         actor_id: str | None = None) -> list[list[float]]:
        """The line for a trip that leaves the map: road first, then away.

        The off-map end has no road under it by definition, so the line runs
        from the last point on the map straight to wherever the registry puts
        the place. Everything before that is the road out.
        """
        from .world import OFF_MAP_PLACES  # circular at module level

        leaving = dest_place in OFF_MAP_PLACES
        off_place = dest_place if leaving else origin_place
        on_place = origin_place if leaving else dest_place
        off_point = list(self.position_of_place(off_place, actor_id))
        on_point = list(self.position_of_place(on_place, actor_id))

        exit_place = self.places.get(off_place, {}).get("exitPlace") or "TOWNEXIT"
        line: list[list[float]] = [on_point]
        if exit_place in self.places and on_place != exit_place:
            found = self.path_between(on_place, exit_place, actor_id)
            if found is not None:
                line = [list(p) for p in found[0]]
        elif on_place == exit_place:
            line = [on_point]
        line.append(off_point)
        return line if leaving else [list(p) for p in reversed(line)]

    def route(self, from_node: str, to_node: str) -> tuple[list[list[float]], float] | None:
        found = self.graph.path(from_node, to_node)
        if found is None:
            return None
        chain, metres = found
        return (self.graph.polyline(chain), metres)

    def travel_ms(self, metres: float, mode: str) -> int:
        speed = self.travel["driveMPerMin"] if mode == "drive" else self.travel["walkMPerMin"]
        minutes = max(1.5, metres / speed)
        return int(round(minutes * 60000))

    def off_map_town_ms(self) -> int:
        return int(self.travel["offMapTownMin"]) * 60000

    # -- assets --------------------------------------------------------
    def map_image_path(self) -> Path | None:
        """Where the raster lives, or ``None`` when this registry has no map.

        It sits next to the registry, outside the repository and outside the
        front-end bundle, and is served by the API rather than committed.
        """
        if not self.map_image:
            return None
        candidate = self.path.parent / self.map_image["file"]
        return candidate if candidate.exists() else None


def load_village(path: str | os.PathLike[str] | None = None) -> Village:
    if path is not None:
        target = Path(path)
    elif os.environ.get("MEDIAL_VILLAGE_PATH"):
        target = Path(os.environ["MEDIAL_VILLAGE_PATH"])
    elif IMPORTED.exists():
        target = IMPORTED
    else:
        target = SYNTHETIC
    data = json.loads(Path(target).read_text(encoding="utf-8"))
    return Village(data, Path(target))
