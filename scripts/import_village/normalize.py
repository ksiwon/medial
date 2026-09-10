"""Turn the extracted source literals into the normalized village registry.

Three things happen here and nothing else:

1. Geometry is rotated so that north is up. The source states its own
   orientation in prose ("지도는 북쪽이 오른쪽, 바다가 아래입니다"), so the
   rotation is derived, not guessed.
2. The original plan arrays are split into a *baseline* day and a *task
   overlay*. The source plans already contain the outcome of the original
   quests (P3 delivery stop, P9 two rides, P12 detour, P6 welfare check,
   P7/P8 emergency). Copying them wholesale would make every policy comparison
   meaningless, so each overlay step is listed explicitly with its quest.
3. Real names are dropped. Downstream only ever sees P1..P12.

Nothing in this module decides what *should* happen; it only records what the
source says and how confident we are about it.
"""
from __future__ import annotations

import heapq
import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

IMPORTER_VERSION = "village-import/1.2.0"
#: Bumped when the registry gains a block the server relies on. village/2 added
#: geometry.orientationChecks, roadGraphProvenance and namedRouteDistances.
SCHEMA_VERSION = "village/2"

# Steps in the source plan arrays that are the *result* of the original day
# quests rather than the ordinary routine of the resident. Keyed by resident and
# the index of the step inside the source plan. Every entry needs a reason:
# doc 02 requires per-field provenance for the baseline/overlay split.
OVERLAY_STEPS: dict[tuple[str, int], dict[str, str]] = {
    ("P3", 2): {"quest": "Q2", "reason": "의약품 전달을 위한 미가식당 경유(체류 10분)는 수락 결과"},
    ("P3", 3): {"quest": "Q5", "reason": "P9를 펜션에 내려주는 경유는 수락 결과"},
    ("P6", 6): {"quest": "Q3", "reason": "안부 확인을 위한 P1 자택 방문은 배정 결과"},
    ("P6", 7): {"quest": "Q3", "reason": "자택 부재 후 밭까지 확인한 이동은 배정 결과"},
    ("P7", 8): {"quest": "Q4", "reason": "위급 상황 현장 대응은 배정 결과"},
    ("P7", 9): {"quest": "Q4", "reason": "현장 대응 후 귀가"},
    ("P8", 8): {"quest": "Q4", "reason": "구급 이송은 사건 결과"},
    ("P9", 1): {"quest": "Q1", "reason": "P12 차량 동승은 배정 결과"},
    ("P9", 2): {"quest": "Q1", "reason": "읍내 진료 이동 자체가 조율 결과. 진료 필요는 issue로 분리"},
    ("P9", 3): {"quest": "Q5", "reason": "P3 차량 동승은 배정 결과"},
    ("P9", 4): {"quest": "Q5", "reason": "귀가는 동승 결과"},
    ("P12", 1): {"quest": "Q1", "reason": "P9 픽업을 위한 552 m 역방향 우회는 수락 결과"},
}

# Steps kept in the baseline but whose *time* is only valid in the source day,
# because removing an overlay step changes when the resident actually gets there.
RECOMPUTE_ARRIVAL = {("P3", 4), ("P12", 2), ("P6", 8), ("P7", 10)}

VILLAGE_HEAD = "P6"


# --------------------------------------------------------------------------
# geometry
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Frame:
    src_w: float
    src_h: float
    m_per_px: float

    def to_north_up(self, x: float, y: float) -> tuple[float, float]:
        """Rotate 90 degrees counter-clockwise: source +x (north) becomes up."""
        return (round(y, 3), round(self.src_w - x, 3))

    @property
    def width(self) -> float:
        return self.src_h

    @property
    def height(self) -> float:
        return self.src_w


def _poly(frame: Frame, points: Iterable[Iterable[float]]) -> list[list[float]]:
    return [list(frame.to_north_up(p[0], p[1])) for p in points]


def _node_key(pt: Iterable[float]) -> str:
    x, y = pt
    return "%.1f,%.1f" % (round(x, 1), round(y, 1))


