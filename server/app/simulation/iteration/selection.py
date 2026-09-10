"""Comparing candidate generations without inventing a winner.

Two rules do most of the work here:

* **an unknown is not evidence.** If either side of a comparison has no value for
  a criterion, that criterion cannot support a dominance claim. A candidate is
  only "clearly better" when every criterion is known on both sides;
* **the incumbent competes.** A candidate is compared against the generation it
  came from, not only against its siblings, so "we ran three generations" cannot
  become "the third one won" by default.

When two candidates trade off against each other the answer is
``needs_decision``, not an average. A designer who set a priority order before
starting gets that order applied and recorded; a designer who did not gets asked.
"""
from __future__ import annotations

from typing import Any

from .contracts import AgentReview, Criterion, CriteriaRevision

#: The default measures, all computed from the stored log. Directions are fixed
#: when the session starts and an edit means a new session.
DEFAULT_CRITERIA = CriteriaRevision(
    id="criteria-default-v1",
    label="기본 비교 기준 (연구자 지표 + 리뷰 집계)",
    criteria=[
        Criterion(key="engineFaults", label="엔진 오류·거부된 제안",
                  direction="lower_better", required=True, maxValue=0),
        Criterion(key="unresolvedRequests", label="미해결 요청 수",
                  direction="lower_better"),
        Criterion(key="meanWaitMinutes", label="해결까지 평균 대기(분, 해결 건만)",
                  direction="lower_better"),
        Criterion(key="neighbourMinutes", label="이웃이 쓴 시간(분)",
                  direction="lower_better"),
        Criterion(key="institutionStaffMinutes", label="기관 담당자 업무(분)",
                  direction="lower_better"),
        Criterion(key="disclosureFieldCount", label="전달된 정보 항목 수",
                  direction="lower_better"),
        Criterion(key="transportConflicts", label="차량 예약 충돌",
                  direction="lower_better"),
        Criterion(key="negativeReviewItems", label="부정 평가 항목 수(모의)",
                  direction="lower_better"),
    ],
    priorityOrder=["unresolvedRequests", "neighbourMinutes",
                   "institutionStaffMinutes", "meanWaitMinutes"],
)


def outcome_vector(metrics: dict[str, Any],
                   reviews: list[AgentReview]) -> dict[str, float | None]:
    """One row of numbers per attempt.

    ``None`` means the run does not establish this value - most often a mean over
    resolved requests when nothing resolved. It is kept as ``None`` rather than
    zero, because a zero would read as "no wait at all".
    """
    requests = metrics.get("requests") or {}
    waits = metrics.get("waitMs") or {}
    institution = metrics.get("institutionBurden") or {}
    disclosure = metrics.get("disclosure") or {}
    transport = metrics.get("transport") or {}

    negative = sum(1 for r in reviews for i in r.items if i.assessment == "negative")
    return {
        "engineFaults": float((metrics.get("adapterFailures") or 0)
                              + (metrics.get("rejectedProposals") or 0)),
        "unresolvedRequests": float(requests.get("unresolved", 0)),
        "meanWaitMinutes": (None if waits.get("meanMinutesResolvedOnly") is None
                            else float(waits["meanMinutesResolvedOnly"])),
        "neighbourMinutes": float(metrics.get("neighbourMinutes") or 0.0),
        "institutionStaffMinutes": float(institution.get("staffMinutes") or 0.0),
        "disclosureFieldCount": float(
            sum(int(v.get("fieldCount") or 0) for v in disclosure.values())),
        "transportConflicts": float(transport.get("conflictsDetected") or 0),
        "negativeReviewItems": float(negative),
    }


