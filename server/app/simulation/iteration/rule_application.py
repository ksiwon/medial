"""Did the changed rule actually run? (26번 C04 RuleApplicationRecord, F06)

Three questions that the comparison used to collapse into one "difference"
column:

1. **supported** - can this engine execute the rule at all? (the validator's
   question; answered before the run);
2. **condition occurred** - did the situation the rule governs arise in the
   child run? A retry rule never fires on a day when the first call is
   answered; a helper cap never fires when nobody is asked twice;
3. **executed** - did the run actually pass through the changed branch?

A record is computed per confirmed rule from the *child* attempt's committed
events only. It does not say the change was good, and an ``applied`` record
next to identical outcomes is a finding ("the rule ran and nothing else
changed"), not a dead knob. Where the log carries no trace of a branch the
record says ``unknown`` rather than guessing.
"""
from __future__ import annotations

from typing import Any

from ..contracts import HEALTH_STAFF, MEDIAL

Condition = str      # occurred | not_occurred | unknown
Execution = str      # applied | not_reached | unknown


def _events(events: list[dict[str, Any]], *types: str) -> list[dict[str, Any]]:
    return [e for e in events if e["type"] in types]


def _record(rule_type: str, condition: Condition, execution: Execution,
            reason: str, refs: list[str]) -> dict[str, Any]:
    return {"ruleType": rule_type, "conditionStatus": condition,
            "executionStatus": execution, "reason": reason,
            "eventRefs": refs[:12]}


def _retry(after: dict[str, Any], subject_ids: set[str],
           events: list[dict[str, Any]]) -> dict[str, Any]:
    no_answer = [e for e in _events(events, "contact.no_response")
                 if e["payload"].get("toActorId") in subject_ids]
    retries = [e for e in _events(events, "contact.attempted")
               if e["payload"].get("toActorId") in subject_ids
               and e["payload"].get("channel") == "phone"
               and int(e["payload"].get("attemptNumber") or 1) > 1]
    if not no_answer:
        return _record("retry_before_help", "not_occurred", "not_reached",
                       "첫 연락에 응답이 있어 재연락 단계가 생기지 않았다.",
                       [e["id"] for e in _events(events, "contact.answered")])
    want = int(after.get("count") or 0)
    if len(retries) == want:
        return _record("retry_before_help", "occurred", "applied",
                       "무응답 뒤 본인에게 전화 재연락 %d회가 기록됐다." % len(retries),
                       [e["id"] for e in retries] or [e["id"] for e in no_answer])
    return _record("retry_before_help", "occurred", "unknown",
                   "규칙은 %d회인데 기록된 전화 재연락은 %d회다. 하루가 끝났거나 다른 분기가 먼저 닫았을 수 있다."
                   % (want, len(retries)),
                   [e["id"] for e in retries] or [e["id"] for e in no_answer])


def _quiet(after: dict[str, Any], subject_ids: set[str],
           events: list[dict[str, Any]]) -> dict[str, Any]:
    by_actor: dict[str, list[dict[str, Any]]] = {}
    for e in _events(events, "contact.attempted"):
        by_actor.setdefault(e["payload"].get("toActorId"), []).append(e)
    repeated = {a: rows for a, rows in by_actor.items() if len(rows) >= 2}
    if not repeated:
        return _record("quiet_period", "not_occurred", "not_reached",
                       "같은 사람에게 두 번 연락한 경우가 없어 최소 간격이 검사될 상황이 없었다.", [])
    minutes = int(after.get("minutes") or 0)
    gaps = []
    refs = []
    for rows in repeated.values():
        rows = sorted(rows, key=lambda e: e["simTimeMs"])
        for a, b in zip(rows, rows[1:]):
            gaps.append((b["simTimeMs"] - a["simTimeMs"]) / 60000)
            refs.extend([a["id"], b["id"]])
    if all(g >= minutes for g in gaps):
        return _record("quiet_period", "occurred", "applied",
                       "반복 연락 사이 간격이 모두 %d분 이상이다 (최소 %.0f분)." % (minutes, min(gaps)),
                       refs)
    return _record("quiet_period", "occurred", "unknown",
                   "반복 연락 중 %d분보다 짧은 간격이 있다 (최소 %.0f분). 다른 규칙이 먼저 잡았을 수 있다."
                   % (minutes, min(gaps)), refs)


