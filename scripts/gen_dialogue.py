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


def load(path=DB):
    conn = sqlite3.connect(path)
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
        if not MIN_TURNS <= n <= 4:
            bad.append("%s %d번 말함" % (c, n))
    bad += repeats(new)
    return bad, count


# Two scenes a day (researcher, 2026-10-10). The picks are the Tasks whose two speakers
# are the people the day's evaluations are about: day 1 the check-in and the visit,
# day 2 the hospital ride that is not found and the visit again, day 3 the visit
# (a repeat the designer's rules change) and the emergency.
PICK = {1: ["w2", "w3"], 2: ["t2", "w3"], 3: ["w3", "e2"]}
MIN_TURNS = 3
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


EDIT = """당신은 한국 시골 마을(경남 남해, 경상도 사투리) 대화를 고치는 편집자다. 이 대화는 전시 화면에 한 줄씩 나오고 음성으로 읽힌다. 주어진 대화를 읽고 아래를 점검해 고쳐 쓴다.

점검:
1. 되풀이: 같은 사실·질문·변명·감정이 한 장면에서 두 번 나오면 한 번만 남기고, 빈 줄은 이야기를 나아가게 하는 새 반응(되묻기, 걱정, 놀람, 한숨, 결정)으로 바꾼다.
2. 티키타카: 모든 줄은 바로 앞 줄에 반응해야 한다. 앞 줄에서 물은 것에는 그 줄이 직접 답하고(예/아니오, 짧은 확인), 앞 줄의 단어나 말끝을 받아 이어 간다. 앞 줄과 상관없는 말을 불쑥 꺼내거나, 질문에 답 없이 다른 말을 하는 곳이 없어야 한다. 말이 이어질 때 "그래서", "아니", "그라믄" 같은 이음말을 자연스럽게 쓴다.
3. 사실: '반드시 담을 사실'은 모두 남긴다(장면에서 한 번씩). 새 사건·새 인물·새 시각·새 병명은 만들지 않는다. 사실이 없는 줄은 사람이 할 법한 반응으로 채운다.

규칙:
- 화자는 주어진 두 사람만, 각자 3번 이상 4번 이하. 번갈아 말하되 같은 사람이 연달아 두 줄은 한 번까지.
- 마을 사람의 말은 경상도 사투리 그대로(지금 줄의 말버릇과 어미를 유지: ~제, ~카더라, ~아이가, ~노, ~습니더 등). MEDial은 표준어 해요체 존댓말로 또렷하고 간결하게, 어르신께 다정하되 늘어지지 않게.
- 마을 사람의 한 줄은 공백 포함 30자 안팎(최대 36자), MEDial의 한 줄은 40자 안팎(최대 44자). 한 줄은 한 문장.
- 이미 매끄러운 줄은 그대로 둔다. 따옴표·괄호 설명·이모지 금지.
"추가 지시"가 있으면 위 규칙보다 우선한다.
JSON으로 problems(발견한 문제 목록, 한국어 한 줄씩)와 lines(고친 전체 대화)를 돌려준다."""

EDIT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "problems": {"type": "array", "items": {"type": "string"}},
        "lines": SCHEMA["properties"]["lines"],
    },
    "required": ["problems", "lines"],
}


