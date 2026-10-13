"""Rewrites the words of exhibition scenes in the voice of the village, one scene at a time.

    python scripts/gen_dialogue.py one att-exh-0 w2 w3     # print only; nothing is stored
    python scripts/gen_dialogue.py all --out lines.json    # every attempt's two scenes -> a file
    python scripts/gen_dialogue.py apply lines.json        # put them in the record (backs it up first)

What it keeps: the scene's frame (who is where), its cast, and the facts that are said -
what MEDial told, what the person answered, who went where. What it rewrites: the
wording and the number of turns. The rules are the researcher's (2026-10-10):
two people speak, each three or four times; a line is one breath (about thirty
characters); the old record's way of speaking is the standard (the lines already in the
record are the examples given to the model). ``one`` and ``all`` only read the record and write a file; ``apply`` is the one step that
writes it, after the researcher has read the lines, and keeps ``sim.before-dialogue.sqlite3``.
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
- MEDial은 어르신들과 사는 마을의 안내 시스템이다. 어르신께 말하듯 따뜻하고 정중하게, 부드러운 해요체 존댓말로 말한다("~하셨어요", "~해 주시겠어요?"). 딱딱한 통보로 끊지 않고, 짧은 공감이나 안심 한마디를 곁들인다("놀라셨겠어요", "제가 곁에 있을게요", "수고가 많으세요"). 마을 사람은 직함이나 '어르신'으로 부른다. 기관 담당자(보건소 등)와는 예의 바르게만 말한다.
- MEDial은 상황을 설명한다. 듣는 사람이 앞뒤를 모르고 와도 알아듣게, 왜 말을 거는지(무슨 일이 있었는지), 지금 무엇을 알고 무엇은 모르는지, 무엇을 부탁하고 그것이 왜 필요한지를 첫 줄들에서 차근히 말한다. 주어진 사실과 '앞에서 있었던 일'에 있는 것만으로 설명한다.
- 되풀이하지 않는다. 한 사실은 장면에서 한 번만 말한다. 같은 질문을 다시 묻거나, 이미 한 말을 다른 말로 반복하거나, 같은 변명을 두 번 하지 않는다. 모든 줄은 새 정보·반응·결정 가운데 하나를 더해 이야기를 앞으로 나아가게 한다. 기록의 대사에 같은 말이 되풀이된 곳이 있어도 한 번만 담는다.
- 마을 사람의 한 줄은 한 호흡이다. 공백 포함 30자 안팎, 길어도 36자를 넘기지 않는다. MEDial의 한 줄은 상황 설명을 담느라 40자 안팎, 길어도 44자를 넘기지 않는다. 한 줄은 한 문장이다.
- 장면에서 말하는 두 화자가 각자 3번 이상 4번 이하로 말한다. 번갈아 말하되, 같은 사람이 연달아 두 줄 말하는 것은 한 번까지만 허용한다.
- 장면의 사실은 바꾸지 않는다. 주어진 '반드시 오가는 사실'은 모두 말이나 반응으로 들어가야 하고, 그 밖의 새 사실(새 사건, 새 인물, 새 시각, 새 병명)은 만들지 않는다. 사실이 적으면 줄을 억지로 늘리지 말고, 정말로 사람이 할 법한 반응(걱정, 안도, 짜증, 농담)으로 3번을 채운다.
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


def write(provider, policy, records, village, attempt_id, request_id, feedback=None):
    scenes = records[attempt_id]
    ep, lines, cast = scene_of(scenes, request_id)
    places = [f["label"] + (" · " + f["device"] if f["device"] else "") for b in ep["beats"] for f in b["frames"]]
    panel = scenes["panels"].get(request_id, {})
    before = []
    for other in scenes["episodes"]:
        if other is ep or other["startMs"] > ep["startMs"] or (other["startMs"] == ep["startMs"] and other["requestId"] == request_id):
            continue
        if other["subjectId"] != ep["subjectId"] or other["requestId"] == request_id:
            continue
        before += ["%s: %s" % (l["speaker"], l["text"]) for b in other["beats"] for l in b["lines"] if l["kind"] == "say"]
    payload = {
        "장면": "%d일차 · %s · %s" % (scenes["day"], ep["title"], " / ".join(dict.fromkeys(places))),
        "화자": [who(village, c) for c in cast],
        "MEDial이 아는 것": (panel.get("judgment") or {}).get("knows"),
        "반드시 오가는 사실(지금 기록의 대사. 말투는 새로 쓰고 사실은 모두 담는다)": [
            "%s: %s" % (ln["speaker"], ln["text"]) for ln in lines],
        "앞에서 있었던 일(듣는 사람이 알 수 있는 것. 되풀이하지 말 것)": before[-10:],
        "사람별 말버릇 예시(기록에 있는 줄)": voices(records, cast),
    }
    if feedback:
        payload["지난번 시도에서 고칠 것"] = feedback
    spec_user = json.dumps(payload, ensure_ascii=False)
    client = provider._client(policy.headModelId)
    raw, usage = client._post(SYSTEM, payload, SCHEMA, "scene_lines", 2000)
    data = raw if isinstance(raw, dict) else json.loads(raw)
    return cast, lines, data["lines"], len(spec_user)


def _bigrams(text):
    t = "".join(ch for ch in text if ch.isalnum())
    return {t[i:i + 2] for i in range(len(t) - 1)}


def repeats(new):
    """Pairs of lines that say nearly the same thing (character bigram overlap)."""
    found = []
    for i in range(len(new)):
        for j in range(i + 1, len(new)):
            a, b = _bigrams(new[i]["text"]), _bigrams(new[j]["text"])
            if a and b and len(a & b) / min(len(a), len(b)) >= 0.5:
                found.append("되풀이: '%s' / '%s'" % (new[i]["text"], new[j]["text"]))
    return found


def problems(cast, new):
    bad = []
    count = {c: 0 for c in cast}
    for ln in new:
        if ln["speaker"] not in count:
            bad.append("화자 아님: %s" % ln["speaker"])
            continue
        count[ln["speaker"]] += 1
        if len(ln["text"]) > (44 if ln["speaker"] == "MEDial" else 36):
            bad.append("길다(%d자): %s" % (len(ln["text"]), ln["text"]))
    for c, n in count.items():
        if not 3 <= n <= 4:
            bad.append("%s %d번 말함" % (c, n))
    bad += repeats(new)
    return bad, count


# Two scenes a day (researcher, 2026-10-10). The picks are the Tasks whose two speakers
# are the people the day's evaluations are about: day 1 the check-in and the visit,
# day 2 the hospital ride that is not found and the visit again, day 3 the visit
# (a repeat the designer's rules change) and the emergency.
PICK = {1: ["w2", "w3"], 2: ["t2", "w3"], 3: ["w3", "e2"]}
RETRIES = 3  # a scene is asked again, with the problems named, up to this many times


def pick_episodes(scenes):
    out = []
    for rid in PICK[scenes["day"]]:
        found = [e for e in scenes["episodes"] if e["requestId"] == rid
                 and len({l["speaker"] for b in e["beats"] for l in b["lines"] if l["kind"] == "say"}) == 2]
        if not found:
            raise SystemExit("%s: no two-person scene %s" % (scenes["day"], rid))
        out.append(found[0])
    return out


def generate_all(provider, policy, records, village, out_path):
    cache: dict[str, list] = {}
    result: dict[str, dict] = {}
    for attempt_id, scenes in records.items():
        result[attempt_id] = {}
        for ep in pick_episodes(scenes):
            _ep, old, cast = scene_of(scenes, ep["requestId"])
            key = json.dumps([[l["speaker"], l["text"]] for l in old], ensure_ascii=False)
            if key not in cache:
                new, bad, feedback = None, [], None
                for _ in range(RETRIES + 1):
                    cast, _old, new, _n = write(provider, policy, records, village, attempt_id, ep["requestId"], feedback)
                    bad, _count = problems(cast, new)
                    if not bad:
                        break
                    feedback = {"문제": bad, "지난 줄": new}
                    print("  다시:", attempt_id, ep["requestId"], bad)
                cache[key] = {"cast": cast, "lines": new, "problems": bad}
            result[attempt_id][ep["requestId"]] = cache[key]
        print(attempt_id, "day", scenes["day"], {r: len(v["lines"]) for r, v in result[attempt_id].items()})
        Path(out_path).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    return result


def apply(result):
    import shutil
    backup = DB.with_name("sim.before-dialogue.sqlite3")
    if not backup.exists():
        shutil.copy2(DB, backup)
    conn = sqlite3.connect(DB)
    for attempt_id, scenes_new in result.items():
        row = conn.execute("select scenes_json from attempts where id=?", (attempt_id,)).fetchone()
        scenes = json.loads(row[0])
        order = []
        for ep in pick_episodes(scenes):
            rid = ep["requestId"]
            new = scenes_new[rid]["lines"]
            beat = ep["beats"][0]
            # Only the places of the people in the scene: a call between MEDial and the health
            # centre does not also show the field where the person they talk about is.
            speakers = {l["speaker"] for l in new}
            here = [f for f in beat["frames"] if speakers & set(f["who"])]
            if here:
                beat["frames"] = here
            old = [l for l in beat["lines"] if l["kind"] == "say"]
            beat["lines"] = [{"seq": old[min(i * len(old) // len(new), len(old) - 1)]["seq"], "kind": "say",
                              "speaker": l["speaker"], "text": l["text"]} for i, l in enumerate(new)]
            order.append(rid)
        scenes["featured"] = order
        scenes["model"] = "gpt-6.1-sol"
        conn.execute("update attempts set scenes_json=? where id=?", (json.dumps(scenes, ensure_ascii=False), attempt_id))
    conn.commit()
    print("applied to", len(result), "attempts; backup", backup.name)


SOFTEN = """당신은 한국 시골 마을 어르신들과 대화하는 안내 시스템 MEDial의 말을 다듬는 작가다. 장면의 대사가 주어진다.
MEDial의 줄만 고친다. 마을 사람들(MEDial이 아닌 화자)의 줄은 한 글자도 바꾸지 말고 같은 순서로 그대로 돌려준다. 줄 수와 순서도 그대로다.

