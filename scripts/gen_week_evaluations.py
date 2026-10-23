"""Writes the residents' evaluations of the week's events, from the dialogue they were in.

    python scripts/gen_week_evaluations.py make                  # every resident in every scene variant
    python scripts/gen_week_evaluations.py make --only E1 E4.B   # an event, or one variant
    python scripts/gen_week_evaluations.py link                  # which before-evaluation each request rests on
    python scripts/gen_week_evaluations.py explain               # why a weak basis is weak, one line per request
    python scripts/gen_week_evaluations.py compare               # how each request moved each resident's feedback
    python scripts/gen_week_evaluations.py read                  # evaluations.json -> evaluations.html, for the researcher

One evaluation is one resident's paragraph about one *variant* of one event: the event as it ran (the *before*
scenes) or as it ran after one request (the *after* scene of request A, B or C). It follows
docs/research/20_STRUCTURED_RESIDENT_EVALUATION.md as far as the screen reads it: a paragraph, and claims - each one
tagged good / bad / neutral / unknown / wish and resting on the lines it cites - and a disclaimer. The tag is the
simulated resident's own reading of one thing they went through, never a verdict on the whole and never a score; a
claim of any kind may cite only lines the resident was in the scene for. It is a simulated resident's reading, never a
real resident's opinion.

What makes it an evaluation and not a summary is the evidence rule (AGENTS.md): a resident may cite only the lines
they were in the scene for and heard. ``experienced`` is computed here from the dialogue - never by the model - and
the check refuses any citation outside it. The after-scene evaluations are read as "this decision, as it landed",
written without the earlier version (a resident does not remember it). A resident's reading also rests on their
interview: the persona summary (``PERSONAS``, outside the repository) goes in, and the part of it the reaction rests
on comes out as one line (``grounding``), so a reaction the interview does not support shows as such.

``link`` is the other half of the chain *before evaluation -> request -> after evaluation*. The evaluations are written
without knowing the requests (so they are not tuned to them); ``link`` then asks, per request, which before-evaluation
it rests on and quotes the passage - or says it rests on none. A request with no basis is not hidden: it is reported,
and the event's before scenes are what get fixed (docs/research/30 section 11), never the evaluation.

``compare`` is the last link, *request -> how the feedback moved*: per request and per resident in both versions,
which of their troubles the request resolved, which remained, which cannot be told, and which are new. It is a
reading of two feedbacks, said on screen as one; someone in only one version is not compared, only shown as gone or new.

Writes only files. The record (sim.sqlite3) is the later build step, after the researcher has read the evaluations.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8")

from model import Model  # noqa: E402
from gen_week_dialogue import walk_requests  # noqa: E402

WEEK = ROOT / "fixtures" / "week"
BRIEFS = WEEK / "briefs.json"
DIALOGUE = WEEK / "dialogue.json"
OUT = WEEK / "evaluations.json"
HTML = WEEK / "evaluations.html"
#: The twelve residents' personas, anonymised, as the researcher wrote them from the interviews. Outside the repository
#: (AGENTS.md: no source material in it): read here when evaluations are written, and only a resident's one-line
#: grounding - which part of their interview a reaction rests on, in the model's words - is kept.
PERSONAS = Path(os.environ.get("MEDIAL_PERSONAS") or ROOT.parents[1] / "5학년" / "AEL" / "URP" / "참여자 정보" / "은점마을_페르소나_익명.json")
#: The parts of a persona a reaction may rest on. Its verbatim words (대표_발언) are never sent: a summary is enough.
FIELDS = ["하루", "건강", "의료 행동", "디지털", "AI 태도", "관계", "연기 지침"]
RETRIES = 3
DISCLAIMER = "시뮬레이션 산출물이다. 실제 주민의 발언·만족도·임상 결과가 아니다."

SYSTEM = """당신은 경남 남해군 은점마을의 한 주민이다. 방금 겪은 일을 되돌아보며, 안부를 살피고 이웃을 이어 주는 AI에 대한 생각을 짧게 말한다. 이것은 전시에서 '시뮬레이션 주민의 피드백'으로 읽힌다. 실제 주민의 의견이 아니다.

