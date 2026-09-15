"""Read the roads off the map raster and pin the buildings onto them.

Why this exists
---------------
The registry's ``roads`` come from the source simulator's own polylines: a
graph whose edges are straight chords between the buildings it cared about.
It is provenance-clean - ``verify_edge_provenance`` proves no edge was invented
- but it is not the road network. Drawn over the map raster those chords run
through fields, across the bay and, for a trip to town, straight off the map
from the middle of the village. People on the map moved along them.

The raster under the village *is* a map: the lanes are drawn white and the
trunk road #fcd6a4. This traces those bands back into polylines, in the same
map units as the rest of the registry, and snaps every place and home onto the
nearest point of the network so a journey can start at a door and follow the
road.

What it does not do
-------------------
It does not touch ``roads``, ``roadGraph`` or ``namedRouteDistances``. Those
stay exactly as the source gave them, and the source's own distances become an
independent check on the traced network: the table this writes puts the two
side by side rather than replacing one with the other. Nothing here is a
measurement of the real village - it is a reading of a picture of it, and the
provenance block says so.

    python scripts/trace_map_roads.py            # writes into the registry
    python scripts/trace_map_roads.py --dry-run  # prints the table only

Needs numpy, Pillow and scikit-image. They are a tool dependency, not a server
one: the simulator only ever reads the block this writes.
"""
from __future__ import annotations

import argparse
import hashlib
import heapq
import json
import math
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image
from skimage.morphology import closing, disk, opening, remove_small_objects, skeletonize

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "local-data" / "normalized" / "village.v1.json"
RASTER = ROOT / "local-data" / "normalized" / "village-map.png"

#: The carto colours of the two things that are roads, and how wide a mark has
#: to be to count as one. OPEN drops the white halo around place labels (a
#: glyph outline is one or two pixels); CLOSE bridges the gap a label leaves
#: where it sits on top of a lane. Both were chosen by sweeping until the
#: network came out in one piece with every building within a plot's length of
#: it - the numbers are here so the sweep does not have to be repeated.
LANE_RGB, LANE_TOL = (255, 255, 255), 10
TRUNK_RGB, TRUNK_TOL = (252, 214, 164), 18
OPEN_R, CLOSE_R, MIN_BLOB = 1, 6, 400
#: Two skeleton ends this close are the same junction (skeletons fray at
#: crossings), and a dead end shorter than this is a mark, not a lane.
WELD_PX, SPUR_PX, RDP_PX = 3.0, 12.0, 1.2
#: Places that are deliberately not on a road: the fishing ground is at sea and
#: town is off the map. They keep their own anchors.
OFF_ROAD = ("SEA", "TOWN")

N8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def road_mask(im: np.ndarray) -> np.ndarray:
    def near(rgb, tol):
        return np.abs(im - np.array(rgb)).max(axis=2) <= tol

    mask = near(LANE_RGB, LANE_TOL) | near(TRUNK_RGB, TRUNK_TOL)
    mask = opening(mask, disk(OPEN_R))
    mask = closing(mask, disk(CLOSE_R))
    return remove_small_objects(mask, MIN_BLOB)


def rdp(points: list, eps: float) -> list:
    if len(points) < 3:
        return list(points)
    a, b = points[0], points[-1]
    den = math.dist(a, b)
    dmax, idx = 0.0, 0
    for i in range(1, len(points) - 1):
        p = points[i]
        d = (abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / den
             if den else math.dist(a, p))
        if d > dmax:
            dmax, idx = d, i
    if dmax <= eps:
        return [a, b]
    return rdp(points[:idx + 1], eps)[:-1] + rdp(points[idx:], eps)