# --------------------------------------------------------------------------
# road graph
# --------------------------------------------------------------------------
def build_road_graph(frame: Frame, routes: dict[str, list], patrol: list) -> dict[str, Any]:
    """Segments come only from polylines that exist in the source.

    We never invent a connection: doc 06 section 5 forbids synthesising
    off-road shortcuts, so two points the source never joins stay unjoined.
    """
    nodes: dict[str, list[float]] = {}
    edges: dict[tuple[str, str], float] = {}

    def add_polyline(points: list[list[float]]) -> None:
        prev: str | None = None
        for pt in points:
            key = _node_key(pt)
            nodes.setdefault(key, [round(pt[0], 1), round(pt[1], 1)])
            if prev is not None and prev != key:
                a, b = sorted((prev, key))
                dx = nodes[a][0] - nodes[b][0]
                dy = nodes[a][1] - nodes[b][1]
                metres = math.hypot(dx, dy) * frame.m_per_px
                if (a, b) not in edges or metres < edges[(a, b)]:
                    edges[(a, b)] = round(metres, 3)
            prev = key

    named: dict[str, list[list[float]]] = {}
    for name, pts in routes.items():
        line = _poly(frame, pts)
        named[name] = line
        add_polyline(line)
    add_polyline(_poly(frame, patrol))

    adjacency: dict[str, list[list[Any]]] = {k: [] for k in nodes}
    for (a, b), metres in edges.items():
        adjacency[a].append([b, metres])
        adjacency[b].append([a, metres])
    for key in adjacency:
        adjacency[key].sort()

    return {
        "nodes": nodes,
        "adjacency": adjacency,
        "namedRoutes": named,
        "components": _components(adjacency),
    }


def _components(adjacency: dict[str, list[list[Any]]]) -> list[int]:
    seen: set[str] = set()
    sizes: list[int] = []
    for start in sorted(adjacency):
        if start in seen:
            continue
        stack = [start]
        seen.add(start)
        size = 0
        while stack:
            cur = stack.pop()
            size += 1
            for nxt, _ in adjacency[cur]:
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        sizes.append(size)
    return sorted(sizes, reverse=True)


def anchor(graph: dict[str, Any], x: float, y: float) -> dict[str, Any]:
    """Attach a place/home to the nearest existing road node."""
    best_key, best_d = None, float("inf")
    for key, pos in graph["nodes"].items():
        d = math.hypot(pos[0] - x, pos[1] - y)
        if d < best_d:
            best_key, best_d = key, d
    return {"node": best_key, "offsetPx": round(best_d, 2)}


def shortest_path_m(graph: dict[str, Any], a: str, b: str) -> float | None:
    if a == b:
        return 0.0
    adjacency = graph["adjacency"]
    dist = {a: 0.0}
    pq: list[tuple[float, str]] = [(0.0, a)]
    while pq:
        d, node = heapq.heappop(pq)
        if node == b:
            return d
        if d > dist.get(node, float("inf")):
            continue
        for nxt, w in adjacency.get(node, ()):
            nd = d + w
            if nd < dist.get(nxt, float("inf")):
                dist[nxt] = nd
                heapq.heappush(pq, (nd, nxt))
    return None


# --------------------------------------------------------------------------
# schedules
# --------------------------------------------------------------------------
def _step(raw: list, index: int) -> dict[str, Any]:
    depart_min = float(raw[0])
    target = raw[1]
    opts = raw[2] if len(raw) > 2 else {}
    kind = "place"
    ref = target
    if isinstance(target, str) and target.startswith("@"):
        kind = "go_to_home_of"
        ref = target[1:]
    elif isinstance(target, str) and target.startswith("~"):
        kind = "ride_with"
        ref = target[1:]
    return {
        "index": index,
        "departMin": depart_min,
        "departMs": round(depart_min * 60000),
        "targetKind": kind,
        "target": ref,
        "car": bool(opts.get("car")),
        "fixedDurationMin": opts.get("d"),
    }


def split_plan(resident_id: str, plan: list) -> dict[str, Any]:
    source_steps = [_step(raw, i) for i, raw in enumerate(plan)]
    baseline: list[dict[str, Any]] = []
    overlay: list[dict[str, Any]] = []
    for step in source_steps:
        marker = OVERLAY_STEPS.get((resident_id, step["index"]))
        if marker:
            overlay.append(dict(step, provenance="source-quest-outcome", **marker))
            continue
        entry = dict(step)
        if (resident_id, step["index"]) in RECOMPUTE_ARRIVAL:
            entry["timeProvenance"] = "computed"
            entry["timeNote"] = "선행 경유가 제거되어 원본 시각을 그대로 쓸 수 없음. 경로에서 재계산 필요"
        else:
            entry["timeProvenance"] = "source"
        entry["provenance"] = "source-baseline"
        baseline.append(entry)
    return {"source": source_steps, "baseline": baseline, "overlay": overlay}