쓰는 법
- 평가 기록의 문체로 쓴다. 문장은 모두 '~임', '~함', '~음', '~됨' 같은 명사형으로 끝낸다('~다', '~요', '~제', '~네'로 끝내지 않는다). 사투리와 구어체 말투를 쓰지 않는다. 1인칭 시점(내가 겪은 일)은 유지하되 '나는' 같은 주어는 꼭 필요할 때만 쓴다. 한 단락(60~120자)으로 쓴다. 번역투를 쓰지 않는다.
- 인물 설명은 무엇을 겪었고 어떤 처지인지 알려 주는 용도이다. 그 사람의 말투를 흉내 내지 않는다.
- 인터뷰 요약은 이 사람이 실제 인터뷰에서 보인 일과·건강·AI에 대한 태도와 우려다. 겪은 일을 이 사람이라면 어떻게 받아들일지는 인터뷰 요약에서 나와야 한다. 인터뷰 요약에 없는 성격·가치·걱정을 지어내지 않는다. 인터뷰 요약과 겪은 일이 어긋나면 겪은 대로 말하되 억지로 맞추지 않는다.
- 끝으로 grounding을 쓴다: 이 반응이 가장 크게 기대는 인터뷰 요약의 항목 이름(field)과, 그 항목에서 이 반응과 이어지는 내용을 한 문장으로 다시 쓴 것(note, 15~60자, '~함'·'~임' 체, 인터뷰의 말을 그대로 옮기지 않는다). 기대는 항목이 없거나 인터뷰 요약이 없으면 field와 note를 모두 빈 문자열로 둔다.
- 겪은 줄(ㄱ~) 안에서만 말한다. 자기가 없던 장면, 듣지 못한 말, 대화에 없는 사실(새 병명·시각·이름)은 말하지 않는다.
- 단락 다음에 claims를 쓴다. claims는 겪은 일 하나하나에 대한 짧은 말(한 문장, 15~60자)이고, 각각 kind를 붙인다.
  good: 도움이 됐거나 안심이 된 점 / bad: 불편하거나 걱정되거나 아쉬운 점 / neutral: 좋다 나쁘다 하기 어려운 점 / unknown: 겪은 것만으로는 알 수 없는 점 / wish: 이렇게 고쳐 줬으면 하는 점.
- 겪은 대로만 kind를 고른다. 종류를 골고루 채우려 하지 않는다. 한 종류만 있어도, 좋은 점만 또는 불편한 점만 있어도 자연스럽다. 없는 종류를 지어내지 않는다. claims는 1~4개.
- claim은 AI가 한 일이나 AI를 통해 겪은 일에 대한 말만 쓴다. 자기 사정이나 사건 설명을 claim으로 옮기지 않는다. neutral은 정말 좋다 나쁘다 하기 어려웠던 AI의 동작에만 쓴다. wish는 많아야 1개.
- 모든 claim은 citedLines에 자기가 겪은 줄 번호를 1개 이상 단다. wish도 그 바람이 나온 겪은 줄을 단다. 겪은 줄이 아니면 인용하지 않는다.
- 점수나 등급, 별점을 말하지 않는다. 한 사람 전체를 '좋다/나쁘다'로 단정하지 않는다.
- 규칙이 바뀐 뒤의 일이면 바뀐 동작이 어땠는지 겪은 대로 말한다. 이전 일은 기억하는 것처럼 말하지 않는다.
- 시스템 용어('규칙', '한도', '공개 범위')를 쓰지 않고 일상말로 옮긴다.

