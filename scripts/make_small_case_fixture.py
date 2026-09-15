"""Build a *second* community: five people, new ids, no village head.

Why this exists (26번 3장, Phase 3): transferability cannot be checked against
a fixture that reuses 은점's ids and 은점's relation structure, because the
loaders would happily hand it 은점's edges and the head's assumed knowledge.
This community is called R1..R5, nobody holds the ``village_head`` role, and
its ledger records that most of the five questions were never asked - which is
what a community looks like before anyone has been interviewed properly.

It is derived from the synthetic village so the geometry is valid, and every
name, coordinate and routine in it is invented. Nothing here describes a real
person or place.

    python scripts/make_small_case_fixture.py
"""
from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC = REPO_ROOT / "fixtures" / "synthetic" / "village.synthetic.json"
OUT_VILLAGE = REPO_ROOT / "fixtures" / "synthetic" / "village.small-case.json"
OUT_LEDGER = REPO_ROOT / "fixtures" / "synthetic" / "ledger.small-case.json"

#: Five of the synthetic residents, renamed. The mapping is deliberately not
#: identity-preserving in either direction: an id here means nothing in the
#: other community, which is the property being tested.
RENAME = {"P1": "R1", "P9": "R2", "P10": "R3", "P3": "R4", "P4": "R5"}

TOPICS = ("companions", "help_contacts", "routine_knowers", "reachability",
          "decline_conditions")


def rename_places(value):
    """``HOME:P1`` and the like carry a resident id inside a place string."""
    if isinstance(value, str):
        for old, new in RENAME.items():
            if value == old:
                return new
            if value.endswith(":" + old):
                return value[: -len(old)] + new
        return value
    if isinstance(value, list):
        return [rename_places(v) for v in value]
    if isinstance(value, dict):
        return {rename_places(k): rename_places(v) for k, v in value.items()}
    return value


def main() -> None:
    data = json.loads(SRC.read_text(encoding="utf-8"))
    keep = set(RENAME)

    residents = []
    for resident in data["residents"]:
        if resident["id"] not in keep:
            continue
        row = rename_places(resident)
        row["id"] = RENAME[resident["id"]]
        row["displayName"] = RENAME[resident["id"]]
        # No role. A community without a village head is a community, not a
        # broken one, and nothing may fill the seat on its behalf.
        row["isVillageHead"] = False
        row["group"] = "unrecorded"
        residents.append(row)

    out = dict(data)
    out["residents"] = residents
    out["homes"] = {RENAME[k]: rename_places(v) for k, v in data["homes"].items()
                    if k in keep}
    out["groups"] = {"unrecorded": {"fill": "#6B7970", "fg": "#FFFFFF",
                                    "label": "관계 미채록",
                                    "note": "이 공동체는 동행 관계를 아직 묻지 않았다"}}
    out["dataSource"] = "synthetic"
    out["provenance"] = {
        **data.get("provenance", {}),
        "note": ("이전 가능성 검사용 두 번째 합성 공동체다. 5인, 새 id(R1~R5), 이장 역할 "
                 "없음. 은점마을의 관계·지역 지식은 들어 있지 않다."),
    }
    OUT_VILLAGE.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    # Mostly unasked, as a community that has had one short visit would be.
    entries = []
    for actor in sorted(RENAME.values()):
        for topic in TOPICS:
            if topic == "companions" and actor in ("R1", "R2"):
                entries.append({"actorId": actor, "topic": topic, "status": "asked_none",
                                "basis": "합성 사례 설정: '함께 다니는 사람' 문항"})
            else:
                entries.append({"actorId": actor, "topic": topic,
                                "status": "not_asked", "basis": ""})
    ledger = {
        "id": "ledger-small-case-v1",
        "label": "두 번째 합성 공동체 장부 (대부분 안 물어봄)",
        "entries": entries,
        # Empty on purpose: nobody has been recorded as knowing anybody's usual
        # places, and with no head role there is nobody to assume it of.
        "routineKnowledge": [],
        "assumptions": [
            "이 공동체에는 이장 역할이 없다. 빈집 다음 단계에서 물을 사람이 없는 것은 "
            "구현의 한계가 아니라 이 자료의 상태다.",
            "다섯 항목 중 넷은 아직 묻지 않았다. 빈칸은 '없음'이 아니다.",
        ],
    }
    OUT_LEDGER.write_text(json.dumps(ledger, ensure_ascii=False, indent=1), encoding="utf-8")
    print("%s  (%d명)" % (OUT_VILLAGE.name, len(residents)))
    print("%s  (%d칸)" % (OUT_LEDGER.name, len(entries)))


if __name__ == "__main__":
    main()
