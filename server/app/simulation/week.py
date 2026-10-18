"""The week the exhibition reads: events, their scenes, the residents' evaluations and the requests that came of them.

Nothing here runs anything. ``fixtures/week/`` holds what was written and checked ahead of time
(docs/research/30_WEEK_TIMELINE_REDESIGN.md); this module reads those files, checks that they still keep the
research's rules, and hands the screens one document. A screen never joins files itself, and a file that breaks a
rule stops the read instead of reaching a wall.

The rules it keeps (AGENTS.md):

* a resident cites only the lines they were in the scene for (``experiencedLines`` is recomputed from the dialogue
  here, never trusted from the evaluation file);
* every claim in an evaluation (good / bad / neutral / unknown / wish) cites at least one line, and only lines the
  resident was in; the kind is the simulated resident's reading of one thing, never a verdict on the whole;
* an evaluation says it is simulated and carries the disclaimer;
* a request says honestly how well the residents' own words support it (``basis``) - it is never dressed up;
* an event marked ``noChoice`` has no request cards: some moments are read, not chosen;
* nothing in the document is a score.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import rules

WEEK_DIR = Path(__file__).resolve().parents[3] / "fixtures" / "week"
DISCLAIMER = "시뮬레이션 산출물이다. 실제 주민의 발언·만족도·임상 결과가 아니다."
DAYS = ["월", "화", "수", "목", "금", "토", "일"]
#: 'direct' = a resident said it, 'weak' = said around it, 'none' = nobody did (such a request is not shown).
VERDICTS = {"direct", "weak"}
KINDS = {"good", "bad", "neutral", "unknown", "wish"}


class WeekError(ValueError):
    """The files break a rule; the message says which."""


def _load(name: str, weeks_dir: Path) -> dict[str, Any]:
    path = weeks_dir / name
    if not path.exists():
        raise WeekError("%s 가 없습니다 (%s)" % (name, weeks_dir))
    return json.loads(path.read_text(encoding="utf-8"))


def _names(briefs: dict[str, Any]) -> dict[str, str]:
    """Who is who on screen. Pseudonyms, as in every other screen; the service is just 'AI'."""
    return {
        "P1": "한상덕", "P3": "유병찬", "P5": "허종만", "P6": "남기웅", "P7": "고성진", "P8": "고성재",
        "P9": "임태식", "P10": "조복순", "P11": "조기범", "P12": "남대현", "HC_HEAD": "보건소장", "AI": "AI",
    }


def _scene(key: str, brief: dict[str, Any], dialogue: dict[str, Any]) -> dict[str, Any]:
    said = dialogue.get(key)
    if not said:
        raise WeekError("%s 의 대화록이 없습니다" % key)
    return {
        "key": key,
        "time": brief["time"],
        "situation": brief["scene"],
        "importance": brief["importance"],
        "frames": brief["frames"],
        "cast": said["cast"],
        "lines": [{"n": i + 1, "speaker": ln["speaker"], "text": ln["text"]} for i, ln in enumerate(said["lines"])],
    }


def _heard(actor: str, scene_keys: list[str], dialogue: dict[str, Any]) -> list[int]:
    """Line numbers (counted across the variant's scenes, as the evaluations count them) this actor was in."""
    out: list[int] = []
    n = 0
    for key in scene_keys:
        for _ in dialogue[key]["lines"]:
            n += 1
            if actor in dialogue[key]["cast"]:
                out.append(n)
    return out


def _evaluation(ev: dict[str, Any], names: dict[str, str]) -> dict[str, Any]:
    return {
        "actor": ev["actor"],
        "name": names.get(ev["actor"], ev["actor"]),
        "source": "simulated",
        "paragraph": ev["paragraph"],
        "claims": [{"kind": c["kind"], "text": c["text"], "citedLines": c["citedLines"]} for c in ev["claims"]],
        "disclaimer": ev["disclaimer"],
    }


def _rule_now(event_id: str, rule_type: str, values: dict[str, Any]) -> dict[str, Any]:
    """A rule as the AI runs it, in words (rules.py)."""
    try:
        return {"type": rule_type, "label": rules.label(rule_type), "sentence": rules.sentence(rule_type, values)}
    except rules.UnknownRule as error:
        raise WeekError("%s 의 규칙 %s 를 말로 옮길 수 없습니다(rules.py)" % (event_id, error)) from error


def _rule_change(event_id: str, rule: dict[str, Any]) -> dict[str, Any]:
    """What a request does to one rule: its values and the sentences before and after."""
    now = _rule_now(event_id, rule["type"], rule["before"])
    return {
        "type": rule["type"], "label": now["label"], "before": rule["before"], "after": rule["after"],
        "beforeSentence": now["sentence"], "afterSentence": rules.sentence(rule["type"], rule["after"]),
    }


def load_week(weeks_dir: Path = WEEK_DIR) -> dict[str, Any]:
    briefs = _load("briefs.json", weeks_dir)
    dialogue = _load("dialogue.json", weeks_dir)["scenes"]
    evaluations = _load("evaluations.json", weeks_dir)
    schedule = _load("schedule.json", weeks_dir)
    names = _names(briefs)
    made = evaluations["evaluations"]
    links = evaluations.get("links", {})

    def evals_of(event_id: str, variant: str, scene_keys: list[str]) -> list[dict[str, Any]]:
        out = []
        for ev in made.values():
            if ev["event"] != event_id or ev["variant"] != variant:
                continue
            allowed = set(_heard(ev["actor"], scene_keys, dialogue))
            if not ev["claims"]:
                raise WeekError("%s.%s %s 의 평가에 주장이 없습니다" % (event_id, variant, ev["actor"]))
            for claim in ev["claims"]:
                if claim["kind"] not in KINDS:
                    raise WeekError("%s.%s %s 의 주장 종류 %r 를 모릅니다" % (event_id, variant, ev["actor"], claim["kind"]))
                if not claim["citedLines"]:
                    raise WeekError("%s.%s %s 의 주장에 인용한 줄이 없습니다" % (event_id, variant, ev["actor"]))
                outside = [c for c in claim["citedLines"] if c not in allowed]
                if outside:
                    raise WeekError("%s.%s %s 가 겪지 않은 줄 %s 를 인용했습니다" % (event_id, variant, ev["actor"], outside))
            if ev.get("disclaimer") != DISCLAIMER or ev.get("source") != "simulated":
                raise WeekError("%s.%s %s 의 평가에 시뮬레이션 표기가 없습니다" % (event_id, variant, ev["actor"]))
            out.append(_evaluation(ev, names))
        return out

    events = []
    for ev in briefs["events"]:
        eid = ev["id"]
        before_keys = ["%s.%s" % (eid, k) for k in ev["scenes"]]
        requests = []
        #: The rules the event ran under before anything was chosen: each request's ``before``. Two requests that
        #: disagree about how the AI ran would make the judgment panel say two things, so that stops the read.
        baseline: dict[str, dict[str, Any]] = {}
        for rid, req in ev["requests"].items():
            for rule in req["rules"]:
                seen = baseline.setdefault(rule["type"], rule["before"])
                if seen != rule["before"]:
                    raise WeekError("%s 의 요청들이 %s 규칙의 수정 전 값을 다르게 말합니다" % (eid, rule["type"]))
        for rid, req in ev["requests"].items():
            link = links.get("%s.%s" % (eid, rid))
            if link is None or link["verdict"] not in VERDICTS:
                # A request with no basis in what the residents said is not a choice we show.
                raise WeekError("%s.%s 는 주민 평가에서 근거를 찾지 못했습니다(연결 점검)" % (eid, rid))
            key = "%s.%s" % (eid, rid)
            requests.append({
                "id": rid,
                "label": req["label"],
                "expect": req["expect"],
                "cost": req["cost"],
                "rules": [_rule_change(eid, r) for r in req["rules"]],
                "basis": {"verdict": link["verdict"], "actor": link["actor"] or None, "quote": link["basis"] or None,
                          "kind": link.get("kind") or None},
                "after": {"scene": _scene(key, req["scene"], dialogue), "evaluations": evals_of(eid, rid, [key])},
            })
        if ev.get("noChoice") and requests:
            raise WeekError("%s 는 선택지 없는 사건인데 요청이 있습니다" % eid)
        events.append({
            "id": eid,
            "title": ev["title"],
            "gist": ev["gist"],
            "noChoice": bool(ev.get("noChoice")),
            "precededBy": ev.get("precededBy"),
            "precedes": ev.get("precedes"),
            "rules": [_rule_now(eid, t, v) for t, v in baseline.items()],
            "before": {
                "scenes": [_scene(k, ev["scenes"][k.split(".", 1)[1]], dialogue) for k in before_keys],
                "evaluations": evals_of(eid, "before", before_keys),
            },
            "requests": requests,
        })

    by_id = {e["id"]: e for e in events}
    session = schedule["sessions"]["s1"]
    days = []
    for day in DAYS:
        ids = session.get(day, [])
        for i in ids:
            if i not in by_id:
                raise WeekError("배치에 없는 사건 %s" % i)
        days.append({"day": day, "events": ids})
    placed = [i for d in days for i in d["events"]]
    for ev in events:
        for other in (ev["precedes"],):
            if other and other in by_id and placed.index(ev["id"]) > placed.index(other):
                raise WeekError("%s 는 %s 보다 앞선 날에 놓여야 합니다" % (ev["id"], other))
    return {"days": days, "people": names, "events": events, "disclaimer": DISCLAIMER}