JSON으로 paragraph, claims(kind, text, citedLines), grounding(field, note)만 돌려준다."""

# A sentence ending in one of these is spoken style (~다 ~요 ~제 ~네 ...), not the record style (~함 ~임 ~음).
ENDINGS_NOT_ALLOWED = "다요죠제네어아지라나군걸데까"
KIND_LABEL = {"good": "좋았던 점", "bad": "불편했던 점", "neutral": "어느 쪽도 아님", "unknown": "알 수 없었던 점", "wish": "고치고 싶은 점"}
KINDS = ["good", "bad", "neutral", "unknown", "wish"]
SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "paragraph": {"type": "string"},
        "claims": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "properties": {"kind": {"type": "string", "enum": KINDS}, "text": {"type": "string"},
                           "citedLines": {"type": "array", "items": {"type": "integer"}}},
            "required": ["kind", "text", "citedLines"]}},
        "grounding": {"type": "object", "additionalProperties": False,
                      "properties": {"field": {"type": "string", "enum": FIELDS + [""]}, "note": {"type": "string"}},
                      "required": ["field", "note"]},
    },
    "required": ["paragraph", "claims", "grounding"],
}


def load():
    return (json.loads(BRIEFS.read_text(encoding="utf-8")),
            json.loads(DIALOGUE.read_text(encoding="utf-8"))["scenes"])


def interviews() -> dict[str, dict]:
    """Each interviewed resident's persona summary, by P number - without their verbatim words. A role nobody was
    interviewed as (the clinic head) has none, and says so."""
    if not PERSONAS.exists():
        raise SystemExit("페르소나 파일이 없습니다: %s (MEDIAL_PERSONAS 로 위치를 알려 주세요)" % PERSONAS)
    out: dict[str, dict] = {}
    for p in json.loads(PERSONAS.read_text(encoding="utf-8"))["페르소나"]:
        summary = {"나이": p.get("나이"), "직업": p.get("직업")}
        for f in FIELDS:
            v = p.get(f)
            if f == "건강" and isinstance(v, dict):
                v = v.get("요약")
            if f == "디지털" and isinstance(v, dict):
                v = {k: v.get(k) for k in ("수준", "입력 선호")}
            summary[f] = v
        out[p["id"]] = summary
    return out


def variants_of(ev: dict) -> dict[str, list[str]]:
    """The scene keys a resident of this event may have been in, per variant."""
    out = {"before": ["%s.%s" % (ev["id"], k) for k in ev["scenes"]]}
    for k, _ in walk_requests(ev["requests"]):
        out[k] = ["%s.%s" % (ev["id"], k)]
    return out


def request_of(ev: dict, name: str) -> dict | None:
    return dict(walk_requests(ev["requests"])).get(name)


def experienced(actor: str, keys: list[str], dialogue: dict) -> list[dict]:
    """The lines this actor was in the scene for, numbered within the variant (1-based). A scene the actor is not in
    contributes nothing: what was said where they were not is not theirs to cite."""
    out: list[dict] = []
    n = 0
    for key in keys:
        scene = dialogue[key]
        for line in scene["lines"]:
            n += 1
            if actor in scene["cast"]:
                out.append({"n": n, "scene": key, "speaker": line["speaker"], "text": line["text"]})
    return out


def residents_of(keys: list[str], dialogue: dict) -> list[str]:
    seen: list[str] = []
    for key in keys:
        for c in dialogue[key]["cast"]:
            if c != "AI" and c not in seen:
                seen.append(c)
    return seen


def problems(paragraph: str, claims: list[dict], allowed: set[int], grounding: dict, interviewed: bool) -> list[str]:
    bad: list[str] = []
    if bool(grounding["field"]) != bool(grounding["note"].strip()):
        bad.append("grounding의 field와 note는 함께 있거나 함께 비어야 함")
    if grounding["field"] and not interviewed:
        bad.append("인터뷰 요약이 없는 사람인데 grounding을 씀")
    if grounding["note"] and not 10 <= len(grounding["note"]) <= 70:
        bad.append("grounding note가 %d자(15~60자 안팎)" % len(grounding["note"]))
    n = len(paragraph)
    if not 40 <= n <= 150:
        bad.append("단락이 %d자(60~120자 안팎)" % n)
    for sentence in [paragraph] + [c["text"] for c in claims] + ([grounding["note"]] if grounding["note"] else []):
        for part in re.split(r"(?<=[.!?])\s+", sentence.strip()):
            if part and part.rstrip(".!? ")[-1] in ENDINGS_NOT_ALLOWED:
                bad.append("명사형(~함·~임)으로 끝나지 않음: %s" % part[-14:])
    if not 1 <= len(claims) <= 4:
        bad.append("claims가 %d개(1~4개)" % len(claims))
    if sum(c["kind"] == "wish" for c in claims) > 1:
        bad.append("wish가 둘 이상")
    for c in claims:
        outside = [x for x in c["citedLines"] if x not in allowed]
        if outside:
            bad.append("겪지 않은 줄을 인용: %s" % outside)
        if not c["citedLines"]:
            bad.append("인용한 줄이 없는 주장: %s" % c["text"][:20])
        if not 6 <= len(c["text"]) <= 80:
            bad.append("주장 길이 %d자: %s" % (len(c["text"]), c["text"][:20]))
    text = paragraph + " ".join(c["text"] for c in claims)
    if re.search(r"[0-9]\s*점|별\s*[0-9]|[0-9]\s*등급|만족도|최고|최악", text):
        bad.append("점수·등급 표현")
    if re.search(r"MEDial|메디얼|한도|공개 범위|규칙이", text):
        bad.append("시스템 용어/옛 이름")
    return bad


def make(only: list[str] | None) -> None:
    client = Model()
    print("model:", client.id)

    briefs, dialogue = load()
    people = interviews()
    made = json.loads(OUT.read_text(encoding="utf-8"))["evaluations"] if OUT.exists() else {}
    for ev in briefs["events"]:
        for vid, keys in variants_of(ev).items():
            tag = "%s.%s" % (ev["id"], vid)
            if only and not any(tag == o or tag.startswith(o + ".") or ev["id"] == o for o in only):
                continue
            request = request_of(ev, vid)
            for actor in residents_of(keys, dialogue):
                lines = experienced(actor, keys, dialogue)
                allowed = {x["n"] for x in lines}
                payload = {
                    "인물(처지만 참고하고 말투는 따르지 않는다)": briefs["voices"][actor],
                    "인터뷰 요약": people.get(actor) or "없음(인터뷰하지 않은 역할)",
                    "겪은 줄(번호: 말한 사람: 말)": ["%d: %s: %s" % (x["n"], x["speaker"], x["text"]) for x in lines],
                    "사건": ev["title"],
                    "상황": ("AI의 규칙이 바뀐 뒤의 일" if request else "AI가 평소대로 한 일"),
                }
                if request:
                    payload["바뀐 것(주민이 겪은 대로만 말한다)"] = request["expect"] + " / 부담: " + request["cost"]
                best, feedback = None, None
                for attempt in range(RETRIES + 1):
                    if feedback:
                        payload["지난번 시도에서 고칠 것"] = feedback
                    r = client.ask(SYSTEM, payload, SCHEMA, "resident_evaluation", 1500)
                    bad = problems(r["paragraph"], r["claims"], allowed, r["grounding"], actor in people)
                    if best is None or len(bad) <= len(best[1]):
                        best = (r, bad)
                    if not bad:
                        break
                    feedback = {"문제": bad, "지난 단락": r["paragraph"]}
                    print("  [%s %s] 다시 (%d): %s" % (tag, actor, attempt + 1, bad))
                r, bad = best
                made["%s.%s" % (tag, actor)] = {
                    "event": ev["id"], "variant": vid, "actor": actor, "source": "simulated",
                    "experiencedLines": lines, "paragraph": r["paragraph"], "claims": r["claims"], "grounding": r["grounding"],
                    "problems": bad, "disclaimer": DISCLAIMER,
                }
                print("== %s %s %s" % (tag, actor, "통과" if not bad else bad))
                print("   ", r["paragraph"])
                print("    인터뷰 근거:", r["grounding"]["field"] or "-", r["grounding"]["note"])
                for c in r["claims"]:
                    print("    [%s] %s %s" % (c["kind"], c["text"], c["citedLines"]))
                # Keep the links: they belong to the evaluations written before, and `make` only rewrites some.
                links = json.loads(OUT.read_text(encoding="utf-8")).get("links", {}) if OUT.exists() else {}
                OUT.write_text(json.dumps({"model": client.id, "evaluations": made, "links": links},
                                          ensure_ascii=False, indent=1), encoding="utf-8")
    read()


LINK_SYSTEM = """당신은 서비스 디자이너의 조수다. 주민들의 평가(수정 전)를 읽고, 디자이너의 수정 요청 하나가 그 평가의 어느 대목에서 나왔는지 찾는다.