def trace(raster: Path, north_span_px: float) -> list[list[list[float]]]:
    """Skeletonise the road bands and cut the skeleton into polylines.

    The source raster is landscape with north to the right; the registry is
    north-up. A source pixel at (row, col) is (row, width - col) in map units -
    the same transform the registry stores as ``mapImage.northUpMatrix``, whose
    offset is the raster's *width* because the rotation is a quarter turn.
    """
    im = np.asarray(Image.open(raster).convert("RGB")).astype(int)
    skeleton = skeletonize(road_mask(im))
    pix = set(map(tuple, np.argwhere(skeleton)))

    def neighbours(p):
        r, c = p
        return [(r + dr, c + dc) for dr, dc in N8 if (r + dr, c + dc) in pix]

    degree = {p: len(neighbours(p)) for p in pix}
    nodes = {p for p in pix if degree[p] != 2}

    def walk(start, first):
        path, prev, cur = [start, first], start, first
        while cur not in nodes:
            nxt = [q for q in neighbours(cur) if q != prev]
            if len(nxt) != 1:
                break
            prev, cur = cur, nxt[0]
            path.append(cur)
        return path

    def length(path):
        return sum(math.dist(a, b) for a, b in zip(path, path[1:]))

    edges, seen = [], set()
    for node in nodes:
        for first in neighbours(node):
            if (node, first) in seen:
                continue
            path = walk(node, first)
            seen.add((node, first))
            seen.add((path[-1], path[-2]))
            if degree[path[0]] == 1 or degree[path[-1]] == 1:
                if length(path) < SPUR_PX:
                    continue
            edges.append(path)

    def to_map(p):
        row, col = p
        return [round(float(row), 1), round(north_span_px - float(col), 1)]

    sys.setrecursionlimit(20000)
    out = []
    for edge in edges:
        line = [to_map(p) for p in rdp(edge, RDP_PX)]
        if len(line) >= 2:
            out.append(line)
    return out


