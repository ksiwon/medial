"""Writes the residents' evaluations of the week's events, from the dialogue they were in.

    python scripts/gen_week_evaluations.py make                  # every resident in every scene variant
    python scripts/gen_week_evaluations.py make --only E1 E4.B   # an event, or one variant
    python scripts/gen_week_evaluations.py read                  # evaluations.json -> evaluations.html, for the researcher

One evaluation is one resident's paragraph about one *variant* of one event: the event as it ran (the *before*
scenes) or as it ran after one request (the *after* scene of request A, B or C). It follows
docs/research/20_STRUCTURED_RESIDENT_EVALUATION.md as far as the screen reads it: a paragraph, the lines it rests
on, what the resident would change, and a disclaimer. It is a simulated resident's reading, never a real
resident's opinion, and no score, grade or verdict comes out of it.

What makes it an evaluation and not a summary is the evidence rule (AGENTS.md): a resident may cite only the lines
they were in the scene for and heard. ``experienced`` is computed here from the dialogue - never by the model - and
the check refuses any citation outside it. The after-scene evaluations are read as "this decision, as it landed";
the before and after are not compared line by line, because who is in the scene changes with the request.

Writes only files. The record (sim.sqlite3) is the later build step, after the researcher has read the evaluations.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
sys.stdout.reconfigure(encoding="utf-8")

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
- 겪은 줄(ㄱ~) 안에서만 말한다. 자기가 없던 장면, 듣지 못한 말, 대화에 없는 사실(새 병명·시각·이름)은 말하지 않는다. 겪은 줄이 아니면 인용하지 않는다.
- 좋았던 점과 불편하거나 아쉬웠던 점이 있으면 둘 다 말한다. 한쪽만 부풀리지 않는다. 점수나 등급, 별점을 말하지 않는다. '좋다/나쁘다'로 단정하지 않고 겪은 일로 말한다.
- 규칙이 바뀐 뒤의 일이면 바뀐 동작이 어땠는지 겪은 대로 말한다. 이전 일은 기억하는 것처럼 말하지 않는다.
- 고치고 싶은 점이 있으면 changeWish에 한 줄로 쓴다. 없으면 빈 문자열.
- 시스템 용어('규칙', '한도', '공개 범위')를 쓰지 않고 일상말로 옮긴다.

JSON으로 paragraph, citedLines(인용한 겪은 줄의 번호 목록), changeWish만 돌려준다."""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "paragraph": {"type": "string"},
        "citedLines": {"type": "array", "items": {"type": "integer"}},
        "changeWish": {"type": "string"},
    },
    "required": ["paragraph", "citedLines", "changeWish"],
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


def problems(paragraph: str, cited: list[int], allowed: set[int]) -> list[str]:
    bad: list[str] = []
    n = len(paragraph)
    if not 60 <= n <= 170:
        bad.append("단락이 %d자(80~140자 안팎)" % n)
    outside = [c for c in cited if c not in allowed]
    if outside:
        bad.append("겪지 않은 줄을 인용: %s" % outside)
    if not cited:
        bad.append("인용한 줄이 없음")
    if re.search(r"[0-9]\s*점|별\s*[0-9]|[0-9]\s*등급|만족도|최고|최악", paragraph):
        bad.append("점수·등급 표현")
    if re.search(r"MEDial|메디얼|한도|공개 범위|규칙이", paragraph):
        bad.append("시스템 용어/옛 이름")
    return bad


def make(only: list[str] | None) -> None:
    from app.simulation.agents.provider import ModelProvider, policy_from_env  # noqa: E402

    env = dict(os.environ)
    dotenv = ROOT / "server" / ".env"
    if dotenv.exists():
        for line in io.open(dotenv, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env.setdefault(k.strip(), v.strip())
    provider = ModelProvider.from_env(env)
    policy = policy_from_env(env, mode="off")
    client = provider._client(policy.headModelId)
    print("model:", policy.headModelId)

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
                    raw, _usage = client._post(SYSTEM, payload, SCHEMA, "resident_evaluation", 1500)
                    r = raw if isinstance(raw, dict) else json.loads(raw)
                    bad = problems(r["paragraph"], r["citedLines"], allowed)
                    if best is None or len(bad) <= len(best[1]):
                        best = (r, bad)
                    if not bad:
                        break
                    feedback = {"문제": bad, "지난 단락": r["paragraph"]}
                    print("  [%s %s] 다시 (%d): %s" % (tag, actor, attempt + 1, bad))
                r, bad = best
                made["%s.%s" % (tag, actor)] = {
                    "event": ev["id"], "variant": vid, "actor": actor, "source": "simulated",
                    "experiencedLines": lines, "paragraph": r["paragraph"], "citedLines": r["citedLines"],
                    "changeWish": r["changeWish"], "problems": bad, "disclaimer": DISCLAIMER,
                }
                print("== %s %s %s" % (tag, actor, "통과" if not bad else bad))
                print("   ", r["paragraph"])
                OUT.write_text(json.dumps({"model": policy.headModelId, "evaluations": made},
                                          ensure_ascii=False, indent=1), encoding="utf-8")
    read()


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
                body.append('<div class="sc" data-k="%s.%s.%s"><p class="sit"><b>%s</b> · 인용 줄 %s</p><p class="para">%s</p>%s'
                            '<div class="mk"><button data-v="ok">좋음</button><button data-v="fix">고침</button><input placeholder="메모"></div></div>'
                            % (ev["id"], vid, c["actor"], e(c["actor"]), ", ".join(str(x) for x in c["citedLines"]), e(c["paragraph"]),
                               ('<p class="wish">고치고 싶은 점: %s</p>' % e(c["changeWish"])) if c["changeWish"] else ""))
        body.append("</section>")
    page = _PAGE().replace("@@BODY@@", "".join(body))
    HTML.write_text(page, encoding="utf-8")
    print("wrote", HTML.relative_to(ROOT), "(%d evaluations)" % len(made))


def _PAGE() -> str:
    # The dialogue page's frame, so the two review pages look and behave the same.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import gen_week_dialogue as g

    page = g.PAGE.replace("대화록 검토", "주민 평가 검토").replace("7일 타임라인 대화록 · 검토", "주민 평가 · 검토")
    page = page.replace(".mk{display:flex", ".para{margin:4px 0 6px;font-size:16px}.wish{margin:4px 0 0;color:var(--fix);font-size:14px}.mk{display:flex")
    page = page.replace('const K="week-dialogue-review"', 'const K="week-evaluation-review"')
    page = page.replace("장면마다 좋음/고침과 메모를 남기세요.", "평가마다 좋음/고침과 메모를 남기세요. 모든 평가는 시뮬레이션 주민의 것이며 실제 주민의 의견이 아닙니다.")
    return page


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    mk = sub.add_parser("make")
    mk.add_argument("--only", nargs="*")
    sub.add_parser("read")
    args = ap.parse_args()
    read() if args.cmd == "read" else make(args.only)


if __name__ == "__main__":
    main()
