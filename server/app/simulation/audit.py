"""Three checks on the simulator itself, not on any policy.

Anyone who takes this method to another community has to answer three
questions before a comparison means anything, and until 2026-09-15 all three
were answered by hand or not at all:

1. **Does every knob do something?** A condition the screen offers but the
   engine ignores is worse than a missing one: the researcher concludes it
   made no difference (``PolicyParams``). ``knob_effects`` flips each
   supported knob on each policy, on the same day, and reports whether the
   committed log changed. A knob that changes nothing anywhere is dead.
2. **Does a result hold across days?** One seed is one day. ``stability``
   runs the same policies over many drawn days (env-v3: same routine, times
   ±10 min) and says how often the policy ordering on each measure held.
3. **How far do the model residents stray from the source-backed table, and
   how often does the synthesis misfile a claim?** ``table_disagreement``
   counts it from recorded runs; ``synthesis_sheet`` turns a session into a
   labelling sheet a person fills in, and ``synthesis_misclassification``
   counts only what was labelled.

Everything here is read off ``run_attempt`` and saved run files; nothing is
added to the engine. ``scripts/audit.py`` runs it and writes ``.run/audit/``.
"""
from __future__ import annotations

from statistics import median
from typing import Any, Callable

from .contracts import ContactStrategy, PolicyParams, PolicyRevision
from .decks.registry import DECK_DEFAULTS, POLICIES
from .runner import RunResult, log_fingerprint, run_attempt
from .village import Village

# ------------------------------------------------------------------ 1. knobs

#: For each supported knob: a value that differs from whatever the policy has,
#: and the condition under which the engine can even reach it. A knob that is
#: unreachable on a policy is reported as such, not as dead.
Flip = Callable[[PolicyParams], Any]
KNOB_FLIPS: dict[str, tuple[Flip, Callable[[PolicyRevision], str | None]]] = {
    "retryCount": (lambda p: 0 if p.retryCount else 1, lambda _: None),
    "retryIntervalMin": (lambda p: 120 if p.retryIntervalMin != 120 else 60,
                         lambda r: None if r.params.retryCount else "재연락이 0회면 간격은 읽히지 않는다"),
    "quietWindowMin": (lambda p: 180 if p.quietWindowMin != 180 else 0,
                       lambda r: None if r.params.retryCount else "재연락이 0회면 대기 시간은 읽히지 않는다"),
    "helperContactCap": (lambda p: 0 if p.helperContactCap else 2, lambda _: None),
    "neighbourAskLimit": (lambda p: 1 if p.neighbourAskLimit != 1 else 8, lambda _: None),
    "disclosure": (lambda p: "minimal" if p.disclosure == "named" else "named", lambda _: None),
    # Five minutes: earlier than any local resolution on the fixed day, so a
    # deadline that can fire at all fires here.
    "escalateToInstitutionAfterMin": (
        lambda p: 5 if p.escalateToInstitutionAfterMin != 5 else 30, lambda _: None),
    "allowHeadContact": (
        lambda p: not p.allowHeadContact,
        lambda r: ("head_first에서는 끌 수 없다"
                   if r.contactStrategy is ContactStrategy.head_first else None)),
    "rideCandidateOrder": (
        lambda p: "kin_first" if p.rideCandidateOrder == "closest_first" else "closest_first",
        lambda _: None),
    "maxRideDetourMin": (lambda p: 0 if p.maxRideDetourMin else 60, lambda _: None),
}
assert set(KNOB_FLIPS) == set(PolicyParams.SUPPORTED), "every supported knob gets a flip"


def _run(policy: PolicyRevision, deck_id: str, village: Village, persona_path: str,
         seed: int, environment_id: str, attempt_id: str) -> RunResult:
    resource_id = DECK_DEFAULTS[deck_id]["resourceRevisionId"]
    return run_attempt(attempt_id, policy.id, deck_id, resource_id, policy=policy,
                       village=village, persona_path=persona_path, seed=seed,
                       environment_id=environment_id)


