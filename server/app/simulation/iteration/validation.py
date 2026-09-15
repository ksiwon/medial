"""Mechanical boundary between a Change Set and MEDial execution.

The order of checks is the order 26번 C03 fixes, and each one names the thing
it refuses so the researcher reads *why* rather than "invalid":

1. base revision matches the current one;
2. nothing fixed for the comparison is being edited (``FIXED_INPUT_PREFIXES``);
3. evidence references exist and cite nothing the residents could not see;
4. the rule type is supported and applicable to the case the session runs;
5. values are typed, in range and coherent with each other;
6. the change actually changes what will run;
7. the same semantic change has not already been executed.

What this module does *not* do: judge whether the change is a good idea. That
is the researcher's, and it happens at confirmation with a written reason.

Since 2026-09-15 a Change Set's sentences and bindings are derived from its
typed ``semantic`` change (:mod:`semantic_rules`). A change whose stored
sentence or bindings disagree with its semantic values is refused outright -
there is no longer a way to save "재연락 2회" in words and ``retryCount: 1``
in the run.
"""
from __future__ import annotations

from typing import Any

from ..contracts import PolicyParams
from . import semantic_rules
from .contracts import ChangeSet, ChangeSetValidation, RuleChange, materialize_change
from .llm import content_hash

SUPPORTED_QUESTS = frozenset({semantic_rules.QUEST_WELFARE, semantic_rules.QUEST_TRANSPORT})
SUPPORTED_TASKS = frozenset({
    "task:contact-subject", "task:request-welfare-check", "task:arrange-transport",
    "task:institution-handoff", "task:notify-close",
})
SUPPORTED_RULE_FIELDS = frozenset({
    "completion_evidence", "escalation", "fallback", "task_flow", "assignment_order",
    "refusal_reassignment", "retry", "quiet_period", "workload_limit", "travel_limit",
    "explanation", "disclosure",
})
SUPPORTED_RULE_TYPES = frozenset(semantic_rules.SPECS)
PARAM_BINDINGS = frozenset(PolicyParams.SUPPORTED)
SUPPORTED_BINDINGS = frozenset({"contactStrategy", *PARAM_BINDINGS})