MEDial의 말투:
- 어르신께 말하듯 따뜻하고 정중하게. 딱딱한 통보("모릅니다", "없습니다")로 끊지 말고, 짧은 공감이나 안심 한마디를 앞이나 뒤에 붙인다("놀라셨겠어요", "걱정 마세요, 제가 곁에 있을게요", "수고가 많으세요").
- "~하셨어요", "~해 주시겠어요?", "~드릴게요" 같은 부드러운 해요체 존댓말. 마을 사람을 부를 때는 직함이나 '어르신'을 쓴다.
- 상황을 설명한다. 듣는 사람이 앞뒤를 모르고 와도 알아듣게, MEDial이 왜 말을 거는지(무슨 일이 있었고), 지금 무엇을 알고 무엇은 모르는지, 그래서 무엇을 부탁하고 그것이 왜 필요한지를 첫 줄들에서 차근히 말한다. 주어진 대사와 '장면' 정보에 있는 사실만으로 설명하고, 없는 사실은 만들지 않는다.
- 사실·숫자·시각·절차의 순서는 그대로다. 새 사실은 만들지 않는다. 위급 장면에서는 침착하고 또렷하게, 한 번에 한 동작만 안내하고, 안심시키는 말을 곁들인다.
- MEDial의 한 줄은 공백 포함 40자 안팎, 길어도 44자를 넘기지 않는다(상황 설명을 담느라 마을 사람 줄보다 길어도 된다). 한 줄은 한 문장이다.
- 기관 담당자(보건소 등)와의 통화는 예의 바르되 어르신께 하는 말만큼 다정할 필요는 없다.
JSON만 돌려준다."""


def soften(provider, policy, cast, lines, scene=""):
    payload = {"장면": scene, "대사": lines, "MEDial 줄 수": sum(1 for l in lines if l["speaker"] == "MEDial")}
    client = provider._client(policy.headModelId)
    for _ in range(RETRIES):
        raw, _usage = client._post(SOFTEN, payload, SCHEMA, "scene_lines", 2000)
        data = (raw if isinstance(raw, dict) else json.loads(raw))["lines"]
        same = len(data) == len(lines) and all(
            n["speaker"] == o["speaker"] and (o["speaker"] == "MEDial" or n["text"] == o["text"])
            for n, o in zip(data, lines))
        long_ = [l["text"] for l in data if len(l["text"]) > (44 if l["speaker"] == "MEDial" else 36)]
        if same and not long_:
            return data
        print("  다시:", "남의 줄이 바뀜" if not same else long_)
    raise SystemExit("softening failed")


TITLES = {"w2": "응답 없는 안부 확인: MEDial이 이장에게 확인을 부탁", "w3": "응답 없는 안부 확인: 집에 가서 확인", "t2": "병원 동행: 갈 때 태워 줄 사람을 찾지 못함", "e2": "저녁의 위급: 쓰러진 사람 곁에서 구급대가 올 때까지"}


def soften_all(provider, policy, path, out):
    result = json.load(open(path, encoding="utf-8"))
    cache: dict[str, list] = {}
    for attempt_id, scenes in result.items():
        for rid, v in scenes.items():
            key = json.dumps(v["lines"], ensure_ascii=False)
            if key not in cache:
                cache[key] = soften(provider, policy, v["cast"], v["lines"], TITLES.get(rid, rid))
            v["lines"] = cache[key]
        print(attempt_id, "done")
    Path(out).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    soft = sub.add_parser("soften")
    soft.add_argument("file")
    soft.add_argument("--out", required=True)
    one = sub.add_parser("one")
    one.add_argument("attempt")
    one.add_argument("requests", nargs="+")
    one.add_argument("--out")
    allp = sub.add_parser("all")
    allp.add_argument("--out", required=True)
    ap_ = sub.add_parser("apply")
    ap_.add_argument("file")
    args = ap.parse_args()
    if args.cmd == "apply":
        apply(json.load(open(args.file, encoding="utf-8")))
        return
    provider = ModelProvider.from_env(env)
    policy = policy_from_env(env, mode="off")
    if args.cmd == "soften":
        soften_all(provider, policy, args.file, args.out)
        return
    records = load()
    village = json.load(open(VILLAGE, encoding="utf-8"))
    print("model:", policy.headModelId)
    if args.cmd == "all":
        generate_all(provider, policy, records, village, args.out)
        return
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
