"""Draft evidence-linked Quest/Task Change Sets from resident evaluations."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from ..contracts import HEALTH_STAFF
from .contracts import (
    ChangeScope,
    ChangeSet,
    ExecutionBinding,
    ImprovementTarget,
    IssueGroup,
    ReviewDimensionKey as D,
    ReviewSynthesis,
    RuleChange,
)
from .validation import change_hash

SUPPORTED_CAPABILITIES = (
    "contact.retry", "contact.quiet_window", "contact.helper_cap",
    "disclosure.level", "escalation.deadline", "strategy.head_first",
    "strategy.retry_then_clinic", "transport.candidate_order",
    "transport.detour_limit",
)


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


def _binding(key: str, before: Any, after: Any) -> ExecutionBinding:
    return ExecutionBinding(key=key, before=before, after=after)


@dataclass(frozen=True)
class Mechanism:
    key: str
    dimension: D
    target: ImprovementTarget
    scope: ChangeScope
    quest_id: str
    task_ids: tuple[str, ...]
    field: str
    before_rule: Callable[[dict[str, Any], dict[str, Any]], str]
    after_rule: Callable[[dict[str, Any], dict[str, Any]], str]
    bindings: Callable[[dict[str, Any], dict[str, Any]], list[ExecutionBinding] | None]
    mechanism: str
    expected: tuple[str, ...]
    regressions: tuple[str, ...]
    requires: tuple[str, ...] = ()
    priority: int = 50


def _escalation(params, policy):
    current = params.get("escalateToInstitutionAfterMin")
    if current is None:
        return [_binding("escalateToInstitutionAfterMin", None, 90)]
    if current > 45:
        return [_binding("escalateToInstitutionAfterMin", current, max(45, current // 2))]
    return None


def _retry(params, policy):
    current = int(params.get("retryCount") or 0)
    return None if current >= 3 else [_binding("retryCount", current, current + 1)]


def _spread_load(params, policy):
    current = int(params.get("helperContactCap") or 0)
    return None if current <= 1 else [_binding("helperContactCap", current, current - 1)]


def _quiet(params, policy):
    current = int(params.get("quietWindowMin") or 0)
    interval = int(params.get("retryIntervalMin") or 40)
    target = min(240, max(interval + 20, current + 30))
    return None if current >= target else [_binding("quietWindowMin", current, target)]


def _disclosure(params, policy):
    return ([_binding("disclosure", "named", "minimal")]
            if params.get("disclosure") == "named" else None)


def _head_route(params, policy):
    if policy.get("contactStrategy") != "retry_then_clinic":
        return None
    result = [_binding("contactStrategy", "retry_then_clinic", "head_first")]
    if not params.get("allowHeadContact"):
        result.append(_binding("allowHeadContact", False, True))
    return result


def _institution_route(params, policy):
    if policy.get("contactStrategy") != "head_first":
        return None
    retries = int(params.get("retryCount") or 0)
    return [_binding("contactStrategy", "head_first", "retry_then_clinic"),
            _binding("retryCount", retries, max(1, retries + 1))]


def _detour_tighter(params, policy):
    current = int(params.get("maxRideDetourMin") or 0)
    return None if current <= 2 else [_binding("maxRideDetourMin", current, max(2, current // 2))]


def _detour_looser(params, policy):
    current = int(params.get("maxRideDetourMin") or 0)
    return None if current >= 60 else [_binding("maxRideDetourMin", current, min(60, max(10, current * 2)))]


def _ride_order(params, policy):
    current = params.get("rideCandidateOrder")
    return [_binding("rideCandidateOrder", current,
                     "closest_first" if current == "kin_first" else "kin_first")]


def _same(text: str):
    return lambda params, policy: text


MECHANISMS = (
    Mechanism("escalation", D.help_resolution, ImprovementTarget.quest_completion_escalation,
              ChangeScope.quest, "quest:no-response-welfare-check", ("task:institution-handoff",),
              "escalation", lambda p, _: "미해결 상태에 기관 인계 기한이 없다." if p.get("escalateToInstitutionAfterMin") is None else f"접수 {p['escalateToInstitutionAfterMin']}분 뒤 기관으로 인계한다.",
              lambda p, _: "미해결 상태면 늦어도 정해진 기한에 기관으로 인계한다.", _escalation,
              "미해결 Quest가 막다른 길에서 종료되지 않도록 인계 기한을 둔다.",
              ("미해결 대기에 상한이 생긴다",), ("기관 업무와 대기열이 늘어날 수 있다",), ("contact",), 10),
    Mechanism("institution_route", D.time_labour, ImprovementTarget.task_composition_flow,
              ChangeScope.quest, "quest:no-response-welfare-check",
              ("task:contact-subject", "task:request-welfare-check", "task:institution-handoff"),
              "task_flow", _same("이웃 확인을 먼저 요청한다."),
              _same("본인에게 다시 연락한 뒤 해결되지 않으면 기관에 인계한다."), _institution_route,
              "이웃의 시간을 먼저 사용하지 않도록 Task 흐름을 바꾼다.",
              ("이웃에게 전가되는 시간이 줄어든다",),
              ("기관 업무와 당사자 대기가 늘어날 수 있다",), ("contact",), 12),
    Mechanism("spread_load", D.time_labour, ImprovementTarget.task_assignment_refusal,
              ChangeScope.task, "quest:no-response-welfare-check", ("task:request-welfare-check",),
              "workload_limit", lambda p, _: f"한 사람이 하루 최대 {p.get('helperContactCap')}건의 요청을 받는다.",
              _same("같은 사람에게 반복 배정되지 않도록 요청 상한을 낮춘다."), _spread_load,
              "도움 요청이 한 사람에게 몰리는 것을 제한한다.",
              ("한 사람에게 몰리는 부담이 줄어든다",), ("미해결 또는 기관 인계가 늘 수 있다",),
              ("contact", "capBinding"), 15),
    Mechanism("quiet", D.time_labour, ImprovementTarget.timing_burden,
              ChangeScope.task, "quest:no-response-welfare-check", ("task:contact-subject",),
              "quiet_period", lambda p, _: f"반복 연락 최소 간격은 {p.get('quietWindowMin', 0)}분이다.",
              _same("같은 사람에게 짧은 간격으로 다시 연락하지 않는다."), _quiet,
              "반복 연락 사이의 최소 간격을 늘린다.",
              ("연락 방해가 줄어든다",), ("안부 확인이 늦어질 수 있다",),
              ("contact", "repeatContacts"), 25),
    Mechanism("retry", D.help_resolution, ImprovementTarget.timing_burden,
              ChangeScope.task, "quest:no-response-welfare-check", ("task:contact-subject",),
              "retry", lambda p, _: f"본인에게 {p.get('retryCount', 0)}회 재연락한다.",
              _same("다른 시간대에 본인에게 한 번 더 연락한다."), _retry,
              "본인 확인으로 Quest를 닫을 기회를 한 번 늘린다.",
              ("본인 응답으로 해결될 수 있다",), ("연락 방해와 대기가 늘 수 있다",), ("contact",), 30),
    Mechanism("disclosure", D.disclosure, ImprovementTarget.explanation_disclosure,
              ChangeScope.task, "quest:no-response-welfare-check",
              ("task:request-welfare-check", "task:institution-handoff"), "disclosure",
              _same("연락 시각과 공개 동의된 일과를 함께 전달한다."),
              _same("제3자에게는 응답이 없었다는 사실만 전달한다."), _disclosure,
              "Task 수행에 필요하지 않은 정보 공개를 제거한다.",
              ("공개되는 정보 항목이 줄어든다",), ("기관의 추가 확인 업무가 늘 수 있다",),
              ("disclosure",), 35),
    Mechanism("head_route", D.help_resolution, ImprovementTarget.task_composition_flow,
              ChangeScope.quest, "quest:no-response-welfare-check",
              ("task:contact-subject", "task:request-welfare-check", "task:institution-handoff"),
              "task_flow", _same("본인 재연락 뒤 기관으로 인계한다."),
              _same("마을 안의 이장 확인을 먼저 요청하고 실패하면 기관에 인계한다."), _head_route,
              "기관으로 넘기기 전에 마을 안 확인 Task를 사용한다.",
              ("기관 인계 전에 해결될 수 있다",), ("이장 부담과 공개 범위가 늘 수 있다",),
              ("contact",), 40),
    Mechanism("detour_tighter", D.time_labour, ImprovementTarget.timing_burden,
              ChangeScope.task, "quest:medical-transport", ("task:arrange-transport",),
              "travel_limit", lambda p, _: f"운전자에게 최대 {p.get('maxRideDetourMin')}분 우회를 요청한다.",
              _same("운전자에게 요청할 수 있는 추가 우회 시간을 줄인다."), _detour_tighter,
              "운전자의 기존 일과에 생기는 추가 이동을 제한한다.",
              ("운전자 추가 이동이 줄어든다",), ("이동 지원 후보가 줄 수 있다",),
              ("transport", "rideConflicts"), 18),
    Mechanism("detour_looser", D.help_resolution, ImprovementTarget.task_assignment_refusal,
              ChangeScope.task, "quest:medical-transport", ("task:arrange-transport",),
              "travel_limit", lambda p, _: f"최대 허용 우회는 {p.get('maxRideDetourMin')}분이다.",
              _same("미해결일 때 허용 우회를 늘려 가능한 운전자 후보를 넓힌다."), _detour_looser,
              "우회 상한 때문에 배정되지 못한 이동 요청의 후보를 넓힌다.",
              ("이동 지원이 성사될 수 있다",), ("운전자 추가 이동이 늘 수 있다",),
              ("transport", "rideShortfall"), 28),
    Mechanism("ride_order", D.choice_refusal, ImprovementTarget.task_assignment_refusal,
              ChangeScope.task, "quest:medical-transport", ("task:arrange-transport",),
              "assignment_order", _same("현재 기준에 따라 운전자 후보를 순서대로 묻는다."),
              _same("관계 우선과 동선 우선 중 반대 순서를 시험한다."), _ride_order,
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
                already_tried: list[str]) -> tuple[list[ChangeSet], str | None]:
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
        for mechanism in ordered:
            if len(result) >= max_change_sets:
                break
            if mechanism.target.value in seen_targets:
                continue
            issue = min(by_dimension[mechanism.dimension.value], key=lambda row: severity[row.severity])
            bindings = mechanism.bindings(params, policy)
            if not bindings:
                continue
            rule = RuleChange(
                scope=mechanism.scope, target=mechanism.target, questId=mechanism.quest_id,
                taskIds=list(mechanism.task_ids), field=mechanism.field,
                beforeRule=mechanism.before_rule(params, policy),
                afterRule=mechanism.after_rule(params, policy), executionBindings=bindings,
            )
            change_set = ChangeSet(
                id=f"{id_prefix}-{len(result) + 1}", sessionId=session_id,
                generationIndex=generation_index, baseRevisionId=policy["id"],
                label=mechanism.after_rule(params, policy), reviewItemRefs=issue.reviewItemRefs[:8],
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
