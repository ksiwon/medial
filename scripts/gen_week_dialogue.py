"""Writes the words of the week's events from fixtures/week/briefs.json, in the voice of the village.

    python scripts/gen_week_dialogue.py make                    # every scene of every event
    python scripts/gen_week_dialogue.py make --only E1 E4       # some events
    python scripts/gen_week_dialogue.py make --only E1.A        # one request's after-scene
    python scripts/gen_week_dialogue.py read                    # dialogue.json -> dialogue.md, for the researcher

The events are a pool (docs/research/30_WEEK_TIMELINE_REDESIGN.md): an event's scenes carry a time of day
and never a weekday, so the same event can fall on another day of another session. Which day it falls on is
``fixtures/week/schedule.json``. A scene here is one of two kinds: a *before* scene (the rule as it is) or the
*after* scene of one request (the rule that request changes). Both are written from the brief's facts and
nothing else; what the model decides is the wording and the rhythm.

This writes only files. It never touches the stored record (sim.sqlite3) - that is the build step after the
researcher has read ``dialogue.md`` and said the lines are final. The old ``gen_dialogue.py`` made the
exhibition's first script and stays until ``tts_scenes.py`` reads this one instead.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
sys.stdout.reconfigure(encoding="utf-8")

WEEK = ROOT / "fixtures" / "week"
BRIEFS = WEEK / "briefs.json"
LINES = WEEK / "dialogue.json"
READ = WEEK / "dialogue.md"
RETRIES = 3

SYSTEM = """당신은 경남 남해군 은점마을(경상도 해안 마을)의 일상 대화를 쓰는 작가다. 이 대화는 전시 화면에 한 줄씩 말풍선으로 나오고 음성으로도 읽힌다. 주어진 '장면 설명'만 보고 대화를 쓴다.

사람과 말투
- 마을 사람(P로 시작하는 사람)은 모두 남해 은점마을 토박이이고 경상도 사투리를 쓴다. 번역투 표준어가 아니라 실제 어르신 입말로 쓴다. 단, 줄임말·뭉개기는 쓰지 않고 항상 온전한 문장으로 쓴다. 어미 예: ~제, ~노, ~나, ~아이가, ~카더라, ~다 아이가, ~습니더, ~됩니꺼, ~네예. 한 사람은 한 가지 말투(반말체인지 존대체인지)를 끝까지 지킨다.
- 장면 설명에 적힌 인물별 말투 지시를 따른다.
- AI는 어르신들과 사는 마을의 안내 스피커다. 이름을 말하지 않고 '제가'로 말한다. 표준어 해요체 존댓말로 또렷하고 간결하게, 어르신께 다정하되 늘어지거나 간지럽지 않게 말한다. 마을 사람은 직함이나 '어르신'으로 부른다. AI는 사람이 아니니 "곁에 있겠다" 같은 말은 하지 않는다. "전화로 계속 안내할게요"는 괜찮다.
- 보건소장은 표준어에 가깝게 정중하고 간결하게 말한다.