def knob_effects(village: Village, persona_path: str, policy_ids: list[str],
                 deck_ids: list[str], seed: int = 17,
                 environment_id: str = "env-v3-fixed") -> list[dict[str, Any]]:
    """One row per (policy, deck, knob): did flipping it change the log?

    ``logChanged`` is a fingerprint comparison, so a knob that changes the
    order of two events counts as well as one that changes the outcome. ``note``
    says why a knob was skipped rather than leaving a blank that reads as dead.
    """
    rows = []
    for deck_id in deck_ids:
        for policy_id in policy_ids:
            base = POLICIES[policy_id]
            before = _run(base, deck_id, village, persona_path, seed, environment_id, "audit-base")
            base_print = log_fingerprint(before.events)
            for knob, (flip, blocker) in KNOB_FLIPS.items():
                row = {"deck": deck_id, "policy": policy_id,
                       "strategy": base.contactStrategy.value, "knob": knob,
                       "before": getattr(base.params, knob)}
                why = blocker(base)
                if why:
                    rows.append({**row, "after": None, "logChanged": None, "note": why})
                    continue
                after_value = flip(base.params)
                # Same id on purpose: the log records the policy id in every
                # decision, and a renamed copy would differ on that alone.
                flipped = base.model_copy(update={
                    "params": base.params.model_copy(update={knob: after_value})})
                after = _run(flipped, deck_id, village, persona_path, seed, environment_id,
                             "audit-flip")
                changed = log_fingerprint(after.events) != base_print
                rows.append({**row, "after": after_value, "logChanged": changed,
                             "note": _effect_note(before, after) if changed
                             else "이 하루에서는 달라지지 않음"})
    return rows


def _effect_note(before: RunResult, after: RunResult) -> str:
    b, a = before.metrics, after.metrics
    parts = []
    if b["requests"]["outcomes"] != a["requests"]["outcomes"]:
        parts.append("결과 %s → %s" % (b["requests"]["outcomes"], a["requests"]["outcomes"]))
    if b["contacts"]["attempts"] != a["contacts"]["attempts"]:
        parts.append("연락 %d → %d회" % (b["contacts"]["attempts"], a["contacts"]["attempts"]))
    if b["neighbourMinutes"] != a["neighbourMinutes"]:
        parts.append("이웃 시간 %.1f → %.1f분" % (b["neighbourMinutes"], a["neighbourMinutes"]))
    if b["waitMs"]["meanMinutesResolvedOnly"] != a["waitMs"]["meanMinutesResolvedOnly"]:
        parts.append("해결까지 %s → %s분" % (b["waitMs"]["meanMinutesResolvedOnly"],
                                          a["waitMs"]["meanMinutesResolvedOnly"]))
    if set(b["disclosure"]) != set(a["disclosure"]) or b["disclosure"] != a["disclosure"]:
        parts.append("공개 범위 달라짐")
    return " · ".join(parts) if parts else "로그만 달라짐 (지표는 같음)"


def dead_knobs(rows: list[dict[str, Any]]) -> list[str]:
    """Knobs that changed no log on any policy where they were reachable."""
    reachable = {r["knob"] for r in rows if r["logChanged"] is not None}
    alive = {r["knob"] for r in rows if r["logChanged"]}
    return sorted(reachable - alive)


# ------------------------------------------------------------- 2. stability

#: What a day is summarised to: label, reader, and which way is "first" in
#: the ranking (``resolved`` counts up, everything else is a cost).
MEASURES: dict[str, tuple[str, Callable[[dict[str, Any]], float | None], str]] = {
    "resolved": ("해결된 건", lambda m: m["requests"]["resolved"], "higher"),
    "waitMinutes": ("해결까지 걸린 시간(분)", lambda m: m["waitMs"]["meanMinutesResolvedOnly"], "lower"),
    "contacts": ("연락 횟수", lambda m: m["contacts"]["attempts"], "lower"),
    "neighbourMinutes": ("이웃이 쓴 시간(분)", lambda m: m["neighbourMinutes"], "lower"),
    "peopleTouched": ("하루가 건드려진 사람 수",
                      lambda m: sum(1 for b in m["residentBurden"].values()
                                    if b["addedTaskMinutes"] > 0), "lower"),
}


