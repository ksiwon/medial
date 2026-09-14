"""Mechanical boundary between a Quest/Task Change Set and MEDial execution.

Two whitelists and one blacklist. The whitelists say which Quest, Task, rule
field and engine binding exist; the blacklist (``FIXED_INPUT_PREFIXES``) names
the inputs that are fixed for the whole comparison, so that a rejection reads as
"this is not MEDial's to change" rather than as "unsupported field".
"""
from __future__ import annotations

from typing import Any

from ..contracts import ContactStrategy, PolicyParams
from .contracts import ChangeSet, ChangeSetValidation
from .llm import content_hash

SUPPORTED_QUESTS = frozenset({"quest:no-response-welfare-check", "quest:medical-transport"})
SUPPORTED_TASKS = frozenset({
    "task:contact-subject", "task:request-welfare-check", "task:arrange-transport",
    "task:institution-handoff", "task:notify-close",
})
SUPPORTED_RULE_FIELDS = frozenset({
    "completion_evidence", "escalation", "fallback", "task_flow", "assignment_order",
    "refusal_reassignment", "retry", "quiet_period", "workload_limit", "travel_limit",
    "explanation", "disclosure",
})
PARAM_BINDINGS = frozenset(PolicyParams.SUPPORTED)
SUPPORTED_BINDINGS = frozenset({"contactStrategy", *PARAM_BINDINGS})

#: Fixed case input. These are conditions of the world and of the people in it,
#: not things MEDial operates. The generic binding whitelist would already
#: reject them, but silently and with a misleading reason, so they are named:
#: a Change Set that reaches for one of these is not proposing a better service,
#: it is proposing that the problem stop happening.
FIXED_INPUT_PREFIXES = (
    "environment", "reachability", "scheduling", "variation",
    "village", "persona", "baseline", "routine", "deck", "scenario",
    "resource", "review", "evaluation",
)
FIXED_INPUT_REASON = (
    "{key}는 고정 사례 입력이다. 세계·주민·평가 조건을 바꾸면 MEDial이 나아진 것이 아니라 "
    "문제가 발생하지 않게 만든 것이므로 Change Set으로 편집할 수 없다. "
    "다른 가정을 시험하려면 새 EnvironmentRevision으로 별도 실험을 실행한다."
)


def _fixed_input(key: str) -> bool:
    head = key.split(".", 1)[0].split("[", 1)[0]
    return head.lower() in FIXED_INPUT_PREFIXES


def change_hash(change_set: ChangeSet) -> str:
    return content_hash([
        [change.scope.value, change.target.value, change.questId, change.taskIds,
         change.field, change.beforeRule, change.afterRule,
         [[binding.key, binding.before, binding.after]
          for binding in sorted(change.executionBindings, key=lambda item: item.key)]]
        for change in change_set.changes
    ])


def _current_value(policy: dict[str, Any], key: str) -> Any:
    if key == "contactStrategy":
        return policy.get("contactStrategy")
    return (policy.get("params") or {}).get(key)


def change_set_to_policy_changes(policy: dict[str, Any], change_set: ChangeSet) -> dict[str, Any]:
    """Translate the confirmed semantic source of truth at one engine boundary."""
    params = dict(policy.get("params") or {})
    changes: dict[str, Any] = {"params": params}
    for rule in change_set.changes:
        for binding in rule.executionBindings:
            if binding.key == "contactStrategy":
                changes["contactStrategy"] = binding.after
            else:
                changes["params"][binding.key] = binding.after
    return changes


def _validate_binding_value(key: str, value: Any) -> list[str]:
    if key == "contactStrategy":
        allowed = {item.value for item in ContactStrategy}
        return [] if value in allowed else [f"contactStrategy는 {sorted(allowed)} 중 하나여야 한다."]
    current = PolicyParams().model_dump()
    current[key] = value
    try:
        PolicyParams.model_validate(current)
    except Exception as exc:  # noqa: BLE001 - validation result is shown to the researcher
        return [f"실행 바인딩 {key} 값 검증 실패: {exc}"]
    return []


def _coherence(policy: dict[str, Any], change_set: ChangeSet) -> list[str]:
    merged = change_set_to_policy_changes(policy, change_set)
    errors: list[str] = []
    try:
        params = PolicyParams.model_validate(merged["params"])
    except Exception as exc:  # noqa: BLE001
        return [f"MEDial 실행 조건 검증 실패: {exc}"]
    strategy = merged.get("contactStrategy", policy.get("contactStrategy"))
    if strategy == ContactStrategy.head_first.value and not params.allowHeadContact:
        errors.append("이장 우선 Task 흐름에서는 이장 연락을 비활성화할 수 없다.")
    return errors