def _cap(after: dict[str, Any], subject_ids: set[str],
         events: list[dict[str, Any]]) -> dict[str, Any]:
    hits = [e for e in _events(events, "request.declined")
            if e["payload"].get("rule") == "asked_too_often"]
    offered: dict[str, int] = {}
    for e in _events(events, "request.offered"):
        offered[e["payload"].get("toActorId")] = offered.get(e["payload"].get("toActorId"), 0) + 1
    if hits:
        return _record("helper_daily_cap", "occurred", "applied",
                       "부탁 상한에 걸려 거절한 사건이 %d건 기록됐다." % len(hits),
                       [e["id"] for e in hits])
    per_day = int(after.get("perDay") or 0)
    busiest = max(offered.values(), default=0)
    if busiest < per_day:
        return _record("helper_daily_cap", "not_occurred", "not_reached",
                       "아무도 하루 %d번까지 부탁받지 않았다 (최대 %d번)." % (per_day, busiest), [])
    return _record("helper_daily_cap", "occurred", "unknown",
                   "누군가 %d번 부탁받았지만 상한 거절 사건은 없다." % busiest, [])


def _limit(after: dict[str, Any], subject_ids: set[str],
           events: list[dict[str, Any]]) -> dict[str, Any]:
    asked = sorted({e["payload"].get("toActorId") for e in _events(events, "request.offered")
                    if e["actorId"] == MEDIAL and e["payload"].get("toActorId") != HEALTH_STAFF})
    declines = _events(events, "request.declined", "request.deferred")
    people = int(after.get("people") or 0)
    if not declines:
        return _record("neighbour_ask_limit", "not_occurred", "not_reached",
                       "첫 사람이 받아들여 다음 사람에게 갈 상황이 없었다.",
                       [e["id"] for e in _events(events, "request.accepted")])
    if len(asked) >= people:
        return _record("neighbour_ask_limit", "occurred", "applied",
                       "거절 뒤 %d명까지 차례로 물었다 (%s)." % (len(asked), ", ".join(asked)),
                       [e["id"] for e in declines])
    return _record("neighbour_ask_limit", "occurred", "unknown",
                   "거절이 있었지만 %d명 한도 전에 다른 이유로 끝났다 (물은 사람 %d명)."
                   % (people, len(asked)), [e["id"] for e in declines])


def _disclosure(after: dict[str, Any], subject_ids: set[str],
                events: list[dict[str, Any]]) -> dict[str, Any]:
    third_party = [e for e in _events(events, "request.offered", "handoff.requested",
                                      "contact.attempted")
                   if e["payload"].get("toActorId") not in subject_ids
                   and isinstance(e["payload"].get("disclosure"), dict)]
    if not third_party:
        return _record("disclosure_scope", "not_occurred", "not_reached",
                       "제3자에게 정보가 전달된 사건이 없다.", [])
    level = after.get("level")
    counts = [len(e["payload"]["disclosure"].get("fields") or []) for e in third_party]
    ok = all(c == 0 for c in counts) if level == "minimal" else any(c > 0 for c in counts)
    return _record("disclosure_scope", "occurred", "applied" if ok else "unknown",
                   ("제3자 전달 %d건의 공개 항목 수: %s" % (len(third_party), counts)),
                   [e["id"] for e in third_party])


def _deadline(after: dict[str, Any], subject_ids: set[str],
              events: list[dict[str, Any]]) -> dict[str, Any]:
    fired = [e for e in _events(events, "medial.decided")
             if "escalateToInstitutionAfterMin" in str(e["payload"].get("rationale", ""))]
    limit = after.get("afterMinutes")
    if limit is None:
        return _record("institution_deadline", "unknown", "applied" if not fired else "unknown",
                       "기한이 없으므로 기한 인계가 일어나지 않아야 한다 (기록 %d건)." % len(fired),
                       [e["id"] for e in fired])
    if fired:
        return _record("institution_deadline", "occurred", "applied",
                       "접수 후 %d분 기한이 지나 기관으로 넘긴 판단이 기록됐다." % limit,
                       [e["id"] for e in fired])
    resolved = _events(events, "need.resolved")
    return _record("institution_deadline", "not_occurred", "not_reached",
                   "기한 %d분 전에 요청이 닫혔거나 하루가 끝났다." % limit,
                   [e["id"] for e in resolved])


