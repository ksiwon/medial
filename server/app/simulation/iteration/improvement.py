"""Draft evidence-linked Quest/Task Change Sets from resident evaluations."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from ..contracts import HEALTH_STAFF
from . import semantic_rules
from .services import get_adapter
from .contracts import (
    ChangeSet,
    ImprovementTarget,
    IssueGroup,
    ReviewDimensionKey as D,
    ReviewSynthesis,
    RuleChange,
    materialize_change,
)
from .validation import active_quests_for, change_hash

#: Kept as a name because callers and tests import it. The list itself now
#: belongs to the service adapter (26번 C02), so the core has one place to ask
#: rather than a constant per module.
SUPPORTED_CAPABILITIES = get_adapter().capabilities()


def signals(objective: dict[str, Any], params: dict[str, Any] | None = None) -> dict[str, bool]:
    attempts = list(objective.values())

    def total(*path: str) -> float:
        result = 0.0
        for row in attempts:
            node: Any = row
            for key in path:
                node = (node or {}).get(key) if isinstance(node, dict) else None
            if isinstance(node, (int, float)):
                result += float(node)
        return result

    transport_needs = total("transport", "needsRaised")
    disclosure_fields = sum(
        int((value or {}).get("fieldCount") or 0)
        for row in attempts for value in (row.get("disclosure") or {}).values()
    )
    contacts = [
        int((row.get("residentBurden") or {}).get(actor, {}).get("contactsReceived") or 0)
        for row in attempts for actor in (row.get("residentBurden") or {})
    ]
    busiest = max(contacts, default=0)
    cap = int((params or {}).get("helperContactCap") or 0)
    return {
        "contact": total("contacts", "attempts") > 0,
        "transport": transport_needs > 0,
        "rideShortfall": total("transport", "ridesCompleted") < transport_needs,
        "rideConflicts": total("transport", "conflictsDetected") > 0,
        "disclosure": disclosure_fields > 0,
        "capBinding": bool(cap) and busiest >= cap,
        "repeatContacts": busiest >= 2,
    }


@dataclass(frozen=True)
class Mechanism:
    """One rule-based draft: a rule type and how to move its values.

    ``after`` reads the current values of the rule and returns the values to
    try, or ``None`` when there is nothing legitimate to propose (the value is
    already at its bound, or the rule is not what this dimension is about).
    The sentences and bindings are *not* here: they come from
    :mod:`semantic_rules` like every other Change Set's.
    """

    key: str
    dimension: D
    rule_type: str
    after: Callable[[dict[str, Any], dict[str, Any]], dict[str, Any] | None]
    mechanism: str
    expected: tuple[str, ...]
    regressions: tuple[str, ...]
    requires: tuple[str, ...] = ()
    priority: int = 50

    @property
    def target(self) -> ImprovementTarget:
        return ImprovementTarget(semantic_rules.spec(self.rule_type).target)


def _escalation(cur, policy):
    current = cur.get("afterMinutes")
    if current is None:
        return {"afterMinutes": 90}
    if current > 45:
        return {"afterMinutes": max(45, current // 2)}
    return None


def _retry(cur, policy):
    return None if cur["count"] >= 3 else {**cur, "count": cur["count"] + 1}


def _spread_load(cur, policy):
    return None if cur["perDay"] <= 1 else {"perDay": cur["perDay"] - 1}


def _quiet(cur, policy):
    interval = int((policy.get("params") or {}).get("retryIntervalMin") or 40)
    target = min(240, max(interval + 20, cur["minutes"] + 30))
    return None if cur["minutes"] >= target else {"minutes": target}


def _disclosure(cur, policy):
    return {"level": "minimal"} if cur["level"] == "named" else None


def _head_route(cur, policy):
    if cur["strategy"] != "retry_then_clinic":
        return None
    return {"strategy": "head_first", "allowHeadContact": True}


def _institution_route(cur, policy):
    if cur["strategy"] != "head_first":
        return None
    return {**cur, "strategy": "retry_then_clinic"}


def _detour_tighter(cur, policy):
    current = cur["maxDetourMinutes"]
    return None if current <= 2 else {"maxDetourMinutes": max(2, current // 2)}


def _detour_looser(cur, policy):
    current = cur["maxDetourMinutes"]
    return None if current >= 60 else {"maxDetourMinutes": min(60, max(10, current * 2))}


def _ride_order(cur, policy):
    return {"order": "closest_first" if cur["order"] == "kin_first" else "kin_first"}


MECHANISMS = (
    Mechanism("escalation", D.help_resolution, "institution_deadline", _escalation,
              "미해결 Quest가 막다른 길에서 종료되지 않도록 인계 기한을 둔다.",
              ("미해결 대기에 상한이 생긴다",), ("기관 업무와 대기열이 늘어날 수 있다",),
              ("contact",), 10),
    Mechanism("institution_route", D.time_labour, "contact_order", _institution_route,
              "이웃의 시간을 먼저 사용하지 않도록 연락 순서를 바꾼다.",
              ("이웃에게 전가되는 시간이 줄어든다",),
              ("기관 업무와 당사자 대기가 늘어날 수 있다",), ("contact",), 12),
    Mechanism("spread_load", D.time_labour, "helper_daily_cap", _spread_load,
              "도움 요청이 한 사람에게 몰리는 것을 제한한다.",
              ("한 사람에게 몰리는 부담이 줄어든다",), ("미해결 또는 기관 인계가 늘 수 있다",),
              ("contact", "capBinding"), 15),
    Mechanism("quiet", D.time_labour, "quiet_period", _quiet,
              "반복 연락 사이의 최소 간격을 늘린다.",
              ("연락 방해가 줄어든다",), ("안부 확인이 늦어질 수 있다",),
              ("contact", "repeatContacts"), 25),
    Mechanism("retry", D.help_resolution, "retry_before_help", _retry,
              "본인 확인으로 Quest를 닫을 기회를 한 번 늘린다.",
              ("본인 응답으로 해결될 수 있다",), ("연락 방해와 대기가 늘 수 있다",),
              ("contact",), 30),
    Mechanism("disclosure", D.disclosure, "disclosure_scope", _disclosure,
              "Task 수행에 필요하지 않은 정보 공개를 제거한다.",
              ("공개되는 정보 항목이 줄어든다",), ("기관의 추가 확인 업무가 늘 수 있다",),
              ("disclosure",), 35),
    Mechanism("head_route", D.help_resolution, "contact_order", _head_route,
              "기관으로 넘기기 전에 마을 안 확인 Task를 사용한다.",
              ("기관 인계 전에 해결될 수 있다",), ("이장 부담과 공개 범위가 늘 수 있다",),
              ("contact",), 40),
    Mechanism("detour_tighter", D.time_labour, "ride_detour_limit", _detour_tighter,
              "운전자의 기존 일과에 생기는 추가 이동을 제한한다.",
              ("운전자 추가 이동이 줄어든다",), ("이동 지원 후보가 줄 수 있다",),
              ("transport", "rideConflicts"), 18),
    Mechanism("detour_looser", D.help_resolution, "ride_detour_limit", _detour_looser,
              "우회 상한 때문에 배정되지 못한 이동 요청의 후보를 넓힌다.",
              ("이동 지원이 성사될 수 있다",), ("운전자 추가 이동이 늘 수 있다",),
              ("transport", "rideShortfall"), 28),
    Mechanism("ride_order", D.choice_refusal, "ride_candidate_order", _ride_order,
              "누구에게 먼저 부탁할지를 다른 근거로 정렬한다.",
              ("먼저 부탁받는 사람이 바뀐다",), ("선호 또는 우회 시간이 나빠질 수 있다",),
              ("transport",), 45),
)

UNSUPPORTED = (
    (D.choice_refusal, ImprovementTarget.task_assignment_refusal, "사전 가능 시간 확인",
     "부탁하기 전에 가능한 시간을 먼저 묻는다.", "transport.availability_probe",
     "quest:medical-transport", "task:arrange-transport", "assignment_order"),
    (D.understandability, ImprovementTarget.explanation_disclosure, "종료 결과 통지",
     "Quest가 어떻게 끝났는지 당사자에게 알린다.", "notify.closure",
     "quest:no-response-welfare-check", "task:notify-close", "explanation"),
)


class RuleImprovementAdapter:
    name = "rule"

    def propose(self, *, synthesis: ReviewSynthesis, policy: dict[str, Any],
                capabilities: list[str], criteria: list[dict[str, Any]], core_item: str,
                max_change_sets: int, session_id: str, generation_index: int,
                created_at: str, id_prefix: str,
                already_tried: list[str],
                active_decks: list[str] | None = None) -> tuple[list[ChangeSet], str | None]:
        params = dict(policy.get("params") or {})
        active = signals(synthesis.objectiveMetrics, params)
        by_dimension: dict[str, list[IssueGroup]] = {}
        for issue in synthesis.issueGroups:
            by_dimension.setdefault(issue.dimension.value, []).append(issue)
        severity = {"blocking": 0, "significant": 1, "minor": 2, "unknown": 3}
        ordered = sorted(
            (item for item in MECHANISMS if item.dimension.value in by_dimension
             and all(active.get(flag) for flag in item.requires)),
            key=lambda item: (severity[min(
                (issue.severity for issue in by_dimension[item.dimension.value]),
                key=lambda value: severity[value])], item.priority),
        )
        result: list[ChangeSet] = []
        seen_targets: set[str] = set()
        active_quests = (active_quests_for(active_decks)
                         if active_decks is not None else None)
        for mechanism in ordered:
            if len(result) >= max_change_sets:
                break
            if mechanism.target.value in seen_targets:
                continue
            spec = semantic_rules.spec(mechanism.rule_type)
            if active_quests is not None and spec.quest_id not in active_quests:
                continue
            issue = min(by_dimension[mechanism.dimension.value], key=lambda row: severity[row.severity])
            current = semantic_rules.read_values(mechanism.rule_type, policy).model_dump(mode="json")
            after = mechanism.after(current, policy)
            if not after or after == current:
                continue
            semantic = semantic_rules.build_change(mechanism.rule_type, policy, after)
            rule = materialize_change(semantic)
            change_set = ChangeSet(
                id=f"{id_prefix}-{len(result) + 1}", sessionId=session_id,
                generationIndex=generation_index, baseRevisionId=policy["id"],
                label=rule.afterRule, reviewItemRefs=issue.reviewItemRefs[:8],
                issueRefs=[issue.id], eventRefs=issue.eventRefs,
                mechanism=mechanism.mechanism, changes=[rule],
                expectedEffects=list(mechanism.expected),
                possibleRegressions=list(mechanism.regressions),
                unknowns=list(issue.unknowns), assumptionRefs=list(issue.alternativeExplanations),
                affectedActors=sorted(set(issue.affectedActors) | set(issue.dissentingActors)
                                      | ({HEALTH_STAFF} if "기관" in " ".join(mechanism.regressions) else set())),
                watchNext=list(issue.objectiveMetricRefs) + [f"{mechanism.dimension.value} 평가 변화"],
                author="rule_draft", adapter="rule", createdAt=created_at,
            )
            digest = change_hash(change_set)
            if digest in set(already_tried):
                continue
            result.append(change_set.model_copy(update={"changeHash": digest}))
            seen_targets.add(mechanism.target.value)

        for dimension, target, label, text, capability, quest_id, task_id, field in UNSUPPORTED:
            if len(result) >= max_change_sets or dimension.value not in by_dimension:
                continue
            issue = by_dimension[dimension.value][0]
            result.append(ChangeSet(
                id=f"{id_prefix}-unsupported-{len(result) + 1}", sessionId=session_id,
                generationIndex=generation_index, baseRevisionId=policy["id"], label=label,
                reviewItemRefs=issue.reviewItemRefs[:8], issueRefs=[issue.id],
                eventRefs=issue.eventRefs, mechanism=text,
                changes=[RuleChange(scope="task", target=target, questId=quest_id,
                                    taskIds=[task_id], field=field,
                                    beforeRule="현재 Task 흐름에는 이 단계가 없다.", afterRule=text)],
                expectedEffects=["구현 후 주민 평가로 효과를 확인해야 한다"],
                possibleRegressions=["아직 실행할 수 없어 효과와 부담을 알 수 없다"],
                requiredCapabilities=[capability], author="rule_draft", adapter="rule",
                createdAt=created_at, validationStatus="requires_implementation",
                confirmationStatus="not_run",
                validationErrors=["현재 엔진이 지원하지 않는 Task다."],
            ))
        if result:
            return result, None
        reason = ("이번 주민 평가에서 지원되는 Quest/Task 변경을 찾지 못했다."
                  if synthesis.issueGroups else "이번 주민 평가에 개선할 문제가 기록되지 않았다.")
        return [], reason