대화의 질
- 모든 줄은 바로 앞 줄에 반응한다. 물으면 바로 답하고, 앞 줄의 말끝이나 단어를 받아 이어 간다. 앞 줄과 상관없는 말을 불쑥 꺼내지 않는다. 이음말("그라믄", "아니", "그래서")을 자연스럽게 쓴다.
- 한 사실은 장면에서 한 번만 말한다. 같은 질문·변명·불만·안심을 되풀이하지 않는다. 모든 줄이 새 정보, 반응, 결정 중 하나를 더한다.
- 끝은 짧게 맺는다. 사실이 다 나오면 수고·작별 인사로 늘이지 않는다. 마지막 줄은 마음에 남는 한마디(불만, 안도, 결정)로 끝낸다.
- 장면 설명의 '반드시 나오는 사실'은 모두 담고, 그 밖의 새 사실(새 사건·인물·시각·병명·약 이름)은 만들지 않는다. 이미 아는 것을 새로 묻지 않는다. 사실에 없는 부탁·다짐·인사를 덧붙여 줄을 늘이지 않는다.
- 서로 부르는 말은 말투 지시에 적힌 것만 쓴다(예: 이장은 한상덕을 '형님'). 지시에 없는 이름이나 별명으로 부르지 않는다. 호칭은 그 밖에 직함이나 '어르신'으로.
- 번역투·한자어 투(예: '마뜩잖다', '~하니 ~하다')를 쓰지 않고 어르신이 실제로 할 법한 쉬운 말로 쓴다.
- 규칙이 바뀐 뒤의 장면이면, 바뀐 동작이 **장면 안의 말과 행동**으로 한눈에 드러나야 한다(요약하지 않는다). 그리고 장면 설명이 적은 부담(번거로움·민망함·미안함·늦어짐)도 대사에 한 번 나온다. 한쪽만 좋게 쓰지 않는다.
- 등장인물은 앞 장면이나 지난 일을 기억하는 듯 말하지 않는다. 장면 설명이 '앞서'라고 적은 것만 말한다.
- "공개 동의", "등록된 일과", "한도", "규칙" 같은 시스템 용어를 마을 사람이 입에 올리지 않는다. 마을 사람은 자기 눈으로 본 것, 느낀 것, 하려는 것을 말한다.

