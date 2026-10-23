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
* a resident's reading says which part of their interview it rests on (``grounding``), or that it rests on none;
* every request says how it moved each resident's feedback (``change``: resolved / remaining / unclear / new),
  by pointing at the claims themselves, so the words are never written twice;
* the AI ran every event on one draft: a rule has one value before anything is chosen, whichever event it is in
  (``draft``);
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
#: The parts of an interviewed resident's persona a reading may rest on (scripts/gen_week_evaluations.py FIELDS).
GROUNDS = {"하루", "건강", "의료 행동", "디지털", "AI 태도", "관계", "연기 지침"}
#: What a change sorts: the uncomfortable and the wished-for.
TROUBLE = {"bad", "wish"}
#: How many readings a change is the majority of (scripts/gen_week_evaluations.py VOTES).
VOTES = 3


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
    ground = ev.get("grounding")
    if ground is None or ground["field"] not in GROUNDS | {""} or bool(ground["field"]) != bool(ground["note"]):
        raise WeekError("%s.%s %s 의 평가에 인터뷰 근거 표기가 없거나 맞지 않습니다" % (ev["event"], ev["variant"], ev["actor"]))
    return {
        "actor": ev["actor"],
        "name": names.get(ev["actor"], ev["actor"]),
        "source": "simulated",
        "paragraph": ev["paragraph"],
        "claims": [{"kind": c["kind"], "text": c["text"], "citedLines": c["citedLines"]} for c in ev["claims"]],
        # Only the twelve residents (P1-P12) were interviewed; the clinic head is a role, with no interview to rest on.
        "grounding": {"field": ground["field"] or None, "note": ground["note"] or None, "interviewed": ev["actor"].startswith("P")},
        "disclaimer": ev["disclaimer"],
    }


def _change(key: str, recorded: dict[str, Any] | None, before: list[dict[str, Any]], after: list[dict[str, Any]],
            names: dict[str, str]) -> list[dict[str, Any]]:
    """How one request moved each resident's feedback, in the claims' own words. Every trouble of the version it was
    chosen on is resolved, remaining or unclear exactly once; a new one is a trouble of the version it made."""
    if recorded is None:
        raise WeekError("%s 의 피드백 변화가 없습니다(gen_week_evaluations.py compare)" % key)
    was = {e["actor"]: e for e in before}
    now = {e["actor"]: e for e in after}
    if set(recorded) != set(was) | set(now):
        raise WeekError("%s 의 피드백 변화가 다룬 사람이 두 버전의 사람과 다릅니다" % key)
    out = []
    for actor, c in recorded.items():
        presence = "both" if actor in was and actor in now else "before" if actor in was else "after"
        if c["presence"] != presence:
            raise WeekError("%s %s 의 피드백 변화가 등장 여부를 잘못 적었습니다" % (key, actor))
        if presence == "both" and c.get("votes") != VOTES:
            raise WeekError("%s %s 의 피드백 변화가 %d번 읽은 다수결이 아닙니다(compare)" % (key, actor, VOTES))
        troubles = [i for i, x in enumerate(was[actor]["claims"]) if x["kind"] in TROUBLE] if actor in was else []
        fresh = [i for i, x in enumerate(now[actor]["claims"]) if x["kind"] in TROUBLE] if actor in now else []
        if sorted(c["resolved"] + c["remaining"] + c["unclear"]) != troubles or any(i not in fresh for i in c["new"]):
            raise WeekError("%s %s 의 피드백 변화가 불편을 빠뜨리거나 두 번 셌습니다" % (key, actor))
        old = lambda ids: [was[actor]["claims"][i]["text"] for i in ids]  # noqa: E731
        out.append({
            "actor": actor, "name": names.get(actor, actor), "presence": presence,
            "resolved": old(c["resolved"]), "remaining": old(c["remaining"]), "unclear": old(c["unclear"]),
            "new": [now[actor]["claims"][i]["text"] for i in c["new"]],
        })
    return out


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


def _all_rules(requests: dict[str, Any], level: int = 0) -> list[dict[str, Any]]:
    """Every rule change in a tree of requests, each tagged with how deep it is (0 = offered on the first version)."""
    out: list[dict[str, Any]] = []
    for req in requests.values():
        out += [{**rule, "_level": level} for rule in req["rules"]]
        out += _all_rules(req.get("requests", {}), level + 1)
    return out