EXTRA = {
    # day 2: the search for someone to drive Im Tae-sik is the point, and MEDial is the one who knows the bus.
    ("t2", None): {
        "반드시 담을 사실(원래 기록의 대사)": [
            "임태식(P9): 오늘 08:00에 읍내 의원 진료가 있는데 본인은 운전을 하지 않는다",
            "MEDial: 태워 줄 이웃을 찾아봤다",
            "MEDial이 찾은 과정: 남대현 어르신(P12)이 아침에 차로 읍내에 나가신다. 그런데 임태식 어르신 댁까지 돌아가려면 우회가 8분이라 정해 둔 한도 5분을 넘어서 부탁드리지 않았다",
            "결과: 태워 줄 사람이 없다 → 버스를 타야 한다",
            "MEDial이 버스를 알려 준다: 읍내 가는 버스는 한 시간에 한 대라, 08:00 진료에 맞추려면 일찍 나가야 한다(구체적인 버스 시각은 모르니 말하지 않는다)",
        ],
        "추가 지시": "MEDial이 먼저 사정을 묻고, 이웃을 찾아본 과정(누구를 생각했고 왜 안 됐는지)을 쉽게 풀어 말한 뒤 버스 안내까지 한다. 버스는 MEDial이 알려 주는 쪽이다(임태식이 알려 주지 않는다). 임태식은 반응하고 자기 사정을 말하는 정도. 각자 3~4번.",
    },
    ("w3", "nurse"): {"추가 지시": "보건소 담당자는 사투리를 거의 쓰지 않는다. 표준어 존댓말(~습니다, ~겠습니다)로 정중하고 간결하게 말한다. 각자 3~4번."},
    ("w3", "field"): {"추가 지시": "끝을 짧게 맺는다. 사실이 다 나오면 수고·작별 인사를 서로 주고받으며 늘이지 말고 한두 줄로 끝낸다. 이미 한 말(별일 없었다, 헛걸음, 자꾸 오면 불편하다)을 다시 꺼내지 않는다. 각자 2~4번."},
}


def extra_for(rid, cast):
    if rid == "t2":
        return EXTRA[("t2", None)]
    if rid == "w3":
        return EXTRA[("w3", "nurse" if "HC_NURSE" in cast else "field")]
    return {}


def polish_all(provider, policy, path, out, original_db):
    global MIN_TURNS
    records = load(original_db)
    village = json.load(open(VILLAGE, encoding="utf-8"))
    result = json.load(open(path, encoding="utf-8"))
    cache: dict[str, dict] = {}
    client = provider._client(policy.headModelId)
    for attempt_id, scenes in result.items():
        for rid, v in scenes.items():
            key = json.dumps(v["lines"], ensure_ascii=False)
            if key not in cache:
                _ep, old, cast = scene_of(records[attempt_id], rid)
                panel = records[attempt_id]["panels"].get(rid, {})
                payload = {
                    "장면": TITLES.get(rid, rid),
                    "화자": [who(village, c) for c in v["cast"]],
                    "MEDial이 아는 것": (panel.get("judgment") or {}).get("knows"),
                    "반드시 담을 사실(원래 기록의 대사)": ["%s: %s" % (l["speaker"], l["text"]) for l in old],
                    "지금 대화": v["lines"],
                }
                day = records[attempt_id]["day"]
                if rid == "w3":
                    payload["참고"] = ("이 안부 확인 방문은 %d일차이고, 1일차부터 날마다 같은 일이 있었다. 이번이 %d번째다. 횟수를 말한다면 "
                                    "이 숫자(이번까지 %d번째, 앞서 %d번)와 어긋나게 말하지 않는다." % (day, day, day, day - 1))
                extra = extra_for(rid, v["cast"])
                payload.update(extra)
                MIN_TURNS = 2 if "끝을 짧게" in extra.get("추가 지시", "") else 3
                best, feedback = None, None
                for _ in range(RETRIES + 1):
                    if feedback:
                        payload["지난번 시도에서 고칠 것"] = feedback
                    raw, _u = client._post(EDIT, payload, EDIT_SCHEMA, "scene_edit", 3000)
                    data = raw if isinstance(raw, dict) else json.loads(raw)
                    bad, _c = problems(v["cast"], data["lines"])
                    best = data
                    if not bad:
                        break
                    feedback = {"문제": bad, "지난 줄": data["lines"]}
                    print("  다시:", attempt_id, rid, bad)
                for l in best["lines"]:
                    l["text"] = l["text"].replace("메디알", "MEDial")
                cache[key] = {"cast": v["cast"], "lines": best["lines"], "problems": bad, "found": best["problems"]}
            scenes[rid] = cache[key]
        print(attempt_id, "polished")
    Path(out).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    pol = sub.add_parser("polish")
    pol.add_argument("file")
    pol.add_argument("--out", required=True)
    pol.add_argument("--original", default=str(DB.with_name("sim.before-dialogue.sqlite3")))
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
    if args.cmd == "polish":
        polish_all(provider, policy, args.file, args.out, args.original)
        return
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