규칙
- 근거는 주어진 평가의 주장(claims) 안의 말이어야 한다. bad나 wish 주장이 가장 알맞고, 다른 종류는 약한 근거다. 평가에 없는 내용을 지어내지 않는다.
- 요청이 겨냥한 문제를 평가가 직접 말하면 'direct', 비슷한 불편을 돌려 말하면 'weak', 평가 어디에도 없으면 'none'.
- direct/weak이면 근거가 된 평가의 id(actor)와 그 평가의 주장 text에서 그대로 옮긴 짧은 인용(basis)과 그 주장의 종류(kind)을 쓴다. none이면 actor, basis, kind는 빈 문자열.
- 요청을 정당화하려고 평가를 억지로 읽지 않는다. 확신이 없으면 weak이나 none이다.

JSON으로 verdict, actor, basis, kind만 돌려준다."""

LINK_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {"verdict": {"type": "string", "enum": ["direct", "weak", "none"]},
                   "actor": {"type": "string"}, "basis": {"type": "string"},
                   "kind": {"type": "string", "enum": KINDS + [""]}},
    "required": ["verdict", "actor", "basis", "kind"],
}


def link(only: list[str] | None) -> None:
    """``--only E1.B E1.A.B`` judges those requests only and leaves every other link as it was; ``--only E1`` judges
    every request of the event again. A request's basis is looked for in the evaluations of the version it is offered
    on: the first version's (before) for ``B``, request A's after-evaluations for ``A.B``."""
    client = Model()
    briefs, _ = load()
    data = json.loads(OUT.read_text(encoding="utf-8"))
    made = data["evaluations"]
    links = data.get("links", {})
    for ev in briefs["events"]:
        for rid, r in walk_requests(ev["requests"]):
            key = "%s.%s" % (ev["id"], rid)
            if only and key not in only and ev["id"] not in only:
                continue
            parent = rid.rsplit(".", 1)[0] if "." in rid else "before"
            before = {v["actor"]: v for v in made.values() if v["event"] == ev["id"] and v["variant"] == parent}
            payload = {
                "수정 요청": r["label"],
                "수정 전 평가들(actor: 단락 / 주장 종류: 주장)": [
                    "%s: %s / %s" % (a, v["paragraph"], " | ".join("%s: %s" % (c["kind"], c["text"]) for c in v["claims"]))
                    for a, v in before.items()],
            }
            res = client.ask(LINK_SYSTEM, payload, LINK_SCHEMA, "request_basis", 800)
            quoted = res["basis"] and res["actor"] in before and any(
                res["basis"] in c["text"] and c["kind"] == res["kind"] for c in before[res["actor"]]["claims"])
            if res["verdict"] != "none" and not quoted:
                res["verdict"] = "weak"
                res["note"] = "인용이 평가 원문과 일치하지 않아 약함으로 내림"
            links[key] = res
            print("== %s %s %s %s" % (key, res["verdict"], res["actor"], res["basis"][:60]))
    data["links"] = links
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


EXPLAIN_SYSTEM = """당신은 서비스 디자이너의 조수다. 수정 요청 하나와, 그 요청의 근거로 '약하다'고 판정된 주민 피드백 한 마디를 읽는다. 판정은 이미 났다 — 바꾸지 않는다.