def load_week(weeks_dir: Path = WEEK_DIR) -> dict[str, Any]:
    briefs = _load("briefs.json", weeks_dir)
    dialogue = _load("dialogue.json", weeks_dir)["scenes"]
    evaluations = _load("evaluations.json", weeks_dir)
    schedule = _load("schedule.json", weeks_dir)
    names = _names(briefs)
    made = evaluations["evaluations"]
    links = evaluations.get("links", {})
    changes = evaluations.get("changes", {})

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

    def build_requests(eid: str, offered: dict[str, Any], path: list[str], running: dict[str, dict[str, Any]],
                       evaluated: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """The requests offered on one version, each with the version it makes (its scene and the residents' words)
        and, in turn, the requests that version offers. ``running`` is how the AI runs on this version, by rule type:
        a request's ``before`` has to say exactly that, or the judgment panel would say two things."""
        out = []
        for rid, req in offered.items():
            here = path + [rid]
            name = ".".join(here)
            key = "%s.%s" % (eid, name)
            for rule in req["rules"]:
                if rule["type"] in running and running[rule["type"]] != rule["before"]:
                    raise WeekError("%s 의 수정 전 값이 앞 버전이 돌던 값과 다릅니다(%s)" % (key, rule["type"]))
            link = links.get(key)
            if link is None or link["verdict"] not in VERDICTS:
                # A request with no basis in what the residents said is not a choice we show.
                raise WeekError("%s 는 주민 평가에서 근거를 찾지 못했습니다(연결 점검)" % key)
            if link["verdict"] == "weak" and not link.get("why"):
                # A weak basis says why it is weak: beside a direct one on the same words, it would read as a contradiction.
                raise WeekError("%s 의 약한 근거에 이유가 없습니다(explain)" % key)
            now = dict(running)
            for rule in req["rules"]:
                now[rule["type"]] = rule["after"]
            after_evals = evals_of(eid, name, [key])
            out.append({
                "id": rid,
                "label": req["label"],
                "expect": req["expect"],
                "cost": req["cost"],
                "rules": [_rule_change(eid, r) for r in req["rules"]],
                "basis": {"verdict": link["verdict"], "actor": link["actor"] or None, "quote": link["basis"] or None,
                          "kind": link.get("kind") or None, "why": link.get("why") or None},
                "after": {
                    "scene": _scene(key, req["scene"], dialogue),
                    "evaluations": after_evals,
                    "change": _change(key, changes.get(key), evaluated, after_evals, names),
                    "requests": build_requests(eid, req.get("requests", {}), here, now, after_evals),
                },
            })
        return out

    events = []
    #: The draft the designer brought: each rule's value before anything was chosen, the same in every event.
    draft: dict[str, tuple[str, dict[str, Any]]] = {}
    for ev in briefs["events"]:
        eid = ev["id"]
        before_keys = ["%s.%s" % (eid, k) for k in ev["scenes"]]
        #: The rules the event ran under before anything was chosen: each request's ``before``. Two requests that
        #: disagree about how the AI ran would make the judgment panel say two things, so that stops the read.
        baseline: dict[str, dict[str, Any]] = {}
        for rule in sorted(_all_rules(ev["requests"]), key=lambda r: r["_level"]):
            if rule["_level"] > 0:
                # Only on a later version: nothing before it changed this rule, so what it says is how the AI always ran.
                baseline.setdefault(rule["type"], rule["before"])
                continue
            seen = baseline.setdefault(rule["type"], rule["before"])
            if seen != rule["before"]:
                raise WeekError("%s 의 요청들이 %s 규칙의 수정 전 값을 다르게 말합니다" % (eid, rule["type"]))
        before_evals = evals_of(eid, "before", before_keys)
        requests = build_requests(eid, ev["requests"], [], dict(baseline), before_evals)
        for rule_type, values in baseline.items():
            seen = draft.setdefault(rule_type, (eid, values))
            if seen[1] != values:
                raise WeekError("초안이 한 벌이 아닙니다: %s 규칙이 %s 와 %s 에서 다릅니다" % (rule_type, seen[0], eid))
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
                "evaluations": before_evals,
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
    return {"days": days, "people": names, "events": events,
            "draft": [_rule_now("draft", t, draft[t][1]) for t in rules.RULES if t in draft],
            "disclaimer": DISCLAIMER}