def validate_change_set(
    change_set: ChangeSet,
    *,
    policy: dict[str, Any],
    capabilities: tuple[str, ...],
    known_review_items: set[str] | None = None,
    world_truth_event_ids: set[str] | None = None,
    applied_change_hashes: set[str] | None = None,
) -> ChangeSet:
    unsupported = [item for item in change_set.requiredCapabilities if item not in capabilities]
    if unsupported:
        return change_set.model_copy(update={
            "validationStatus": ChangeSetValidation.requires_implementation,
            "validationErrors": [
                "현재 엔진이 지원하지 않는 Task 기능이 필요하다: " + ", ".join(unsupported)
            ],
            "confirmationStatus": "not_run",
        })

    if not change_set.changes:
        return change_set.model_copy(update={
            "validationStatus": ChangeSetValidation.requires_implementation,
            "validationErrors": ["구조화된 Quest/Task 변경이 없다."],
            "confirmationStatus": "not_run",
        })

    errors: list[str] = []
    if change_set.baseRevisionId != policy.get("id"):
        errors.append("Change Set의 기준 revision이 현재 MEDial revision과 다르다.")
    if change_set.author != "researcher_hypothesis" and not change_set.reviewItemRefs:
        errors.append("어떤 주민 평가를 근거로 한 변경인지 연결되어 있지 않다.")
    if known_review_items is not None:
        missing = [ref for ref in change_set.reviewItemRefs if ref not in known_review_items]
        if missing:
            errors.append(f"존재하지 않는 주민 평가 항목을 참조한다: {missing[:4]}")
    leaked = sorted(set(change_set.eventRefs) & set(world_truth_event_ids or set()))
    if leaked:
        errors.append(f"주민이 경험하지 않은 세계 진실 사건을 근거로 삼았다: {leaked[:4]}")

    seen_bindings: set[str] = set()
    executable_bindings = 0
    for change in change_set.changes:
        if change.questId not in SUPPORTED_QUESTS:
            errors.append(f"지원하지 않는 Quest다: {change.questId}")
        unknown_tasks = [task for task in change.taskIds if task not in SUPPORTED_TASKS]
        if unknown_tasks:
            errors.append(f"지원하지 않는 Task다: {unknown_tasks}")
        if change.scope.value == "task" and not change.taskIds:
            errors.append("Task 변경에는 영향을 받는 Task가 하나 이상 필요하다.")
        if _fixed_input(change.field):
            errors.append(FIXED_INPUT_REASON.format(key=change.field))
        elif change.field not in SUPPORTED_RULE_FIELDS:
            errors.append(f"지원하지 않는 Quest/Task 필드다: {change.field}")
        if not change.beforeRule.strip() or not change.afterRule.strip():
            errors.append("사람이 읽을 수 있는 변경 전·후 규칙이 모두 필요하다.")
        elif change.beforeRule.strip() == change.afterRule.strip():
            errors.append("변경 전과 후의 Quest/Task 규칙이 같다.")
        for binding in change.executionBindings:
            executable_bindings += 1
            if _fixed_input(binding.key):
                errors.append(FIXED_INPUT_REASON.format(key=binding.key))
                continue
            if binding.key not in SUPPORTED_BINDINGS:
                errors.append(f"지원하지 않는 내부 실행 바인딩이다: {binding.key}")
                continue
            if binding.key in seen_bindings:
                errors.append(f"같은 실행 바인딩을 두 번 변경한다: {binding.key}")
            seen_bindings.add(binding.key)
            actual = _current_value(policy, binding.key)
            if binding.before != actual:
                errors.append(
                    f"{binding.key}의 변경 전 값이 현재 값과 다르다 "
                    f"(Change Set: {binding.before!r}, 현재: {actual!r})."
                )
            if binding.before == binding.after:
                errors.append(f"{binding.key} 실행 바인딩 값이 바뀌지 않는다.")
            errors.extend(_validate_binding_value(binding.key, binding.after))

    if executable_bindings == 0:
        return change_set.model_copy(update={
            "validationStatus": ChangeSetValidation.requires_implementation,
            "validationErrors": ["의미 있는 규칙은 있으나 현재 엔진에 연결된 실행 바인딩이 없다."],
            "confirmationStatus": "not_run",
        })
    if not errors:
        errors.extend(_coherence(policy, change_set))

    digest = change_hash(change_set)
    if digest in (applied_change_hashes or set()):
        errors.append("이미 실행한 것과 같은 Change Set이다.")
    return change_set.model_copy(update={
        "validationStatus": (ChangeSetValidation.rejected if errors else ChangeSetValidation.valid),
        "validationErrors": errors,
        "changeHash": digest,
    })
