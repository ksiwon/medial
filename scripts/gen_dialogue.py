"""Rewrites the words of exhibition scenes in the voice of the village, one scene at a time.

    python scripts/gen_dialogue.py att-exh-0 w2 w3         # print only; nothing is stored
    python scripts/gen_dialogue.py att-exh-0 w2 --out x.json

What it keeps: the scene's frame (who is where), its cast, and the facts that are said -
what MEDial told, what the person answered, who went where. What it rewrites: the
wording and the number of turns. The rules are the researcher's (2026-10-10):
two people speak, each three or four times; a line is one breath (about thirty
characters); the old record's way of speaking is the standard (the lines already in the
record are the examples given to the model). It reads the record and prints; it does
not write the record. A later step replaces the lines once the researcher has read
them.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
sys.stdout.reconfigure(encoding="utf-8")

env = dict(os.environ)
dotenv = ROOT / "server" / ".env"
if dotenv.exists():
    for line in io.open(dotenv, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env.setdefault(key.strip(), value.strip())

from app.simulation.agents.provider import ModelProvider, policy_from_env  # noqa: E402

DB = ROOT / "local-data" / "runs" / "sim.sqlite3"
VILLAGE = ROOT / "local-data" / "normalized" / "village.v1.json"

SYSTEM = """당신은 한국 시골 마을(경상도 해안 마을)의 일상 대화를 쓰는 작가다. 이 대화는 전시 화면에서 한 줄씩 말풍선으로 나오고, 음성으로도 읽힌다.

규칙:
- 실제 시골 어르신들이 말하듯 쓴다. 표준어로 번역한 말투가 아니라, 예시 줄에 나온 사람별 말버릇과 어미를 그대로 따른다(예: P6 "~제?", "~카더라", "~아이가", P7 "~습니더", "~뭡니꺼"). 예시에 없는 사투리를 새로 꾸미지 않는다.
- MEDial은 안내 시스템이다. 표준어 존댓말로, 짧고 정확하게 말한다.
- 한 줄은 한 호흡이다. 공백 포함 30자 안팎, 길어도 36자를 넘기지 않는다. 한 줄에 한 가지만 말한다.
- 장면에서 말하는 두 화자가 각자 3번 이상 4번 이하로 말한다. 번갈아 말하되, 같은 사람이 연달아 두 줄 말하는 것은 한 번까지만 허용한다.
- 장면의 사실은 바꾸지 않는다. 주어진 '반드시 오가는 사실'은 모두 말이나 반응으로 들어가야 하고, 그 밖의 새 사실(새 사건, 새 인물, 새 시각, 새 병명)은 만들지 않는다.
- 설명하듯 말하지 않는다. 사람들은 서로 아는 사이라 앞뒤를 줄여 말하고, 말을 받아 되묻거나 한숨·농담 한마디가 섞인다. 다만 사실은 놓치지 않는다.
- 숫자와 시각은 주어진 것만 쓴다. 따옴표, 괄호 설명, 이모지를 쓰지 않는다.
JSON만 돌려준다."""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "lines": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {"speaker": {"type": "string"}, "text": {"type": "string"}},
                "required": ["speaker", "text"],
            },
        },
    },
    "required": ["lines"],
}


def load():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("select id, scenes_json from attempts where scenes_json != '{}' order by rowid").fetchall()
    return {r["id"]: json.loads(r["scenes_json"]) for r in rows}


def voices(records, speakers, per=10):
    """Each speaker's lines already in the record - the standard of how they talk."""
    seen: dict[str, list[str]] = {s: [] for s in speakers}
    for scenes in records.values():
        for ep in scenes["episodes"]:
            for beat in ep["beats"]:
                for ln in beat["lines"]:
                    if ln["kind"] == "say" and ln["speaker"] in seen and ln["text"] not in seen[ln["speaker"]]:
                        seen[ln["speaker"]].append(ln["text"])
    out = {}
    for s, lines in seen.items():
        step = max(1, len(lines) // per)
        out[s] = lines[::step][:per]
    return out


def who(village, actor):
    if actor == "MEDial":
        return "MEDial (안내 시스템)"
    r = next((x for x in village["residents"] if x["id"] == actor), None)
    if not r:
        return actor
    return "%s (%d세, %s)" % (actor, r["age"], r["job"])


def scene_of(scenes, request_id):
    ep = next(e for e in scenes["episodes"] if e["requestId"] == request_id)
    lines = [ln for b in ep["beats"] for ln in b["lines"] if ln["kind"] == "say"]
    cast = []
    for ln in lines:
        if ln["speaker"] not in cast:
            cast.append(ln["speaker"])
    return ep, lines, cast


def write(provider, policy, records, village, attempt_id, request_id):
    scenes = records[attempt_id]
    ep, lines, cast = scene_of(scenes, request_id)
    places = [f["label"] + (" · " + f["device"] if f["device"] else "") for b in ep["beats"] for f in b["frames"]]
    panel = scenes["panels"].get(request_id, {})
    payload = {
        "장면": "%d일차 · %s · %s" % (scenes["day"], ep["title"], " / ".join(dict.fromkeys(places))),
        "화자": [who(village, c) for c in cast],
        "MEDial이 아는 것": (panel.get("judgment") or {}).get("knows"),
        "반드시 오가는 사실(지금 기록의 대사. 말투는 새로 쓰고 사실은 모두 담는다)": [
            "%s: %s" % (ln["speaker"], ln["text"]) for ln in lines],
        "사람별 말버릇 예시(기록에 있는 줄)": voices(records, cast),
    }
    spec_user = json.dumps(payload, ensure_ascii=False)
    client = provider._client(policy.headModelId)
    raw, usage = client._post(SYSTEM, payload, SCHEMA, "scene_lines", 2000)
    data = raw if isinstance(raw, dict) else json.loads(raw)
    return cast, lines, data["lines"], len(spec_user)


def problems(cast, new):
    bad = []
    count = {c: 0 for c in cast}
    for ln in new:
        if ln["speaker"] not in count:
            bad.append("화자 아님: %s" % ln["speaker"])
            continue
        count[ln["speaker"]] += 1
        if len(ln["text"]) > 36:
            bad.append("길다(%d자): %s" % (len(ln["text"]), ln["text"]))
    for c, n in count.items():
        if not 3 <= n <= 4:
            bad.append("%s %d번 말함" % (c, n))
    return bad, count


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("attempt")
    ap.add_argument("requests", nargs="+")
    ap.add_argument("--out")
    args = ap.parse_args()
    provider = ModelProvider.from_env(env)
    policy = policy_from_env(env, mode="off")
    records = load()
    village = json.load(open(VILLAGE, encoding="utf-8"))
    print("model:", policy.headModelId)
    result = {}
    for rid in args.requests:
        cast, old, new, _ = write(provider, policy, records, village, args.attempt, rid)
        bad, count = problems(cast, new)
        print("\n== %s %s  (화자 %s, 지금 %d줄 → 새 %d줄, 횟수 %s)" % (args.attempt, rid, cast, len(old), len(new), count))
        for ln in new:
            print("  %-6s %s" % (ln["speaker"], ln["text"]))
        print("  검사:", "통과" if not bad else bad)
        result[rid] = {"cast": cast, "lines": new, "problems": bad}
    if args.out:
        Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