#: Fixed case input. These are conditions of the world and of the people in it,
#: not things MEDial operates. A Change Set that reaches for one of these is not
#: proposing a better service, it is proposing that the problem stop happening.
FIXED_INPUT_PREFIXES = (
    "environment", "reachability", "scheduling", "variation",
    "model", "modelpolicy", "prompt", "temperature",
    "relation", "relations", "edge", "interaction",
    "village", "persona", "baseline", "routine", "deck", "scenario",
    "resource", "review", "evaluation", "ledger", "case",
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
    """Identity of what will run.

    Semantic changes hash their typed values only; the label, the rationale and
    the derived sentences are not part of it, so a draft that only rewrites its
    explanation is not a new execution. Legacy changes without ``semantic``
    keep the old sentence+binding hash so stored history compares to itself.
    """
    semantic = [c.semantic for c in change_set.changes if c.semantic is not None]
    if semantic and len(semantic) == len(change_set.changes):
        return semantic_rules.semantic_hash(semantic)
    return content_hash([
        [change.scope.value, change.target.value, change.questId, change.taskIds,
         change.field, change.beforeRule, change.afterRule,
         [[binding.key, binding.before, binding.after]
          for binding in sorted(change.executionBindings, key=lambda item: item.key)]]
        for change in change_set.changes
    ])


def change_set_to_policy_changes(policy: dict[str, Any], change_set: ChangeSet) -> dict[str, Any]:
    """Translate the confirmed semantic source of truth at one engine boundary.

    Compiled from the semantic change when there is one, so the run can only
    ever execute what the sentence says. Legacy bindings are used only for
    Change Sets stored before the semantic form existed.
    """
    params = dict(policy.get("params") or {})
    changes: dict[str, Any] = {"params": params}
    for rule in change_set.changes:
        bindings = (semantic_rules.compile_bindings(rule.semantic)
                    if rule.semantic is not None
                    else [b.model_dump() for b in rule.executionBindings])
        for binding in bindings:
            if binding["key"] == "contactStrategy":
                changes["contactStrategy"] = binding["after"]
            else:
                changes["params"][binding["key"]] = binding["after"]
    return changes


def active_quests_for(deck_ids: list[str]) -> set[str]:
    return {semantic_rules.DECK_QUESTS[d] for d in deck_ids if d in semantic_rules.DECK_QUESTS}


def _semantic_errors(change: RuleChange, policy: dict[str, Any],
                     active_quests: set[str] | None) -> list[str]:
    """Steps 4-6 for one typed change, plus the derivation check."""
    semantic = change.semantic
    assert semantic is not None
    errors: list[str] = []
    if semantic.ruleType not in SUPPORTED_RULE_TYPES:
        return ["지원하지 않는 규칙 종류다: %s" % semantic.ruleType]
    s = semantic_rules.spec(semantic.ruleType)
    if active_quests is not None and s.quest_id not in active_quests:
        errors.append(
            "'%s' 규칙은 %s에서만 실행된다. 이 사례에서는 적용되는 상황이 없어 "
            "효과 없음이 아니라 적용 불가다." % (s.label, s.quest_id))
    current = semantic_rules.read_values(semantic.ruleType, policy)
    if semantic.before.model_dump(mode="json") != current.model_dump(mode="json"):
        errors.append(
            "'%s'의 변경 전 값이 현재 revision과 다르다 (Change Set: %s, 현재: %s). "
            "오래된 기준으로 쓴 변경이다."
            % (s.label, semantic.before.model_dump(mode="json"),
               current.model_dump(mode="json")))
    if semantic.before.model_dump(mode="json") == semantic.after.model_dump(mode="json"):
        errors.append("'%s'의 변경 전과 후 값이 같다. 실행되는 것이 바뀌지 않는다." % s.label)
    # Derivation check: what is stored must be what the semantic change says.
    derived = materialize_change(semantic)
    if (derived.beforeRule, derived.afterRule) != (change.beforeRule, change.afterRule):
        errors.append("'%s'의 저장된 문장이 규칙 값에서 만든 문장과 다르다. 문장은 직접 편집할 수 없다."
                      % s.label)
    stored = sorted((b.key, b.before, b.after) for b in change.executionBindings)
    compiled = sorted((b.key, b.before, b.after) for b in derived.executionBindings)
    if stored != compiled:
        errors.append("'%s'의 저장된 실행 바인딩이 규칙 값에서 만든 것과 다르다." % s.label)
    if (derived.questId, list(derived.taskIds), derived.field) != (
            change.questId, list(change.taskIds), change.field):
        errors.append("'%s'의 Quest/Task 경로가 규칙 종류와 맞지 않는다." % s.label)
    return errors


def validate_change_set(
    change_set: ChangeSet,
    *,
    policy: dict[str, Any],
    capabilities: tuple[str, ...],
    known_review_items: set[str] | None = None,
    world_truth_event_ids: set[str] | None = None,
    applied_change_hashes: set[str] | None = None,
    active_decks: list[str] | None = None,
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
    # 1. base revision
    if change_set.baseRevisionId != policy.get("id"):
        errors.append("Change Set의 기준 revision이 현재 MEDial revision과 다르다.")
    # 3. evidence
    if change_set.author != "researcher_hypothesis" and not change_set.reviewItemRefs:
        errors.append("어떤 주민 평가를 근거로 한 변경인지 연결되어 있지 않다.")
    if known_review_items is not None:
        missing = [ref for ref in change_set.reviewItemRefs if ref not in known_review_items]
        if missing:
            errors.append(f"존재하지 않는 주민 평가 항목을 참조한다: {missing[:4]}")
    leaked = sorted(set(change_set.eventRefs) & set(world_truth_event_ids or set()))
    if leaked:
        errors.append(f"주민이 경험하지 않은 세계 진실 사건을 근거로 삼았다: {leaked[:4]}")

    active_quests = active_quests_for(active_decks) if active_decks is not None else None
    seen_rules: set[str] = set()
    executable = 0
    for change in change_set.changes:
        # 2. fixed inputs, named as such
        if _fixed_input(change.field):
            errors.append(FIXED_INPUT_REASON.format(key=change.field))
        for binding in change.executionBindings:
            if _fixed_input(binding.key):
                errors.append(FIXED_INPUT_REASON.format(key=binding.key))
        if change.semantic is None:
            # A change without a typed rule cannot be executed by this build. It
            # is history (stored before 2026-09-15) or a model output that named
            # a rule this engine does not have.
            errors.append("규칙 종류(ruleType)가 없는 변경은 실행할 수 없다. 지원 규칙 목록에서 "
                          "다시 작성해야 한다.")
            continue
        if change.semantic.ruleType in seen_rules:
            errors.append("같은 규칙을 한 Change Set에서 두 번 바꾼다: %s" % change.semantic.ruleType)
        seen_rules.add(change.semantic.ruleType)
        errors.extend(_semantic_errors(change, policy, active_quests))
        executable += len(semantic_rules.compile_bindings(change.semantic))

    if not errors and executable == 0:
        return change_set.model_copy(update={
            "validationStatus": ChangeSetValidation.requires_implementation,
            "validationErrors": ["의미 있는 규칙은 있으나 현재 엔진에 연결된 실행 바인딩이 없다."],
            "confirmationStatus": "not_run",
        })
    # 5b. coherence across rules on the resulting revision
    if not errors:
        errors.extend(semantic_rules.coherence_errors(
            [c.semantic for c in change_set.changes if c.semantic is not None], policy))
        merged = change_set_to_policy_changes(policy, change_set)
        try:
            PolicyParams.model_validate(merged["params"])
        except Exception as exc:  # noqa: BLE001 - shown to the researcher
            errors.append(f"MEDial 실행 조건 검증 실패: {exc}")

    # 7. already executed
    digest = change_hash(change_set)
    if digest in (applied_change_hashes or set()):
        errors.append("이미 실행한 것과 같은 Change Set이다.")
    return change_set.model_copy(update={
        "validationStatus": (ChangeSetValidation.rejected if errors else ChangeSetValidation.valid),
        "validationErrors": errors,
        "changeHash": digest,
    })