def stability(village: Village, persona_path: str, policy_ids: list[str], deck_id: str,
              seeds: list[int], environment_id: str = "env-v3") -> dict[str, Any]:
    """The same policies over many drawn days.

    Returns per policy and measure the min/median/max, and per measure how many
    of the days produced the same policy ordering as the median did. A finding
    that holds on 20 of 20 days is a finding about the policies; one that holds
    on 11 of 20 is a finding about the day.
    """
    runs: dict[str, list[dict[str, Any]]] = {p: [] for p in policy_ids}
    for seed in seeds:
        for policy_id in policy_ids:
            result = _run(POLICIES[policy_id], deck_id, village, persona_path, seed,
                          environment_id, "audit-stab")
            m = result.metrics
            runs[policy_id].append({
                "seed": seed, "outcomes": m["requests"]["outcomes"],
                "paths": m["requests"]["resolutionPaths"],
                **{k: get(m) for k, (_, get, _d) in MEASURES.items()}})
    summary = {}
    for policy_id, days in runs.items():
        summary[policy_id] = {}
        for key in MEASURES:
            values = [d[key] for d in days if d[key] is not None]
            summary[policy_id][key] = (
                {"min": min(values), "median": median(values), "max": max(values),
                 "n": len(values), "censored": len(days) - len(values)}
                if values else {"min": None, "median": None, "max": None, "n": 0,
                                "censored": len(days)})
        summary[policy_id]["outcomes"] = _count(o for d in days for o in d["outcomes"])
        summary[policy_id]["paths"] = _count(p for d in days for p in d["paths"])
    return {"deck": deck_id, "environment": environment_id, "seeds": seeds,
            "policies": policy_ids, "summary": summary, "days": runs,
            "ranking": _ranking(runs, policy_ids, seeds)}


def _ranking(runs: dict[str, list[dict[str, Any]]], policy_ids: list[str],
             seeds: list[int]) -> dict[str, Any]:
    out = {}
    for key, (_, _get, direction) in MEASURES.items():
        sign = -1 if direction == "higher" else 1
        by_median = sorted(policy_ids, key=lambda p: sign * (
            median([d[key] for d in runs[p] if d[key] is not None] or [float("inf")])))
        held = 0
        for i in range(len(seeds)):
            if any(runs[p][i][key] is None for p in policy_ids):
                continue
            # A tie may sit either way; only a reversal breaks the order.
            if all(sign * runs[a][i][key] <= sign * runs[b][i][key]
                   for a, b in zip(by_median, by_median[1:])):
                held += 1
        out[key] = {"direction": direction, "orderByMedian": by_median,
                    "heldOnDays": held, "ofDays": len(seeds)}
    return out


def _count(values: Any) -> dict[str, int]:
    out: dict[str, int] = {}
    for v in values:
        out[v] = out.get(v, 0) + 1
    return dict(sorted(out.items()))


# ------------------------------------- 3. model residents vs the table; synthesis

