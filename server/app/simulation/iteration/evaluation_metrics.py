"""Descriptive iteration measures; this module never ranks or chooses revisions.

Objective measures describe what changed. Mechanical constraints flag a run
that is invalid or unauditable. Design judgment belongs to the researcher.
"""
from __future__ import annotations

from typing import Any

from .contracts import Criterion, CriteriaRevision


DEFAULT_CRITERIA = CriteriaRevision(
    id="criteria-default-v1",
    label="기본 비교 기준 (연구자 확인용 지표)",
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
    ],
)


def outcome_vector(metrics: dict[str, Any]) -> dict[str, float | None]:
    """Extract descriptive measures from one attempt's stored log."""
    requests = metrics.get("requests") or {}
    waits = metrics.get("waitMs") or {}
    institution = metrics.get("institutionBurden") or {}
    disclosure = metrics.get("disclosure") or {}
    transport = metrics.get("transport") or {}

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
    }


def per_actor_delta(before: dict[str, Any], after: dict[str, Any]) -> list[dict[str, Any]]:
    """Show person-level burden changes instead of hiding them in a total."""
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
        "beforeContacts": 0,
        "afterContacts": 0,
    }
    institution["deltaMinutes"] = round(
        institution["afterMinutes"] - institution["beforeMinutes"], 1)
    institution["deltaContacts"] = 0
    rows.append(institution)
    return rows


def violates_required(vector: dict[str, float | None],
                      criteria: CriteriaRevision) -> list[str]:
    """Return mechanical constraint failures; do not infer design quality."""
    violations = []
    for criterion in criteria.criteria:
        if not criterion.required:
            continue
        value = vector.get(criterion.key)
        if value is None:
            violations.append("%s 을(를) 확인할 수 없다" % criterion.label)
            continue
        if criterion.maxValue is not None and value > criterion.maxValue:
            violations.append("%s 이(가) 상한 %s 을(를) 넘었다 (%s)"
                              % (criterion.label, criterion.maxValue, value))
        if criterion.minValue is not None and value < criterion.minValue:
            violations.append("%s 이(가) 하한 %s 에 못 미친다 (%s)"
                              % (criterion.label, criterion.minValue, value))
    return violations

