"""Writes the residents' evaluations of the week's events, from the dialogue they were in.

    python scripts/gen_week_evaluations.py make                  # every resident in every scene variant
    python scripts/gen_week_evaluations.py make --only E1 E4.B   # an event, or one variant
    python scripts/gen_week_evaluations.py link                  # which before-evaluation each request rests on
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
the check refuses any citation outside it. The after-scene evaluations are read as "this decision, as it landed";
the before and after are not compared line by line, because who is in the scene changes with the request.

``link`` is the other half of the chain *before evaluation -> request -> after evaluation*. The evaluations are written
without knowing the requests (so they are not tuned to them); ``link`` then asks, per request, which before-evaluation
it rests on and quotes the passage - or says it rests on none. A request with no basis is not hidden: it is reported,
and the event's before scenes are what get fixed (docs/research/30 section 11), never the evaluation.

Writes only files. The record (sim.sqlite3) is the later build step, after the researcher has read the evaluations.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8")

from model import Model  # noqa: E402

WEEK = ROOT / "fixtures" / "week"
BRIEFS = WEEK / "briefs.json"
DIALOGUE = WEEK / "dialogue.json"
OUT = WEEK / "evaluations.json"
HTML = WEEK / "evaluations.html"
RETRIES = 3
DISCLAIMER = "시뮬레이션 산출물이다. 실제 주민의 발언·만족도·임상 결과가 아니다."

SYSTEM = """당신은 경남 남해군 은점마을의 한 주민이다. 방금 겪은 일을 되돌아보며, 안부를 살피고 이웃을 이어 주는 AI에 대한 생각을 짧게 말한다. 이것은 전시에서 '시뮬레이션 주민의 평가'로 읽힌다. 실제 주민의 의견이 아니다.

쓰는 법
- 본인 말투(인물과 말투)로, 1인칭으로, 한 단락(80~140자)으로 쓴다. 번역투를 쓰지 않는다.
- 겪은 줄(ㄱ~) 안에서만 말한다. 자기가 없던 장면, 듣지 못한 말, 대화에 없는 사실(새 병명·시각·이름)은 말하지 않는다.
- 단락 다음에 claims를 쓴다. claims는 겪은 일 하나하나에 대한 짧은 말(한 문장, 15~60자)이고, 각각 kind를 붙인다.
  good: 도움이 됐거나 안심이 된 점 / bad: 불편하거나 걱정되거나 아쉬운 점 / neutral: 좋다 나쁘다 하기 어려운 점 / unknown: 겪은 것만으로는 알 수 없는 점 / wish: 이렇게 고쳐 줬으면 하는 점.
- 겪은 대로만 kind를 고른다. 종류를 골고루 채우려 하지 않는다. 한 종류만 있어도, 좋은 점만 또는 불편한 점만 있어도 자연스럽다. 없는 종류를 지어내지 않는다. claims는 1~4개.
- claim은 AI가 한 일이나 AI를 통해 겪은 일에 대한 말만 쓴다. 자기 사정이나 사건 설명을 claim으로 옮기지 않는다. neutral은 정말 좋다 나쁘다 하기 어려웠던 AI의 동작에만 쓴다. wish는 많아야 1개.
- 모든 claim은 citedLines에 자기가 겪은 줄 번호를 1개 이상 단다. wish도 그 바람이 나온 겪은 줄을 단다. 겪은 줄이 아니면 인용하지 않는다.
- 점수나 등급, 별점을 말하지 않는다. 한 사람 전체를 '좋다/나쁘다'로 단정하지 않는다.
- 규칙이 바뀐 뒤의 일이면 바뀐 동작이 어땠는지 겪은 대로 말한다. 이전 일은 기억하는 것처럼 말하지 않는다.
- 시스템 용어('규칙', '한도', '공개 범위')를 쓰지 않고 일상말로 옮긴다.

JSON으로 paragraph와 claims(kind, text, citedLines)만 돌려준다."""

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
    },
    "required": ["paragraph", "claims"],
}


def load():
    return (json.loads(BRIEFS.read_text(encoding="utf-8")),
            json.loads(DIALOGUE.read_text(encoding="utf-8"))["scenes"])


def variants_of(ev: dict) -> dict[str, list[str]]:
    """The scene keys a resident of this event may have been in, per variant."""
    out = {"before": ["%s.%s" % (ev["id"], k) for k in ev["scenes"]]}
    for k in ev["requests"]:
        out[k] = ["%s.%s" % (ev["id"], k)]
    return out


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


def problems(paragraph: str, claims: list[dict], allowed: set[int]) -> list[str]:
    bad: list[str] = []
    n = len(paragraph)
    if not 60 <= n <= 170:
        bad.append("단락이 %d자(80~140자 안팎)" % n)
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
        if not 8 <= len(c["text"]) <= 80:
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
    made = json.loads(OUT.read_text(encoding="utf-8"))["evaluations"] if OUT.exists() else {}
    for ev in briefs["events"]:
        for vid, keys in variants_of(ev).items():
            tag = "%s.%s" % (ev["id"], vid)
            if only and not any(tag == o or tag.startswith(o + ".") or ev["id"] == o for o in only):
                continue
            request = ev["requests"].get(vid)
            for actor in residents_of(keys, dialogue):
                lines = experienced(actor, keys, dialogue)
                allowed = {x["n"] for x in lines}
                payload = {
                    "인물과 말투": briefs["voices"][actor],
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
                    bad = problems(r["paragraph"], r["claims"], allowed)
                    if best is None or len(bad) <= len(best[1]):
                        best = (r, bad)
                    if not bad:
                        break
                    feedback = {"문제": bad, "지난 단락": r["paragraph"]}
                    print("  [%s %s] 다시 (%d): %s" % (tag, actor, attempt + 1, bad))
                r, bad = best
                made["%s.%s" % (tag, actor)] = {
                    "event": ev["id"], "variant": vid, "actor": actor, "source": "simulated",
                    "experiencedLines": lines, "paragraph": r["paragraph"], "claims": r["claims"],
                    "problems": bad, "disclaimer": DISCLAIMER,
                }
                print("== %s %s %s" % (tag, actor, "통과" if not bad else bad))
                print("   ", r["paragraph"])
                for c in r["claims"]:
                    print("    [%s] %s %s" % (c["kind"], c["text"], c["citedLines"]))
                OUT.write_text(json.dumps({"model": client.id, "evaluations": made},
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
    client = Model()
    briefs, _ = load()
    data = json.loads(OUT.read_text(encoding="utf-8"))
    made = data["evaluations"]
    links = data.get("links", {})
    for ev in briefs["events"]:
        if only and ev["id"] not in only:
            continue
        before = {v["actor"]: v for v in made.values() if v["event"] == ev["id"] and v["variant"] == "before"}
        for rid, r in ev["requests"].items():
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
            links["%s.%s" % (ev["id"], rid)] = res
            print("== %s.%s %s %s %s" % (ev["id"], rid, res["verdict"], res["actor"], res["basis"][:60]))
    data["links"] = links
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
        for vid in ["before"] + list(ev["requests"]):
            cards = [v for v in made.values() if v["event"] == ev["id"] and v["variant"] == vid]
            if not cards:
                continue
            head = "수정 전" if vid == "before" else "요청 %s 적용 후" % vid
            if vid != "before":
                r = ev["requests"][vid]
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
    args = ap.parse_args()
    {"read": lambda: read(), "make": lambda: make(args.only), "link": lambda: link(args.only)}[args.cmd]()


if __name__ == "__main__":
    main()