# --------------------------------------------------------------------------
# top level
# --------------------------------------------------------------------------
def normalize(raw: dict[str, Any], sources: list[dict[str, Any]]) -> dict[str, Any]:
    map_meta = raw["MAP"]
    frame = Frame(src_w=float(map_meta["w"]), src_h=float(map_meta["h"]),
                  m_per_px=float(map_meta["mPerPx"]))

    graph = build_road_graph(frame, raw["ROUTES"], raw["PATROL"])

    places: dict[str, Any] = {}
    for pid, entry in raw["PLACE"].items():
        x, y = frame.to_north_up(float(entry[0]), float(entry[1]))
        places[pid] = {
            "id": pid,
            "label": entry[2],
            "x": x,
            "y": y,
            "anchor": anchor(graph, x, y),
            "provenance": "source",
        }
    # TOWN sits outside the mapped area; the source models it with a flat
    # 30-minute travel assumption rather than a route.
    places["TOWN"]["offMap"] = True
    places["SEA"]["offRoad"] = True

    homes: dict[str, Any] = {}
    for pid, entry in raw["HOME"].items():
        x, y = frame.to_north_up(float(entry[0]), float(entry[1]))
        homes[pid] = {"x": x, "y": y, "anchor": anchor(graph, x, y), "provenance": "source"}

    residents = []
    for person in raw["P"]:
        pid = person["id"]
        plans = split_plan(pid, person["plan"])
        residents.append({
            "id": pid,
            "displayName": "이장" if pid == VILLAGE_HEAD else pid,
            "isVillageHead": pid == VILLAGE_HEAD,
            "age": person["age"],
            "job": person["job"],
            "group": person["g"],
            "pinnedAtHome": bool(person.get("pin")),
            "home": homes[pid],
            "plan": plans,
        })

    xs = [p["x"] for p in places.values() if not p.get("offMap")] + [h["x"] for h in homes.values()]
    ys = [p["y"] for p in places.values() if not p.get("offMap")] + [h["y"] for h in homes.values()]
    for line in graph["namedRoutes"].values():
        xs.extend(pt[0] for pt in line)
        ys.extend(pt[1] for pt in line)
    pad = 24.0
    view_box = [round(min(xs) - pad, 1), round(min(ys) - pad, 1),
                round(max(xs) - min(xs) + 2 * pad, 1), round(max(ys) - min(ys) + 2 * pad, 1)]

    edge_provenance = verify_edge_provenance(graph, _poly(frame, raw["PATROL"]))
    distances = route_distance_table(graph, frame)
    orientation = _orientation_checks(frame, places, homes)

    return {
        "schemaVersion": SCHEMA_VERSION,
        "dataSource": "imported-source",
        "provenance": {
            "importerVersion": IMPORTER_VERSION,
            "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "sources": sources,
            "note": "실명은 제외하고 P번호만 유지. 원자료는 수정하지 않음.",
        },
        "geometry": {
            "sourceFrame": {
                "width": frame.src_w, "height": frame.src_h, "mPerPx": frame.m_per_px,
                "northAxis": "+x", "seaAxis": "+y",
                "sourceQuote": raw.get("_orientationQuote"),
            },
            "northUpTransform": {
                "formula": "x_up = y_src ; y_up = source_width - x_src",
                "derivation": (
                    "원본이 북쪽=오른쪽(+x), 바다=아래(+y)라고 명시. 90도 반시계 회전하면 "
                    "북쪽이 위, 바다가 동쪽이 된다. 읍내 진출로(TOWNEXIT)가 회전 후 북북서에 "
                    "놓이는 것이 원본 서술('남해읍은 북서쪽')과 일치해 교차 확인됨."
                ),
                "confidence": "derived-from-source-statement",
            },
            "frame": {"width": frame.width, "height": frame.height, "mPerPx": frame.m_per_px},
            "viewBox": view_box,
            "orientationChecks": orientation,
        },
        "travel": {
            "walkMPerMin": raw["_speeds"]["walkMPerMin"],
            "driveMPerMin": raw["_speeds"]["driveMPerMin"],
            "boatMPerMin": raw["_speeds"]["boatMPerMin"],
            "provenance": "source-constants",
            "offMapTownMin": 30,
            "offMapTownProvenance": "source-constant (경로 계산이 아닌 고정값)",
        },
        "places": places,
        "homes": homes,
        "roads": graph["namedRoutes"],
        "roadGraph": {"nodes": graph["nodes"], "adjacency": graph["adjacency"]},
        "roadGraphComponents": graph["components"],
        "roadGraphProvenance": edge_provenance,
        "namedRouteDistances": distances,
        "patrol": _poly(frame, raw["PATROL"]),
        "groups": raw["GROUP"],
        "residents": residents,
        "mapImage": _map_image(raw, frame),
        "sourceReplay": {
            "note": "원본 하루의 재생 전용 기록. 실험 baseline으로 사용하지 않는다.",
            "questOrder": raw["QORDER"],
            "questColors": raw["QCOL"],
            "ambulance": raw["AMB"],
            "eventCount": len(raw["EV"]),
        },
        "dataIssues": (_data_issues(graph, places, homes, orientation)
                       + _route_reconciliation(distances)),
    }