할 일
- 이 한 마디가 요청의 어느 부분을 말하고, 어느 부분은 말하지 않는지 한 문장으로 쓴다(why).
- 15~60자, '~함'·'~음'·'~않음' 같은 명사형으로 끝낸다. 예: "형에게 알리는 것은 말하지만, 목소리를 다시 확인하는 것은 말하지 않음."
- 피드백에 없는 말을 지어내지 않는다. 요청을 좋게 보이게 쓰지 않는다.

JSON으로 why만 돌려준다."""

EXPLAIN_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {"why": {"type": "string"}},
    "required": ["why"],
}


def explain(only: list[str] | None) -> None:
    """Why a request only weakly rests on the words it quotes, in one line, for the request card: several requests
    of one version often rest on the same words, and one is direct where another is weak - said without a reason, the
    two verdicts read as a contradiction (2026-10-23). The verdict is ``link``'s and is not asked again."""
    client = Model()
    briefs, _ = load()
    data = json.loads(OUT.read_text(encoding="utf-8"))
    links = data["links"]
    for ev in briefs["events"]:
        for rid, r in walk_requests(ev["requests"]):
            key = "%s.%s" % (ev["id"], rid)
            link = links.get(key)
            if not link or link["verdict"] != "weak" or (only and key not in only and ev["id"] not in only):
                continue
            payload = {"수정 요청": r["label"], "근거로 든 주민 피드백": link["basis"], "판정": "약한 근거"}
            feedback, why = None, None
            for attempt in range(RETRIES + 1):
                ask = dict(payload, **({"지난번 시도에서 고칠 것": feedback} if feedback else {}))
                text = client.ask(EXPLAIN_SYSTEM, ask, EXPLAIN_SCHEMA, "basis_why", 300)["why"].strip()
                bad = []
                if not 12 <= len(text) <= 70:
                    bad.append("길이 %d자(15~60자)" % len(text))
                if text.rstrip(".!? ")[-1:] in ENDINGS_NOT_ALLOWED:
                    bad.append("명사형(~함·~음)으로 끝나지 않음")
                if not bad:
                    why = text
                    break
                feedback = bad
                print("  [%s] 다시 (%d): %s" % (key, attempt + 1, bad))
            if why is None:
                raise SystemExit("%s 의 이유가 %d번 모두 맞지 않았습니다" % (key, RETRIES + 1))
            link["why"] = why
            print("== %s %s" % (key, why))
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