def _order(after: dict[str, Any], subject_ids: set[str],
           events: list[dict[str, Any]]) -> dict[str, Any]:
    offers = [e for e in _events(events, "request.offered") if e["actorId"] == MEDIAL]
    handoffs = _events(events, "handoff.requested")
    if not offers and not handoffs:
        return _record("contact_order", "not_occurred", "not_reached",
                       "본인 연락 뒤 다른 사람에게 갈 상황이 없었다.", [])
    strategy = after.get("strategy")
    first = offers[0] if offers else None
    refs = [e["id"] for e in offers[:3]] + [e["id"] for e in handoffs[:2]]
    if strategy == "retry_then_clinic":
        ok = bool(handoffs) and not offers
        why = "이웃에게 부탁하지 않고 기관에 넘겼다." if ok else "이웃에게 부탁한 기록이 있다."
    elif strategy == "head_first":
        ok = first is not None and first["payload"].get("purpose") != "whereabouts"
        why = "첫 부탁 상대: %s." % (first["payload"].get("toActorId") if first else "없음")
    else:
        ok = first is not None
        why = "첫 부탁 상대: %s." % (first["payload"].get("toActorId") if first else "없음")
    return _record("contact_order", "occurred", "applied" if ok else "unknown", why, refs)


def _ride_order(after: dict[str, Any], subject_ids: set[str],
                events: list[dict[str, Any]]) -> dict[str, Any]:
    needs = _events(events, "transport.need_raised")
    offers = [e for e in _events(events, "request.offered")
              if e["payload"].get("purpose") == "ride" or "ride" in str(e["payload"].get("need", ""))]
    if not needs:
        return _record("ride_candidate_order", "not_occurred", "not_reached",
                       "이동 필요가 발생하지 않았다.", [])
    offers = offers or [e for e in _events(events, "request.offered")
                        if e["correlationId"] in {n["correlationId"] for n in needs}]
    if offers:
        return _record("ride_candidate_order", "occurred", "applied",
                       "동승 부탁 순서: %s." % ", ".join(e["payload"].get("toActorId", "?") for e in offers[:4]),
                       [e["id"] for e in offers])
    return _record("ride_candidate_order", "occurred", "unknown",
                   "이동 필요는 있었지만 동승 부탁 사건이 없다.", [e["id"] for e in needs])


def _detour(after: dict[str, Any], subject_ids: set[str],
            events: list[dict[str, Any]]) -> dict[str, Any]:
    needs = _events(events, "transport.need_raised")
    if not needs:
        return _record("ride_detour_limit", "not_occurred", "not_reached",
                       "이동 필요가 발생하지 않았다.", [])
    hits = [e for e in _events(events, "request.declined")
            if e["payload"].get("reason") == "detour_too_long"
            or e["payload"].get("rule") == "detour_too_long"]
    if hits:
        return _record("ride_detour_limit", "occurred", "applied",
                       "우회 한도 때문에 거절한 사건이 %d건이다." % len(hits), [e["id"] for e in hits])
    return _record("ride_detour_limit", "occurred", "unknown",
                   "동승 부탁은 있었지만 우회 한도에 걸린 거절은 없다.", [e["id"] for e in needs])


PROBES = {
    "retry_before_help": _retry,
    "quiet_period": _quiet,
    "helper_daily_cap": _cap,
    "neighbour_ask_limit": _limit,
    "disclosure_scope": _disclosure,
    "institution_deadline": _deadline,
    "contact_order": _order,
    "ride_candidate_order": _ride_order,
    "ride_detour_limit": _detour,
}


def rule_application(change_set: Any, attempts: list[tuple[str, list[dict[str, Any]]]],
                     ) -> list[dict[str, Any]]:
    """One record per typed rule in the confirmed Change Set, over the child's
    attempts. ``attempts`` is ``[(attemptId, events)]``."""
    out: list[dict[str, Any]] = []
    for change in change_set.changes:
        semantic = change.semantic
        if semantic is None:
            out.append({"ruleType": None, "conditionStatus": "unknown",
                        "executionStatus": "unknown",
                        "reason": "규칙 종류가 없는 옛 형식의 변경이라 적용 여부를 판정하지 않는다.",
                        "eventRefs": [], "attemptId": None})
            continue
        probe = PROBES.get(semantic.ruleType)
        for attempt_id, events in attempts:
            subject_ids = {e["payload"].get("subjectId") for e in events
                           if e["type"] in ("request.raised", "transport.need_raised")}
            subject_ids.discard(None)
            if probe is None:
                record = _record(semantic.ruleType, "unknown", "unknown",
                                 "이 규칙의 적용 여부를 로그에서 읽는 검사가 없다.", [])
            else:
                record = probe(semantic.after.model_dump(mode="json"), subject_ids, events)
            record["attemptId"] = attempt_id
            record["label"] = change.afterRule
            out.append(record)
    return out