def per_actor_delta(before: dict[str, Any], after: dict[str, Any]) -> list[dict[str, Any]]:
    """Who gained and who lost, person by person.

    A whole-village total hides exactly the thing the reviews keep raising: the
    same total can mean everybody a little or one person a lot.
    """
    burden_before = before.get("residentBurden") or {}
    burden_after = after.get("residentBurden") or {}
    rows = []
    for actor_id in sorted(set(burden_before) | set(burden_after)):
        b = burden_before.get(actor_id, {})
        a = burden_after.get(actor_id, {})
        rows.append({
            "actorId": actor_id,
            "beforeMinutes": float(b.get("addedTaskMinutes") or 0),
            "afterMinutes": float(a.get("addedTaskMinutes") or 0),
            "beforeContacts": int(b.get("contactsReceived") or 0),
            "afterContacts": int(a.get("contactsReceived") or 0),
        })
    for row in rows:
        row["deltaMinutes"] = round(row["afterMinutes"] - row["beforeMinutes"], 1)
        row["deltaContacts"] = row["afterContacts"] - row["beforeContacts"]
    institution = {
        "actorId": "HC_NURSE",
        "beforeMinutes": float((before.get("institutionBurden") or {}).get(
            "staffMinutes") or 0),
        "afterMinutes": float((after.get("institutionBurden") or {}).get(
            "staffMinutes") or 0),
        "beforeContacts": 0, "afterContacts": 0,
    }
    institution["deltaMinutes"] = round(
        institution["afterMinutes"] - institution["beforeMinutes"], 1)
    institution["deltaContacts"] = 0
    rows.append(institution)
    return rows


def violates_required(vector: dict[str, float | None],
                      criteria: CriteriaRevision) -> list[str]:
    out = []
    for criterion in criteria.criteria:
        if not criterion.required:
            continue
        value = vector.get(criterion.key)
        if value is None:
            # A required constraint that cannot be evaluated is reported, not
            # waved through and not treated as a violation.
            out.append("%s 을(를) 확인할 수 없다" % criterion.label)
            continue
        if criterion.maxValue is not None and value > criterion.maxValue:
            out.append("%s 이(가) 상한 %s 을(를) 넘었다 (%s)"
                       % (criterion.label, criterion.maxValue, value))
        if criterion.minValue is not None and value < criterion.minValue:
            out.append("%s 이(가) 하한 %s 에 못 미친다 (%s)"
                       % (criterion.label, criterion.minValue, value))
    return out


def _better(direction: str, a: float, b: float) -> bool:
    return a < b if direction == "lower_better" else a > b


def dominates(a: dict[str, float | None], b: dict[str, float | None],
              criteria: CriteriaRevision) -> tuple[bool, list[str]]:
    """Does ``a`` beat ``b`` on every criterion and strictly beat it on one?

    Returns ``(False, reasons)`` whenever the comparison cannot be made, and the
    reasons say why - most importantly when a value is unknown on either side.
    """
    unknowns = []
    strictly_better = False
    for criterion in criteria.criteria:
        left, right = a.get(criterion.key), b.get(criterion.key)
        if left is None or right is None:
            unknowns.append(criterion.label)
            continue
        if _better(criterion.direction, right, left):
            return (False, ["%s 은(는) 더 나쁘다" % criterion.label])
        if _better(criterion.direction, left, right):
            strictly_better = True
    if unknowns:
        return (False, ["%s 은(는) 한쪽이 unknown이라 우열의 근거로 쓰지 않는다"
                        % ", ".join(unknowns)])
    return (strictly_better, [])