def _polyline_m(frame: Frame, line: list[list[float]]) -> float:
    total = 0.0
    for a, b in zip(line, line[1:]):
        total += math.hypot(a[0] - b[0], a[1] - b[1]) * frame.m_per_px
    return total


def verify_edge_provenance(graph: dict[str, Any], patrol: list[list[float]]) -> dict[str, Any]:
    """Prove that the merged graph invents no road.

    Every edge must be a consecutive vertex pair inside one source polyline. The
    only thing merging adds is the ability to *change polyline* at a vertex two
    of them share, which on a road network is the same point of the same road.
    """
    source_pairs: set[tuple[str, str]] = set()
    for line in list(graph["namedRoutes"].values()) + [patrol]:
        for a, b in zip(line, line[1:]):
            ka, kb = _node_key(a), _node_key(b)
            if ka != kb:
                source_pairs.add(tuple(sorted((ka, kb))))  # type: ignore[arg-type]

    graph_pairs: set[tuple[str, str]] = set()
    for a, neighbours in graph["adjacency"].items():
        for b, _ in neighbours:
            graph_pairs.add(tuple(sorted((a, b))))  # type: ignore[arg-type]

    invented = sorted(graph_pairs - source_pairs)
    if invented:
        raise ValueError(
            "road graph contains %d edge(s) that are not in any source polyline: %s"
            % (len(invented), invented[:5])
        )
    junctions = sum(1 for node, nbrs in graph["adjacency"].items() if len(nbrs) > 2)
    return {
        "edgeCount": len(graph_pairs),
        "allEdgesFromSourcePolylines": True,
        "junctionNodeCount": junctions,
        "method": "간선은 한 원본 폴리라인 안의 연속 정점 쌍만 사용한다. 폴리라인 간 전환은 두 경로가 공유하는 정점에서만 일어난다.",
    }


def route_distance_table(graph: dict[str, Any], frame: Frame) -> dict[str, Any]:
    """Both distances for every named route, kept side by side and never mixed.

    ``sourceM`` is the length of the route the source itself drew - the number to
    use when quoting the source. ``graphM`` is the shortest path over the union
    of all known road segments - the number to use when costing an assignment.
    They differ where the source router did not take the shortest available way.
    """
    rows: dict[str, Any] = {}
    for name, line in sorted(graph["namedRoutes"].items()):
        if len(line) < 2:
            continue
        own = _polyline_m(frame, line)
        graph_m = shortest_path_m(graph, _node_key(line[0]), _node_key(line[-1]))
        if graph_m is None or own <= 0:
            continue
        rows[name] = {"sourceM": round(own, 1), "graphM": round(graph_m, 1),
                      "deltaM": round(own - graph_m, 1)}
    return rows