def build_graph(polylines: list) -> tuple[dict, list]:
    """Adjacency over the traced vertices, with frayed ends welded together."""
    adjacency: dict[tuple, set] = defaultdict(set)
    for line in polylines:
        for a, b in zip(line, line[1:]):
            ka, kb = (round(a[0], 1), round(a[1], 1)), (round(b[0], 1), round(b[1], 1))
            if ka != kb:
                adjacency[ka].add(kb)
                adjacency[kb].add(ka)

    grid: dict[tuple, list] = defaultdict(list)
    for p in adjacency:
        grid[(int(p[0] // WELD_PX), int(p[1] // WELD_PX))].append(p)
    for p in list(adjacency):
        gx, gy = int(p[0] // WELD_PX), int(p[1] // WELD_PX)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for q in grid[(gx + dx, gy + dy)]:
                    if q != p and math.dist(p, q) <= WELD_PX:
                        adjacency[p].add(q)
                        adjacency[q].add(p)

    seen, components = set(), []
    for start in adjacency:
        if start in seen:
            continue
        stack, comp = [start], []
        seen.add(start)
        while stack:
            n = stack.pop()
            comp.append(n)
            for m in adjacency[n]:
                if m not in seen:
                    seen.add(m)
                    stack.append(m)
        components.append(comp)
    components.sort(key=len, reverse=True)
    return adjacency, components


def _project(p, a, b):
    """The closest point to ``p`` on the segment ``a``-``b``, and how far."""
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    den = dx * dx + dy * dy
    t = 0.0 if den == 0 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / den))
    q = (round(ax + t * dx, 1), round(ay + t * dy, 1))
    return q, math.dist(p, q)


def snap(adjacency: dict, component: set, point: tuple) -> tuple[tuple, float]:
    """Put ``point`` on the network, splitting the segment it lands on."""
    best, best_d, best_edge = None, math.inf, None
    for a in component:
        for b in adjacency[a]:
            if b not in component:
                continue
            q, d = _project(point, a, b)
            if d < best_d:
                best, best_d, best_edge = q, d, (a, b)
    assert best is not None and best_edge is not None
    a, b = best_edge
    if best not in (a, b):
        adjacency[a].discard(b)
        adjacency[b].discard(a)
        for end in (a, b):
            adjacency[best].add(end)
            adjacency[end].add(best)
        component.add(best)
    return best, best_d


def dijkstra(adjacency: dict, a: tuple, b: tuple):
    dist = {a: 0.0}
    prev: dict[tuple, tuple] = {}
    pq = [(0.0, a)]
    while pq:
        d, n = heapq.heappop(pq)
        if n == b:
            chain = [b]
            while chain[-1] != a:
                chain.append(prev[chain[-1]])
            return list(reversed(chain)), d
        if d > dist.get(n, math.inf):
            continue
        for m in adjacency[n]:
            nd = d + math.dist(n, m)
            if nd < dist.get(m, math.inf):
                dist[m] = nd
                prev[m] = n
                heapq.heappush(pq, (nd, m))
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    north_span_px = float(registry["mapImage"]["sourceWidthPx"])
    m_per_px = float(registry["geometry"]["frame"]["mPerPx"])

    polylines = trace(RASTER, north_span_px)
    adjacency, components = build_graph(polylines)
    largest = set(components[0])
    print("traced %d polylines, %d vertices, %d component(s), largest %d"
          % (len(polylines), len(adjacency), len(components), len(largest)))

    targets = {k: (p["x"], p["y"]) for k, p in registry["places"].items()}
    targets.update({"HOME:" + k: (h["x"], h["y"]) for k, h in registry["homes"].items()})

    anchors, worst = {}, (0.0, "")
    for name, point in sorted(targets.items()):
        if name in OFF_ROAD:
            continue
        # The door meets the road wherever the lane passes closest, which is
        # usually the middle of a segment, not one of its vertices. Snapping to
        # a vertex put houses a quarter of a kilometre from their own lane.
        node, offset = snap(adjacency, largest, point)
        anchors[name] = {"node": "%.1f,%.1f" % node, "offsetPx": round(offset, 1)}
        if offset > worst[0]:
            worst = (offset, name)
        print("  %-10s %6.1f m from the road" % (name, offset * m_per_px))
    print("furthest from a road: %s at %.1f m" % (worst[1], worst[0] * m_per_px))

    def node_of(name):
        return tuple(float(v) for v in anchors[name]["node"].split(","))

    table = {}
    for pair, row in registry["namedRouteDistances"].items():
        a, b = pair.split(">")
        ka = "HOME:" + a[1:] if a.startswith("P") and a[1:].isdigit() else a
        kb = "HOME:" + b[1:] if b.startswith("P") and b[1:].isdigit() else b
        if ka not in anchors or kb not in anchors:
            continue
        found = dijkstra(adjacency, node_of(ka), node_of(kb))
        if found is None:
            table[pair] = {"sourceM": row["sourceM"], "mapM": None, "deltaM": None}
            continue
        _, px = found
        metres = (px + anchors[ka]["offsetPx"] + anchors[kb]["offsetPx"]) * m_per_px
        table[pair] = {"sourceM": row["sourceM"], "mapM": round(metres, 1),
                       "deltaM": round(metres - row["sourceM"], 1)}
    deltas = [abs(r["deltaM"]) for r in table.values() if r["deltaM"] is not None]
    print("named routes: %d compared, mean |delta| %.1f m, max %.1f m"
          % (len(deltas), sum(deltas) / len(deltas) if deltas else 0.0,
             max(deltas) if deltas else 0.0))

    # The graph as the server will use it: the traced vertices *after* every
    # door was snapped in, so the simulator does not have to redo the snapping
    # and cannot end up with a slightly different network than this table
    # describes. Same shape as ``roadGraph``.
    reachable = {p for p in largest if p in adjacency}
    nodes = {"%.1f,%.1f" % p: [p[0], p[1]] for p in reachable}
    # Weights are metres, like ``roadGraph``: the server costs a trip in metres
    # and would otherwise walk a pixel a minute.
    graph_adjacency = {
        "%.1f,%.1f" % p: sorted(
            ["%.1f,%.1f" % q, round(math.dist(p, q) * m_per_px, 3)]
            for q in adjacency[p] if q in reachable
        )
        for p in reachable
    }

    block = {
        "polylines": polylines,
        "graph": {"nodes": nodes, "adjacency": graph_adjacency},
        "anchors": anchors,
        "offRoad": list(OFF_ROAD),
        "namedRouteComparison": table,
        "provenance": {
            "method": "지도 래스터에서 도로 색(흰 길 · 간선 #fcd6a4)을 골라 골격화한 뒤 "
                      "폴리라인으로 끊었다. 원본 시뮬레이터의 도로 폴리라인이 아니라 "
                      "지도 그림을 읽은 것이며, 실측이 아니다.",
            "raster": registry["mapImage"]["file"],
            "rasterSha256": registry["mapImage"]["sha256"],
            "params": {"laneRgb": list(LANE_RGB), "laneTol": LANE_TOL,
                       "trunkRgb": list(TRUNK_RGB), "trunkTol": TRUNK_TOL,
                       "openRadiusPx": OPEN_R, "closeRadiusPx": CLOSE_R,
                       "minBlobPx": MIN_BLOB, "weldPx": WELD_PX,
                       "spurPx": SPUR_PX, "simplifyPx": RDP_PX},
            "polylineCount": len(polylines),
            "graphNodeCount": len(nodes),
            "vertexCount": len(adjacency),
            "componentCount": len(components),
            "largestComponentVertices": len(largest),
            "tracedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "tool": "scripts/trace_map_roads.py",
            "toolSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()[:16],
        },
    }

    if args.dry_run:
        print("(dry run: registry not written)")
        return 0
    registry["mapRoads"] = block
    REGISTRY.write_text(json.dumps(registry, ensure_ascii=False), encoding="utf-8")
    print("wrote mapRoads into %s" % REGISTRY)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