def evaluate(*, incumbent: dict[str, Any], candidates: list[dict[str, Any]],
             criteria: CriteriaRevision, selection_rule: str
             ) -> dict[str, Any]:
    """Pick a candidate, ask the designer, or say nothing improved.

    ``incumbent`` and each candidate are ``{"id", "label", "vector"}``.
    """
    excluded: list[dict[str, Any]] = []
    live: list[dict[str, Any]] = []
    for candidate in candidates:
        broken = violates_required(candidate["vector"], criteria)
        if broken:
            excluded.append({**candidate, "reason": "필수 조건 위반: " + "; ".join(broken)})
        else:
            live.append(candidate)

    dominated_by_incumbent = []
    unchanged = []
    remaining = []
    for candidate in live:
        if _same(incumbent["vector"], candidate["vector"], criteria):
            # The dial moved and nothing downstream did. That is a finding about
            # the condition, not a trade-off for a designer to weigh.
            unchanged.append({
                **candidate,
                "reason": "지정한 지표가 현재 세대와 모두 같다. 이 조건은 이번 상황에서 "
                          "결과를 바꾸지 않았다."})
            continue
        beaten, why = dominates(incumbent["vector"], candidate["vector"], criteria)
        if beaten:
            dominated_by_incumbent.append({
                **candidate,
                "reason": "현재 세대가 모든 지표에서 같거나 더 낫다. 진전이 아니다."})
        else:
            remaining.append({**candidate, "comparedToIncumbent": why})

    nondominated = []
    for candidate in remaining:
        beaten = any(dominates(other["vector"], candidate["vector"], criteria)[0]
                     for other in remaining if other["id"] != candidate["id"])
        if not beaten:
            nondominated.append(candidate)

    if not live:
        return {"decision": "no_valid", "selected": None, "nondominated": [],
                "excluded": excluded, "dominated": [],
                "reason": "모든 후보가 필수 조건을 어겼다."}
    if not remaining:
        return {"decision": "no_progress", "selected": None, "nondominated": [],
                "excluded": excluded,
                "dominated": dominated_by_incumbent + unchanged,
                "reason": ("모든 후보가 현재 세대와 같거나 더 나쁘다. 지표상 새 진전이 없다."
                           if unchanged else
                           "모든 후보가 현재 세대에 지배된다. 지표상 새 진전이 없다.")}
    if len(nondominated) == 1:
        winner = nondominated[0]
        return {"decision": "advance", "selected": winner["id"],
                "nondominated": nondominated, "excluded": excluded,
                "dominated": dominated_by_incumbent + unchanged,
                "reason": ("비지배 후보가 하나뿐이다: %s. 자동 진행 범위 안이다."
                           % winner["label"])}

    if selection_rule == "designer_priority" and criteria.priorityOrder:
        ranked = sorted(
            nondominated,
            key=lambda c: tuple(
                _sort_key(c["vector"].get(key), _direction(criteria, key))
                for key in criteria.priorityOrder))
        winner = ranked[0]
        return {"decision": "advance", "selected": winner["id"],
                "nondominated": nondominated, "excluded": excluded,
                "dominated": dominated_by_incumbent + unchanged,
                "reason": ("여러 후보가 trade-off이지만 시작 시 지정한 우선순위(%s)로 %s 을(를) "
                           "선택했다. 다른 후보는 분기로 보존한다."
                           % (", ".join(criteria.priorityOrder), winner["label"]))}

    return {"decision": "needs_decision", "selected": None,
            "nondominated": nondominated, "excluded": excluded,
            "dominated": dominated_by_incumbent + unchanged,
            "reason": ("후보 %d개가 서로 다른 지표에서 낫다. 자동으로 고르지 않고 "
                       "디자이너 결정을 기다린다." % len(nondominated))}


def _same(a: dict[str, float | None], b: dict[str, float | None],
          criteria: CriteriaRevision) -> bool:
    """Identical on every criterion, unknowns included.

    Two runs that produce the same numbers are not two options; treating them as
    a trade-off would ask a designer to choose between a thing and itself.
    """
    return all(a.get(c.key) == b.get(c.key) for c in criteria.criteria)


def _direction(criteria: CriteriaRevision, key: str) -> str:
    for criterion in criteria.criteria:
        if criterion.key == key:
            return criterion.direction
    return "lower_better"


def _sort_key(value: float | None, direction: str) -> tuple[int, float]:
    # Unknown sorts last so a priority order never rewards a missing number.
    if value is None:
        return (1, 0.0)
    return (0, value if direction == "lower_better" else -value)