def table_disagreement(runs: list[dict[str, Any]]) -> dict[str, Any]:
    """Over ``scripts/llm_repeat.py`` rows: of the model residents' answers
    that carry the table's verdict, how many differ from it, and how."""
    answered = 0
    differ = []
    for run in runs:
        if "error" in run:
            continue
        for x in run.get("residents", []):
            if x.get("table") is None:
                continue
            answered += 1
            if x.get("agrees") is False:
                differ.append({"policy": run["policy"], "run": run["run"],
                               "actor": x["actor"], "model": x["type"].split(".")[1],
                               "table": x["table"], "rule": x.get("rule"),
                               "utterance": (x.get("utterance") or "")[:120]})
    return {"runs": sum(1 for r in runs if "error" not in r),
            "answersWithVerdict": answered, "disagreements": len(differ),
            "rate": round(len(differ) / answered, 3) if answered else None,
            "cases": differ,
            "note": ("표는 원자료 근거 거절 규칙이다. 어긋남은 오답이 아니라 모델 주민이 표와 "
                     "다르게 답한 횟수이며, 어느 쪽이 맞는지는 전사와 대조해야 한다.")}


def shadow_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Over ``scripts/llm_shadow.py`` rows - the model resident asked the same
    question as the rule resident, from the same view - how often the two
    differ, per table verdict. The verdict is the row, because "never differs
    on accept, always differs on decline" is the finding, not the average."""
    by_verdict: dict[str, dict[str, Any]] = {}
    for r in rows:
        key = "%s/%s" % (r["table"], r["tableRule"] or "-")
        cell = by_verdict.setdefault(key, {"table": r["table"], "rule": r["tableRule"],
                                           "asked": 0, "differ": 0, "modelSaid": {}})
        cell["asked"] += 1
        cell["differ"] += 0 if r["agrees"] else 1
        cell["modelSaid"][r["model"]] = cell["modelSaid"].get(r["model"], 0) + 1
    differ = sum(1 for r in rows if not r["agrees"])
    return {"questions": len(rows), "disagreements": differ,
            "rate": round(differ / len(rows), 3) if rows else None,
            "byVerdict": dict(sorted(by_verdict.items())),
            "note": ("규칙 마을이 만든 상황에서 모델 주민에게 같은 질문을 한 것이다. 표가 거절·"
                     "유예·전달을 말한 칸에서 모델이 수락하면, 모델 마을은 마을의 응할 의사를 "
                     "높게 잡는다.")}


def synthesis_sheet(session_detail: dict[str, Any]) -> list[dict[str, Any]]:
    """Every claim the synthesis filed, with a blank for a person's label.

    ``filedAs`` is what the synthesis said; ``humanLabel`` is to be filled in
    with ``grounded`` / ``ungrounded`` after reading the log. ``draftLabel`` is
    an AI-written guess and must not be counted as a person's.
    """
    items = []
    for g in session_detail.get("generations", []):
        syn = g.get("synthesis")
        if not syn:
            continue
        for claim in syn.get("ungroundedClaims", []):
            items.append({"generation": g["index"], "kind": "claim", "text": claim,
                          "filedAs": "ungrounded", "humanLabel": None, "draftLabel": None,
                          "draftReason": ""})
        for ig in syn.get("issueGroups", []):
            items.append({"generation": g["index"], "kind": "issue", "id": ig["id"],
                          "text": ig["title"], "eventRefs": ig.get("eventRefs", []),
                          "filedAs": "grounded" if ig.get("eventRefs") else "no_event_refs",
                          "severity": ig.get("severity"),
                          "humanLabel": None, "draftLabel": None, "draftReason": ""})
    return items


def synthesis_misclassification(sheet: list[dict[str, Any]],
                                label_field: str = "humanLabel") -> dict[str, Any]:
    """Counted only over items that carry a label in ``label_field``."""
    labelled = [i for i in sheet if i.get(label_field) in ("grounded", "ungrounded")]
    wrong = [i for i in labelled
             if (i["filedAs"] == "ungrounded") != (i[label_field] == "ungrounded")]
    return {"labelled": len(labelled), "ofItems": len(sheet), "misfiled": len(wrong),
            "rate": round(len(wrong) / len(labelled), 3) if labelled else None,
            "labelField": label_field,
            "cases": [{"generation": i["generation"], "kind": i["kind"], "text": i["text"],
                       "filedAs": i["filedAs"], "label": i[label_field]} for i in wrong]}