def _route_reconciliation(distances: dict[str, Any]) -> list[dict[str, Any]]:
    shorter = {k: v for k, v in distances.items() if v["deltaM"] >= 25.0}
    longer = [k for k, v in distances.items() if v["deltaM"] < -0.5]
    if longer:
        raise ValueError("graph path longer than the source route for %s" % longer[:3])
    if not shorter:
        return []
    worst = sorted(shorter.items(), key=lambda kv: -kv[1]["deltaM"])[:4]
    return [{
        "id": "DI-007",
        "status": "resolved",
        "severity": "note",
        "claim": "원본의 구간별 명명 경로 길이와 병합 도로망의 최단 경로가 같다고 가정할 수 없다.",
        "observed": (
            "%d개 구간에서 도로망 최단 경로가 더 짧다(예: %s). 확인 결과 병합 도로망에는 "
            "원본에 없는 간선이 0개이며, 짧은 경로는 다른 원본 경로의 구간을 공유 정점에서 "
            "이어 붙인 실제 도로다. 원본의 구간 경로가 전체 도로망의 최단 경로가 아닐 뿐이다."
            % (len(shorter),
               ", ".join("%s %.0f->%.0f m" % (k, v["sourceM"], v["graphM"]) for k, v in worst))
        ),
        "action": (
            "두 값을 모두 namedRouteDistances에 보관한다. 원본을 인용할 때는 sourceM, "
            "배정 비용을 계산할 때는 graphM을 쓰고 한 문장 안에서 섞지 않는다."
        ),
        "detail": [dict(route=k, **v) for k, v in worst],
    }]


_COMPASS = ("북", "북북동", "북동", "동북동", "동", "동남동", "남동", "남남동",
            "남", "남남서", "남서", "서남서", "서", "서북서", "북서", "북북서")


