"""Build fixtures/synthetic/village.synthetic.json.

The real village registry is derived from interview material and lives in
git-ignored local-data/. Tests, CI and a first-run demo must not depend on it,
so this script fabricates a village with the same schema and the same
*structural* features that the P1 scenario needs:

  * a resident who leaves home in the morning and returns at midday,
  * a village head who is mid-patrol at the time of the scenario,
  * a road graph that is connected, and an off-map town node.

Every coordinate, age and job here is invented. Nothing in this file describes a
real person or a real place.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from import_village.normalize import normalize  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]
OUT = REPO_ROOT / "fixtures" / "synthetic" / "village.synthetic.json"

# Source-frame coordinates (north = +x, sea = +y) so that normalize() rotates
# them the same way it rotates the real data.
MAIN_ROAD = [[60, 300], [240, 300], [420, 300], [600, 300], [780, 300], [960, 300], [1140, 300]]
SPUR_WEST = [[240, 300], [240, 180], [240, 120]]
SPUR_FARM = [[420, 300], [420, 170], [420, 90]]
SPUR_EAST = [[780, 300], [780, 400], [780, 450]]
SPUR_HALL = [[600, 300], [600, 220]]
SPUR_MIGA = [[1140, 300], [1140, 200]]


def _line(*chunks: list[list[int]]) -> list[list[float]]:
    out: list[list[float]] = []
    for chunk in chunks:
        for pt in chunk:
            if not out or out[-1] != pt:
                out.append([float(pt[0]), float(pt[1])])
    return out


def _reverse(name: str, routes: dict) -> None:
    a, b = name.split(">")
    routes[b + ">" + a] = list(reversed(routes[name]))


def build_raw() -> dict:
    routes: dict[str, list[list[float]]] = {}
    routes["MAIN"] = _line(MAIN_ROAD)
    routes["SPUR_W"] = _line(SPUR_WEST)
    routes["SPUR_F"] = _line(SPUR_FARM)
    routes["SPUR_E"] = _line(SPUR_EAST)
    routes["SPUR_H"] = _line(SPUR_HALL)
    routes["SPUR_M"] = _line(SPUR_MIGA)
    # A couple of named point-to-point routes, mirroring the shape of the source.
    routes["P1>FARM"] = _line([[300, 300]], [[420, 300]], SPUR_FARM[1:])
    _reverse("P1>FARM", routes)
    routes["P6>HALL"] = _line([[900, 300]], [[600, 300]], SPUR_HALL[1:])
    _reverse("P6>HALL", routes)

    patrol = _line(MAIN_ROAD, list(reversed(MAIN_ROAD)))

    place = {
        "HALL": [600, 220, "합성 마을회관"],
        "EXP": [780, 450, "합성 체험마을"],
        "FOOD": [780, 400, "합성 식품공장"],
        "MIGA": [1140, 200, "합성 식당"],
        "PORT": [240, 120, "합성 항구"],
        "SEA": [120, 470, "합성 조업 구역"],
        "FARM": [420, 90, "합성 밭"],
        "TOWNEXIT": [1140, 300, "합성 읍내 방향"],
        "TOWN": [1300, 300, "합성 읍내"],
    }
    home = {
        "P1": [300, 300], "P2": [660, 300], "P3": [480, 300], "P4": [540, 300],
        "P5": [720, 300], "P6": [900, 300], "P7": [840, 300], "P8": [800, 300],
        "P9": [60, 300], "P10": [1140, 200], "P11": [1140, 200], "P12": [360, 300],
    }
    group = {
        "four": {"label": "합성 4인", "note": "합성 데이터", "fill": "#23486B", "fg": "#FFFFFF"},
        "pair": {"label": "합성 2인", "note": "합성 데이터", "fill": "#8C4A3A", "fg": "#FFFFFF"},
        "couple": {"label": "합성 부부", "note": "합성 데이터", "fill": "#4E6138", "fg": "#FFFFFF"},
        "cousin": {"label": "합성 친척", "note": "합성 데이터", "fill": "#9A7530", "fg": "#FFFFFF"},
        "solo": {"label": "합성 단독", "note": "합성 데이터", "fill": "#FFFFFF", "fg": "#15222E"},
    }
    people = [
        {"id": "P1", "name": "P1", "age": 70, "job": "합성 직업 A", "g": "solo",
         "plan": [[0, "HOME"], [540, "FARM"], [720, "HOME"], [780, "FARM"], [960, "HOME"]]},
        {"id": "P2", "name": "P2", "age": 65, "job": "합성 직업 B", "g": "pair",
         "plan": [[0, "HOME"], [420, "TOWN"], [1020, "HOME"]]},
        {"id": "P3", "name": "P3", "age": 65, "job": "합성 직업 C", "g": "solo",
         "plan": [[0, "HOME"], [540, "TOWN"], [780, "MIGA", {"d": 10}], [793, "@P9", {"car": 1}],
                  [807, "HOME", {"car": 1}]]},
        {"id": "P4", "name": "P4", "age": 55, "job": "합성 직업 D", "g": "four",
         "plan": [[0, "HOME"], [480, "FOOD"], [1020, "EXP"], [1140, "HOME"]]},
        {"id": "P5", "name": "P5", "age": 68, "job": "합성 직업 E", "g": "pair",
         "plan": [[0, "HOME"], [375, "PORT"], [395, "SEA"], [655, "PORT"], [690, "HOME"]]},
        {"id": "P6", "name": "P6", "age": 55, "job": "합성 이장", "g": "four",
         "plan": [[0, "HOME"], [420, "HALL"], [480, "PATROL"], [600, "HOME"], [715, "FOOD"],
                  [780, "PATROL"], [918.3, "@P1"], [932.3, "FARM"], [960, "HOME"]]},
        {"id": "P7", "name": "P7", "age": 58, "job": "합성 직업 F", "g": "four",
         "plan": [[0, "HOME"], [330, "PORT"], [350, "SEA"], [650, "PORT"], [712, "FOOD"],
                  [780, "PORT"], [1020, "EXP"], [1140, "HOME"], [1230.5, "@P8"], [1271, "HOME"]]},
        {"id": "P8", "name": "P8", "age": 57, "job": "합성 직업 G", "g": "four",
         "plan": [[0, "HOME"], [330, "PORT"], [350, "SEA"], [650, "PORT"], [712, "FOOD"],
                  [780, "PORT"], [1020, "EXP"], [1140, "HOME"], [1265, "TOWN", {"d": 5.5}]]},
        {"id": "P9", "name": "P9", "age": 58, "job": "합성 직업 H", "g": "solo",
         "plan": [[0, "HOME"], [485.5, "~P12"], [518, "TOWN"], [780, "~P3"], [805, "HOME"]]},
        {"id": "P10", "name": "P10", "age": 74, "job": "합성 식당", "g": "couple", "pin": True,
         "plan": [[0, "HOME"]]},
        {"id": "P11", "name": "P11", "age": 78, "job": "합성 식당", "g": "couple", "pin": True,
         "plan": [[0, "HOME"]]},
        {"id": "P12", "name": "P12", "age": 62, "job": "합성 직업 I", "g": "cousin",
         "plan": [[0, "HOME"], [480, "@P9", {"car": 1}], [488, "TOWN"], [1080, "HOME"],
                  [1133, "MIGA"], [1260, "HOME"]]},
    ]

    return {
        "MAP": {"w": 1230, "h": 490, "mPerPx": 0.981, "src": "<synthetic>"},
        "ROUTES": routes,
        "PATROL": patrol,
        "PLACE": place,
        "HOME": home,
        "GROUP": group,
        "QCOL": {},
        "QORDER": [],
        "P": people,
        "AMB": {},
        "EV": [],
        "_orientationQuote": "합성 데이터 (원본 서술 없음)",
        "_speeds": {"walkMPerMin": 70.0, "driveMPerMin": 300.0, "boatMPerMin": 100.0},
    }


def main() -> int:
    data = normalize(build_raw(), [{"name": "synthetic", "sha256": "n/a", "bytes": 0}])
    data["dataSource"] = "synthetic"
    data["provenance"]["note"] = (
        "합성 데이터입니다. 실제 주민·좌표·일과가 아닙니다. "
        "테스트와 첫 실행 데모에만 사용합니다."
    )
    data["sourceReplay"]["note"] = "합성 데이터에는 원본 재생 기록이 없습니다."
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    print("wrote %s" % OUT)
    print("  road components: %s" % data["roadGraphComponents"])
    print("  residents: %d" % len(data["residents"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