COMPARE_SYSTEM = """당신은 서비스 디자이너의 조수다. 같은 주민이 같은 사건을 두 버전으로 겪고 남긴 피드백 두 개를 읽는다. 앞 버전에서 요청 하나를 골라 고친 것이 뒤 버전이다. 주민은 앞 버전을 기억하지 못하므로, 뒤 피드백은 앞 버전과 비교하는 말을 하지 않는다.

할 일
- 앞 피드백의 불편·바람(번호가 붙은 것) 하나하나를 셋 중 하나로 나눈다.
  resolved: 뒤 피드백이 같은 일에 대해 좋았다고 하거나, 그 불편이 생길 자리에서 다른 일이 있었다고 말한다.
  remaining: 뒤 피드백에 같은 불편이 다시 나온다.
  unclear: 뒤 피드백이 그 일에 대해 아무 말도 하지 않는다.
- 뒤 피드백의 불편·바람(번호가 붙은 것) 가운데 앞 피드백에 없던 불편은 new에 넣는다. 앞의 것과 같은 불편이면 넣지 않는다.
- 피드백에 적힌 말만 근거로 삼는다. 확신이 없으면 unclear다. 고친 것이 좋아 보이게 읽지 않는다.

JSON으로 resolved, remaining, unclear(앞 번호들), new(뒤 번호들)만 돌려준다."""

COMPARE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {k: {"type": "array", "items": {"type": "integer"}} for k in ("resolved", "remaining", "unclear", "new")},
    "required": ["resolved", "remaining", "unclear", "new"],
}

#: What a comparison sorts: the uncomfortable and the wished-for. What was good is not "resolved" or "new".
TROUBLE = ("bad", "wish")
#: How many times each comparison is read. One reading was left to chance (2026-10-23): a trouble is resolved or remaining
#: only when most readings say so, and unclear when they split; a trouble is new when most readings say so.
VOTES = 3