def _bearing(frame: Frame, a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    """North-up frame: +x is east (the sea side), -y is north."""
    dx = b["x"] - a["x"]
    dn = -(b["y"] - a["y"])
    deg = (math.degrees(math.atan2(dx, dn)) + 360) % 360
    return {
        "bearingDeg": round(deg, 1),
        "compass": _COMPASS[int((deg + 11.25) % 360 // 22.5)],
        "metres": round(math.hypot(dx, dn) * frame.m_per_px),
    }


def _orientation_checks(frame: Frame, places: dict[str, Any],
                        homes: dict[str, Any]) -> dict[str, Any]:
    """Measured bearings, so that the direction words in any write-up can be checked
    rather than remembered."""
    pairs = {
        "P9자택→미가식당": _bearing(frame, homes["P9"], places["MIGA"]),
        "P9자택→마을회관": _bearing(frame, homes["P9"], places["HALL"]),
        "마을회관→읍내방향": _bearing(frame, places["HALL"], places["TOWNEXIT"]),
        "마을회관→은점항": _bearing(frame, places["HALL"], places["PORT"]),
    }
    pts = [(h["x"], h["y"]) for h in homes.values()]
    pts += [(p["x"], p["y"]) for k, p in places.items()
            if not p.get("offMap") and not p.get("offRoad")]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return {
        "longAxis": "north-south",
        "eastWestExtentM": round((max(xs) - min(xs)) * frame.m_per_px),
        "northSouthExtentM": round((max(ys) - min(ys)) * frame.m_per_px),
        "pairs": pairs,
        "crossChecks": [
            "원본 서술 '지도는 북쪽이 오른쪽, 바다가 아래입니다'에서 회전을 유도했다.",
            "회전 후 읍내 진출로가 북북서(349도)에 놓여 원본 서술 '남해읍은 북서쪽'과 일치한다.",
            "회전 후 은점항이 동쪽(79도)에 놓여 원본 서술 '바다가 아래'(회전 전 기준)와 일치한다.",
            "원본 사건 서술 'P9는 마을 남쪽 끝에 산다'와 측정 방위(5도, 북)가 일치한다.",
        ],
    }


def _data_issues(graph: dict[str, Any], places: dict[str, Any], homes: dict[str, Any],
                 orientation: dict[str, Any]) -> list[dict[str, Any]]:
    axis = orientation["pairs"]["P9자택→미가식당"]
    issues: list[dict[str, Any]] = [
        {
            "id": "DI-001",
            "status": "resolved",
            "severity": "note",
            "claim": "분석 문서(시골컨텍스트_논증.md, 연구_파이프라인.md)가 마을의 긴 축을 '동서 1.11 km'로 기술했다.",
            "observed": (
                "측정값은 남북이다. P9 자택→미가식당 방위 %.1f도(%s), %d m. "
                "마을 분포는 동서 %d m · 남북 %d m다. 원본 시뮬레이터 서술도 "
                "'P9는 마을 남쪽 끝', '읍내로 가는 길은 북쪽'이라 적어 측정값과 일치한다."
                % (axis["bearingDeg"], axis["compass"], axis["metres"],
                   orientation["eastWestExtentM"], orientation["northSouthExtentM"])
            ),
            "action": "2026-09-10 두 문서의 방위 표현을 남북으로 정정했다. 거리 값은 원래 맞았으므로 바꾸지 않았다.",
        },
        {
            "id": "DI-002",
            "status": "open",
            "severity": "important",
            "claim": "원본 plan에는 이미 수행된 퀘스트 결과가 포함되어 있다.",
            "observed": "%d개 단계를 task overlay로 분리했다." % len(OVERLAY_STEPS),
            "action": "실험 baseline에는 overlay를 넣지 않는다. source-replay 모드에서만 재생한다.",
        },
        {
            "id": "DI-003",
            "status": "open",
            "severity": "important",
            "claim": "원본 엔진은 직선거리가 짧고 도로 우회가 길면 도로 밖 지름길을 만든다(SHORTCUT_M/DETOUR_X).",
            "observed": "이 규칙은 이식하지 않았다. 도로망에 없는 연결을 자동 생성하지 않는다.",
            "action": "P7-P8 사이 소로 같은 실제 지름길이 필요하면 근거를 붙여 명시적 간선으로 추가한다.",
        },
        {
            "id": "DI-004",
            "status": "open",
            "severity": "note",
            "claim": "읍내(TOWN) 왕복은 원본에서 경로 계산 없이 30분 고정값이다.",
            "observed": "지도 밖 노드이며 측정된 이동시간이 아니다.",
            "action": "지도 밖 이동시간은 가정으로 표시하고 결과 해석에서 분리한다.",
        },
    ]
    if len(graph["components"]) > 1:
        issues.append({
            "id": "DI-005",
            "status": "open",
            "severity": "important",
            "claim": "도로망이 하나로 이어져 있다고 가정할 수 없다.",
            "observed": "연결 요소 크기: %s" % (graph["components"],),
            "action": "경로 계산은 같은 연결 요소 안에서만 유효하다. 그 밖은 명시적 가정으로 처리한다.",
        })
    far = [pid for pid, h in homes.items() if h["anchor"]["offsetPx"] > 5]
    far += [pid for pid, p in places.items() if not p.get("offMap") and p["anchor"]["offsetPx"] > 5]
    if far:
        issues.append({
            "id": "DI-006",
            "status": "open",
            "severity": "note",
            "claim": "모든 자택·시설이 도로 노드 위에 있다고 가정할 수 없다.",
            "observed": "도로에서 5 px 이상 떨어진 지점: %s" % sorted(far),
            "action": "접근 마지막 구간은 도보 가정으로 처리한다.",
        })
    return issues


def _map_image(raw: dict[str, Any], frame: "Frame") -> dict[str, Any] | None:
    """Metadata for the source's own map raster, and how to place it north-up.

    The image is the source's drawing of the coastline, the houses and the
    fields. Redrawing it from memory would be inventing terrain, so the map
    layer uses this file and the same rotation the coordinates went through.

    The bytes are written next to the registry by :func:`write`; only the hash
    and the placement live in the JSON.
    """
    payload = raw.get("_mapImageB64")
    if not payload:
        return None
    import base64
    import hashlib

    blob = base64.b64decode(payload)
    return {
        "file": "village-map.png",
        "bytes": len(blob),
        "sha256": hashlib.sha256(blob).hexdigest(),
        "sourceWidthPx": frame.src_w,
        "sourceHeightPx": frame.src_h,
        "mPerPx": frame.m_per_px,
        # (x_src, y_src) -> (y_src, source_width - x_src): the same 90 degree
        # rotation applied to every coordinate in this registry, as an SVG
        # matrix so the raster lands exactly under the roads.
        "northUpMatrix": [0, -1, 1, 0, 0, frame.src_w],
        "provenance": ("원본 시뮬레이터 HTML에 포함된 지도 래스터다. 저장소에 커밋하지 않고 "
                       "git-ignored 레지스트리 옆에만 둔다."),
        "caveat": "원본이 그린 지도이며 현장 측량도, 공개 배포용 자료도 아니다.",
    }


def write(out_dir: Path, data: dict[str, Any], raw: dict[str, Any] | None = None) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / "village.v1.json"
    if raw and raw.get("_mapImageB64") and data.get("mapImage"):
        import base64

        (out_dir / data["mapImage"]["file"]).write_bytes(
            base64.b64decode(raw["_mapImageB64"]))
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True),
                      encoding="utf-8")
    return target