형식
- 화자는 장면 설명의 인물만. 줄 수는 '줄 수'를 따른다. 번갈아 말하고, 같은 사람이 연달아 두 줄 말하지 않는다.
- 마을 사람의 한 줄은 한 호흡, 공백 포함 30자 안팎(최대 36자). AI의 한 줄은 40자 안팎(최대 44자). 한 줄은 한 문장.
- 시각은 09:30처럼 쓴다. 따옴표, 괄호 설명, 이모지는 쓰지 않는다.
JSON으로 lines만 돌려준다. 각 줄의 speaker에는 '인물과 말투'에 적힌 **id만**(예: AI, P6) 쓴다. 이름이나 설명을 붙이지 않는다."""

EDIT = SYSTEM.replace(
    "주어진 '장면 설명'만 보고 대화를 쓴다.",
    "주어진 '장면 설명'과 '지금 대화'를 읽고, 위 규칙(특히 되풀이 · 앞 줄에 대한 응답 · 사실 누락 · 어색한 줄임말 · 끝이 늘어짐 · 바뀐 동작이 대사로 드러나는가 · 부담이 한 번 나오는가)을 점검해 고쳐 쓴다. 이미 매끄러운 줄은 그대로 둔다.")

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {"lines": {"type": "array", "items": {
        "type": "object", "additionalProperties": False,
        "properties": {"speaker": {"type": "string"}, "text": {"type": "string"}},
        "required": ["speaker", "text"]}}},
    "required": ["lines"],
}


def load() -> dict:
    return json.loads(BRIEFS.read_text(encoding="utf-8"))


def scenes_of(data: dict, only: list[str] | None):
    """Every scene to write as (key, event, kind, brief). Keys: ``E1.s1`` (before) and ``E1.A`` (after request A).
    ``--only E1`` takes the event, ``--only E1.A`` one scene."""
    out = []
    for ev in data["events"]:
        keys = [("%s.%s" % (ev["id"], k), "before", s) for k, s in ev["scenes"].items()]
        keys += [("%s.%s" % (ev["id"], k), "after", r["scene"]) for k, r in ev["requests"].items()]
        for key, kind, brief in keys:
            if only and not any(key == o or key.startswith(o + ".") for o in only):
                continue
            out.append((key, ev, kind, brief))
    return out


def _bigrams(text: str) -> set[str]:
    t = "".join(ch for ch in text if ch.isalnum())
    return {t[i:i + 2] for i in range(len(t) - 1)}


def problems(brief: dict, lines: list[dict]) -> list[str]:
    """What a scene must satisfy before it is kept."""
    cast = brief["cast"]
    lo, hi = brief["turns"]
    bad: list[str] = []
    count = {c: 0 for c in cast}
    for ln in lines:
        if ln["speaker"] not in count:
            bad.append("화자가 아님: %s" % ln["speaker"])
            continue
        count[ln["speaker"]] += 1
        limit = 44 if ln["speaker"] == "AI" else 36
        if len(ln["text"]) > limit:
            bad.append("%d자로 길다(%d자 이내): %s" % (len(ln["text"]), limit, ln["text"]))
        if "MEDial" in ln["text"] or "메디얼" in ln["text"]:
            bad.append("서비스 이름을 말하지 않는다(AI는 '제가'): %s" % ln["text"])
        if ln["speaker"] == "AI" and "곁에" in ln["text"]:
            bad.append("AI는 곁에 있다고 말하지 않는다: %s" % ln["text"])
    for c, n in count.items():
        if not lo <= n <= hi:
            bad.append("%s가 %d번 말함(%d~%d번)" % (c, n, lo, hi))
    if len(lines) > brief.get("maxLines", 6):
        bad.append("전체 %d줄(%d줄 이내)" % (len(lines), brief.get("maxLines", 6)))
    for i in range(len(lines)):
        for j in range(i + 1, len(lines)):
            a, b = _bigrams(lines[i]["text"]), _bigrams(lines[j]["text"])
            if a and b and len(a & b) / min(len(a), len(b)) >= 0.5:
                bad.append("되풀이: '%s' / '%s'" % (lines[i]["text"], lines[j]["text"]))
    for i in range(1, len(lines)):
        if lines[i]["speaker"] == lines[i - 1]["speaker"]:
            bad.append("한 사람이 연달아 두 줄: '%s'" % lines[i]["text"])
    return bad


def payload_of(data: dict, ev: dict, kind: str, brief: dict) -> dict:
    voices = {c: data["voices"][c] for c in brief["cast"]}
    p = {
        "장면 설명": brief["scene"],
        "인물과 말투(speaker에는 키만 쓴다)": voices,
        "반드시 나오는 사실(이것만. 새 사실 금지)": brief["facts"],
        "흐름": brief["order"],
        "끝": brief["ending"],
        "줄 수": "전체 %d줄 이내, 각자 %d~%d번" % (brief.get("maxLines", 6), *brief["turns"]),
    }
    if kind == "after":
        p["이 장면의 성격"] = "규칙이 바뀐 뒤의 장면: 바뀐 동작이 말과 행동으로 드러나게, 부담도 한 번 나오게"
    return p


def write(client, data: dict, key: str, ev: dict, kind: str, brief: dict) -> dict:
    """One scene: write, check, and when the checks fail ask again with the problems named."""
    payload = payload_of(data, ev, kind, brief)
    best: tuple[list[dict], list[str]] | None = None
    feedback = None
    tries = 0
    for attempt in range(RETRIES + 1):
        tries = attempt
        if feedback:
            payload["지난번 시도에서 고칠 것"] = feedback
        raw, _usage = client._post(SYSTEM, payload, SCHEMA, "scene_lines", 3000)
        lines = (raw if isinstance(raw, dict) else json.loads(raw))["lines"]
        bad = problems(brief, lines)
        if best is None or len(bad) <= len(best[1]):
            best = (lines, bad)
        if not bad:
            break
        feedback = {"문제": bad, "지난 줄": lines}
        print("  [%s] 다시 (%d): %s" % (key, attempt + 1, bad))
    assert best is not None
    lines, bad = best
    # An editor's pass over the checked scene: repetition, answers, dragging endings, the effect and its cost.
    edit = dict(payload_of(data, ev, kind, brief), **{"지금 대화": lines})
    raw, _usage = client._post(EDIT, edit, SCHEMA, "scene_edit", 3000)
    edited = (raw if isinstance(raw, dict) else json.loads(raw))["lines"]
    edited_bad = problems(brief, edited)
    if not edited_bad or len(edited_bad) <= len(bad):
        lines, bad = edited, edited_bad
    return {"event": ev["id"], "kind": kind, "cast": brief["cast"], "lines": lines, "problems": bad,
            "retries": tries}


def make(only: list[str] | None) -> None:
    from app.simulation.agents.provider import ModelProvider, policy_from_env  # noqa: E402

    env = dict(os.environ)
    dotenv = ROOT / "server" / ".env"
    if dotenv.exists():
        for line in io.open(dotenv, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env.setdefault(key.strip(), value.strip())
    provider = ModelProvider.from_env(env)
    policy = policy_from_env(env, mode="off")
    client = provider._client(policy.headModelId)
    print("model:", policy.headModelId)

    data = load()
    # What is already written stays; only the scenes asked for are written again.
    made = json.loads(LINES.read_text(encoding="utf-8"))["scenes"] if LINES.exists() else {}
    for key, ev, kind, brief in scenes_of(data, only):
        made[key] = write(client, data, key, ev, kind, brief)
        print("== %s %s (다시 쓴 횟수 %d)" % (key, "통과" if not made[key]["problems"] else made[key]["problems"], made[key]["retries"]))
        for ln in made[key]["lines"]:
            print("  %-8s %s" % (ln["speaker"], ln["text"]))
        LINES.write_text(json.dumps({"model": policy.headModelId, "scenes": made}, ensure_ascii=False, indent=1),
                         encoding="utf-8")
    read()


def read() -> None:
    """dialogue.json -> dialogue.md: each event as the researcher reads it, before and after side by side in order."""
    data, made = load(), json.loads(LINES.read_text(encoding="utf-8"))["scenes"]
    out = ["# 7일 타임라인 대화록 (검토용)", "",
           "`scripts/gen_week_dialogue.py read`가 `fixtures/week/dialogue.json`에서 만든 읽기용 문서다. 고치려면 JSON이나",
           "브리프를 고치고 다시 만든다. 사건은 요일에 묶이지 않으므로 요일은 쓰지 않는다. 화자 `AI` = AI 스피커.", ""]
    names = {ev["id"]: ev for ev in data["events"]}
    for ev in data["events"]:
        out += ["## %s. %s" % (ev["id"], ev["title"]), "", "> %s" % ev["gist"], ""]
        if ev.get("precedes"):
            out += ["_뒤에 이어지는 사건: %s_" % ev["precedes"], ""]
        if ev.get("precededBy"):
            out += ["_앞선 사건: %s_" % ev["precededBy"], ""]
        out += ["### 수정 전", ""]
        for k, s in ev["scenes"].items():
            out += _scene(made.get("%s.%s" % (ev["id"], k)), s["scene"])
        for k, r in ev["requests"].items():
            out += ["### 요청 %s — %s" % (k, r["label"]), "",
                    "- 번역되는 규칙: " + ", ".join(x["type"] for x in r["rules"]),
                    "- 기대: %s" % r["expect"], "- 부담: %s" % r["cost"], ""]
            out += _scene(made.get("%s.%s" % (ev["id"], k)), r["scene"]["scene"])
    READ.write_text("\n".join(out), encoding="utf-8")
    print("wrote", READ.relative_to(ROOT), "(%d events)" % len(names))


def _scene(scene: dict | None, situation: str) -> list[str]:
    out = ["*%s*" % situation, ""]
    if not scene:
        return out + ["(아직 쓰지 않음)", ""]
    out += ["> **%s** %s" % (ln["speaker"], ln["text"]) for ln in scene["lines"]]
    if scene["problems"]:
        out += ["", "⚠ 검사에 걸린 것: %s" % "; ".join(scene["problems"])]
    return out + [""]


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    mk = sub.add_parser("make")
    mk.add_argument("--only", nargs="*")
    sub.add_parser("read")
    args = ap.parse_args()
    if args.cmd == "read":
        read()
    else:
        make(args.only)


if __name__ == "__main__":
    main()