def compare_once(client: Model, payload: dict, was: list[int], now: list[int], tag: str) -> dict:
    """One reading of two feedbacks, checked: every earlier trouble sorted once, new ones only from the later."""
    feedback = None
    for attempt in range(RETRIES + 1):
        ask = dict(payload, **({"지난번 시도에서 고칠 것": feedback} if feedback else {}))
        r = client.ask(COMPARE_SYSTEM, ask, COMPARE_SCHEMA, "feedback_change", 600)
        sorted_was = r["resolved"] + r["remaining"] + r["unclear"]
        bad = []
        if sorted(sorted_was) != sorted(was):
            bad.append("앞 번호 %s 가 resolved/remaining/unclear에 한 번씩 들어가야 함(받은 것 %s)" % (was, sorted_was))
        if any(j not in now for j in r["new"]) or len(set(r["new"])) != len(r["new"]):
            bad.append("new는 뒤 번호 %s 안에서 한 번씩" % now)
        if not bad:
            return r
        feedback = bad
        print("  [%s] 다시 (%d): %s" % (tag, attempt + 1, bad))
    raise SystemExit("%s 의 비교가 %d번 모두 맞지 않았습니다" % (tag, RETRIES + 1))


def vote(runs: list[dict], was: list[int], now: list[int]) -> dict[str, list[int]]:
    """The readings' majority: an earlier trouble goes where most readings put it (unclear when no way has most);
    a later trouble is new when most readings call it so."""
    need = len(runs) // 2 + 1
    out: dict[str, list[int]] = {"resolved": [], "remaining": [], "unclear": [], "new": []}
    for i in was:
        way = next((k for k in ("resolved", "remaining") if sum(i in r[k] for r in runs) >= need), "unclear")
        out[way].append(i)
    out["new"] = [j for j in now if sum(j in r["new"] for r in runs) >= need]
    return out


def compare(only: list[str] | None) -> None:
    """How each resident's feedback moved from the version a request was chosen on to the version it made: which of
    their troubles were resolved, which remained, which cannot be told, and which are new - the majority of ``VOTES``
    readings. Stored as claim indices
    (the words stay in the evaluations), per request, under ``changes``. Someone only in one of the two versions is
    not asked about: what they had to say is all gone or all new, and the screen says which."""
    client = Model()
    briefs, _ = load()
    data = json.loads(OUT.read_text(encoding="utf-8"))
    made = data["evaluations"]
    changes = data.get("changes", {})
    for ev in briefs["events"]:
        for rid, _ in walk_requests(ev["requests"]):
            key = "%s.%s" % (ev["id"], rid)
            if only and key not in only and ev["id"] not in only:
                continue
            parent = rid.rsplit(".", 1)[0] if "." in rid else "before"
            before = {v["actor"]: v for v in made.values() if v["event"] == ev["id"] and v["variant"] == parent}
            after = {v["actor"]: v for v in made.values() if v["event"] == ev["id"] and v["variant"] == rid}
            out: dict[str, dict] = {}
            for actor in list(before) + [a for a in after if a not in before]:
                was = [i for i, c in enumerate(before[actor]["claims"]) if c["kind"] in TROUBLE] if actor in before else []
                now = [i for i, c in enumerate(after[actor]["claims"]) if c["kind"] in TROUBLE] if actor in after else []
                if actor not in after:
                    out[actor] = {"presence": "before", "resolved": [], "remaining": [], "unclear": was, "new": []}
                    continue
                if actor not in before:
                    out[actor] = {"presence": "after", "resolved": [], "remaining": [], "unclear": [], "new": now}
                    continue
                payload = {
                    "앞 피드백": before[actor]["paragraph"],
                    "앞의 불편·바람(번호: 말)": ["%d: %s" % (i, before[actor]["claims"][i]["text"]) for i in was],
                    "뒤 피드백": after[actor]["paragraph"],
                    "뒤의 불편·바람(번호: 말)": ["%d: %s" % (i, after[actor]["claims"][i]["text"]) for i in now],
                }
                runs = [compare_once(client, payload, was, now, "%s %s" % (key, actor)) for _ in range(VOTES)]
                out[actor] = {"presence": "both", "votes": VOTES, **vote(runs, was, now)}
            changes[key] = out
            for actor, c in out.items():
                print("== %s %s %s 풀림%s 남음%s 모름%s 새%s" % (key, actor, c["presence"], c["resolved"], c["remaining"], c["unclear"], c["new"]))
    data["changes"] = changes
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def read() -> None:
    """evaluations.json -> evaluations.html: the same page the dialogue is read on, one card per resident."""
    from html import escape as e

    briefs, _ = load()
    made = json.loads(OUT.read_text(encoding="utf-8"))["evaluations"]
    names = {x["id"]: x["title"] for x in briefs["events"]}
    body: list[str] = []
    for ev in briefs["events"]:
        body.append('<section><h2>%s · %s</h2>' % (ev["id"], e(names[ev["id"]])))
        for vid in ["before"] + [k for k, _ in walk_requests(ev["requests"])]:
            cards = [v for v in made.values() if v["event"] == ev["id"] and v["variant"] == vid]
            if not cards:
                continue
            head = "수정 전" if vid == "before" else "요청 %s 적용 후" % vid
            if vid != "before":
                r = request_of(ev, vid)
                head += ' <small>%s</small>' % e(r["label"])
            body.append("<h3>%s</h3>" % head)
            for c in cards:
                claims = "".join('<li class="k-%s"><b>%s</b> %s <small>줄 %s</small></li>'
                                 % (x["kind"], KIND_LABEL[x["kind"]], e(x["text"]), ", ".join(str(n) for n in x["citedLines"]))
                                 for x in c["claims"])
                body.append('<div class="sc" data-k="%s.%s.%s"><p class="sit"><b>%s</b></p><p class="para">%s</p><ul class="cl">%s</ul>'
                            '<div class="mk"><button data-v="ok">좋음</button><button data-v="fix">고침</button><input placeholder="메모"></div></div>'
                            % (ev["id"], vid, c["actor"], e(c["actor"]), e(c["paragraph"]), claims))
        body.append("</section>")
    page = _PAGE().replace("@@BODY@@", "".join(body))
    HTML.write_text(page, encoding="utf-8")
    print("wrote", HTML.relative_to(ROOT), "(%d evaluations)" % len(made))


def _PAGE() -> str:
    # The dialogue page's frame, so the two review pages look and behave the same.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import gen_week_dialogue as g

    page = g.PAGE.replace("대화록 검토", "주민 평가 검토").replace("7일 타임라인 대화록 · 검토", "주민 평가 · 검토")
    page = page.replace(".mk{display:flex", ".para{margin:4px 0 6px;font-size:16px}.cl{margin:4px 0 6px;padding:0;list-style:none;font-size:14px}.cl li{margin:2px 0}.cl b{display:inline-block;min-width:92px}.cl small{color:#888}.k-bad b,.k-wish b{color:var(--fix)}.mk{display:flex")
    page = page.replace('const K="week-dialogue-review"', 'const K="week-evaluation-review"')
    page = page.replace("장면마다 좋음/고침과 메모를 남기세요.", "평가마다 좋음/고침과 메모를 남기세요. 모든 평가는 시뮬레이션 주민의 것이며 실제 주민의 의견이 아닙니다.")
    return page


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    mk = sub.add_parser("make")
    mk.add_argument("--only", nargs="*")
    sub.add_parser("read")
    lk = sub.add_parser("link")
    lk.add_argument("--only", nargs="*")
    cp = sub.add_parser("compare")
    cp.add_argument("--only", nargs="*")
    xp = sub.add_parser("explain")
    xp.add_argument("--only", nargs="*")
    args = ap.parse_args()
    {"read": lambda: read(), "make": lambda: make(args.only), "link": lambda: link(args.only),
     "compare": lambda: compare(args.only), "explain": lambda: explain(args.only)}[args.cmd]()


if __name__ == "__main__":
    main()
