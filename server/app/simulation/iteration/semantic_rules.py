"""One semantic rule, one source of truth (26번 C03, F01).

Until 2026-09-15 a Change Set carried three independently editable things: a
human-readable ``afterRule`` sentence, a list of ``executionBindings`` and, for
the researcher's edits, a free-text box for each. The server checked that the
bindings were typed and current; it could not check that the sentence *meant*
the same thing. "재연락 2회" in the sentence and ``retryCount: 1`` in the binding
both saved, and the run used 1.

Here every rule MEDial can operate on is a typed value model. From one
``SemanticChange`` (rule type + before values + after values) this module
produces, deterministically:

* the sentence for before and for after (``format_rule``);
* the engine bindings (``compile_bindings``);
* the semantic hash the loop uses to notice "already executed"
  (``semantic_hash`` - rationale and label are *not* in it, so a draft that
  only changes its explanation is not a new execution).

The UI edits the values through controls generated from ``catalog()``. The
model proposes in the same shape (``ProposedRule``). Nobody edits a sentence
or a binding directly, and there is nothing to keep in sync.

Adding a rule type means adding one ``_Spec`` and one values model here. It
does not mean touching the validator, the improver, the store or the screen.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Annotated, Any, Callable, Literal, Union

from pydantic import Field

from ..contracts import Base, ContactStrategy, PolicyParams
from .llm import content_hash

QUEST_WELFARE = "quest:no-response-welfare-check"
QUEST_TRANSPORT = "quest:medical-transport"


class RuleType(str, Enum):
    retry_before_help = "retry_before_help"
    quiet_period = "quiet_period"
    helper_daily_cap = "helper_daily_cap"
    neighbour_ask_limit = "neighbour_ask_limit"
    disclosure_scope = "disclosure_scope"
    institution_deadline = "institution_deadline"
    contact_order = "contact_order"
    ride_candidate_order = "ride_candidate_order"
    ride_detour_limit = "ride_detour_limit"


# --------------------------------------------------------------- value models
# One model per rule type. The bounds are the engine's (``PolicyParams``), so a
# value the screen accepts is a value the run will use.
class RetryValues(Base):
    count: int = Field(ge=0, le=6)
    intervalMinutes: int = Field(ge=5, le=240)


class QuietValues(Base):
    minutes: int = Field(ge=0, le=240)


class HelperCapValues(Base):
    perDay: int = Field(ge=0, le=10)


class NeighbourLimitValues(Base):
    people: int = Field(ge=1, le=8)


class DisclosureValues(Base):
    level: Literal["minimal", "named"]


class DeadlineValues(Base):
    #: ``None`` is a real value: no deadline.
    afterMinutes: int | None = Field(default=None, ge=5, le=600)


class ContactOrderValues(Base):
    strategy: ContactStrategy
    allowHeadContact: bool


class RideOrderValues(Base):
    order: Literal["closest_first", "kin_first"]


class RideDetourValues(Base):
    maxDetourMinutes: int = Field(ge=0, le=120)


class RetryChange(Base):
    ruleType: Literal["retry_before_help"]
    before: RetryValues
    after: RetryValues


class QuietChange(Base):
    ruleType: Literal["quiet_period"]
    before: QuietValues
    after: QuietValues


class HelperCapChange(Base):
    ruleType: Literal["helper_daily_cap"]
    before: HelperCapValues
    after: HelperCapValues


class NeighbourLimitChange(Base):
    ruleType: Literal["neighbour_ask_limit"]
    before: NeighbourLimitValues
    after: NeighbourLimitValues


class DisclosureChange(Base):
    ruleType: Literal["disclosure_scope"]
    before: DisclosureValues
    after: DisclosureValues


class DeadlineChange(Base):
    ruleType: Literal["institution_deadline"]
    before: DeadlineValues
    after: DeadlineValues


class ContactOrderChange(Base):
    ruleType: Literal["contact_order"]
    before: ContactOrderValues
    after: ContactOrderValues


class RideOrderChange(Base):
    ruleType: Literal["ride_candidate_order"]
    before: RideOrderValues
    after: RideOrderValues


class RideDetourChange(Base):
    ruleType: Literal["ride_detour_limit"]
    before: RideDetourValues
    after: RideDetourValues


SemanticChange = Annotated[
    Union[RetryChange, QuietChange, HelperCapChange, NeighbourLimitChange,
          DisclosureChange, DeadlineChange, ContactOrderChange, RideOrderChange,
          RideDetourChange],
    Field(discriminator="ruleType"),
]

VALUE_MODELS: dict[str, type[Base]] = {
    RuleType.retry_before_help.value: RetryValues,
    RuleType.quiet_period.value: QuietValues,
    RuleType.helper_daily_cap.value: HelperCapValues,
    RuleType.neighbour_ask_limit.value: NeighbourLimitValues,
    RuleType.disclosure_scope.value: DisclosureValues,
    RuleType.institution_deadline.value: DeadlineValues,
    RuleType.contact_order.value: ContactOrderValues,
    RuleType.ride_candidate_order.value: RideOrderValues,
    RuleType.ride_detour_limit.value: RideDetourValues,
}

CHANGE_MODELS: dict[str, type[Base]] = {
    RuleType.retry_before_help.value: RetryChange,
    RuleType.quiet_period.value: QuietChange,
    RuleType.helper_daily_cap.value: HelperCapChange,
    RuleType.neighbour_ask_limit.value: NeighbourLimitChange,
    RuleType.disclosure_scope.value: DisclosureChange,
    RuleType.institution_deadline.value: DeadlineChange,
    RuleType.contact_order.value: ContactOrderChange,
    RuleType.ride_candidate_order.value: RideOrderChange,
    RuleType.ride_detour_limit.value: RideDetourChange,
}


# ------------------------------------------------------------------ formatting
_STRATEGY_WORDS = {
    "head_first": "이장에게 확인을 부탁한다",
    "retry_then_clinic": "보건소 담당자에게 넘긴다",
    "neighbour_first": "가까이 사는 이웃에게 먼저 부탁하고, 거절하면 다음 사람에게 간다",
    "relation_first": "기록된 가까운 관계에게 먼저 부탁하고 이장은 마지막에 부탁한다",
}


def _fmt_retry(v: RetryValues) -> str:
    if v.count == 0:
        return "응답이 없으면 본인에게 다시 연락하지 않고 바로 다음 단계로 간다."
    return ("응답이 없으면 본인에게 %d분 간격으로 %d회 전화로 다시 연락한 뒤 다음 단계로 간다."
            % (v.intervalMinutes, v.count))


def _fmt_quiet(v: QuietValues) -> str:
    if v.minutes == 0:
        return "같은 사람에게 다시 연락하기까지 비워 두는 시간이 없다."
    return "같은 사람에게 다시 연락하려면 적어도 %d분을 비워 둔다." % v.minutes


def _fmt_cap(v: HelperCapValues) -> str:
    if v.perDay == 0:
        return "주민에게 조율 부탁을 하지 않는다."
    return "한 사람이 하루에 받는 조율 부탁은 %d번까지다. 넘으면 그 사람에게는 묻지 않는다." % v.perDay


def _fmt_limit(v: NeighbourLimitValues) -> str:
    return "한 건에 대해 이웃 %d명까지 차례로 물어본다." % v.people


def _fmt_disclosure(v: DisclosureValues) -> str:
    return ("제3자에게는 응답이 없었다는 사실만 전달한다." if v.level == "minimal"
            else "제3자에게 연락 시각과 공개 동의된 평소 일과까지 함께 전달한다.")


def _fmt_deadline(v: DeadlineValues) -> str:
    if v.afterMinutes is None:
        return "미해결이어도 기관으로 넘기는 기한이 없다."
    return "접수 후 %d분 안에 풀리지 않으면 기관으로 넘긴다." % v.afterMinutes


def _fmt_order(v: ContactOrderValues) -> str:
    head = "" if v.allowHeadContact else " 이장에게는 묻지 않는다."
    return "본인에게 닿지 않으면 %s.%s" % (_STRATEGY_WORDS[v.strategy.value], head)


def _fmt_ride_order(v: RideOrderValues) -> str:
    return ("동승은 동선이 가장 가까운 사람에게 먼저 부탁한다." if v.order == "closest_first"
            else "동승은 기록된 친척에게 먼저 부탁한다.")


def _fmt_detour(v: RideDetourValues) -> str:
    return "운전자에게 최대 %d분까지의 우회를 부탁한다." % v.maxDetourMinutes


# --------------------------------------------------------------- the catalogue
@dataclass(frozen=True)
class ParamSpec:
    key: str
    label: str
    kind: Literal["int", "bool", "enum"]
    binding: str
    minimum: int | None = None
    maximum: int | None = None
    options: tuple[tuple[str, str], ...] = ()
    unit: str = ""
    nullable: bool = False
    nullLabel: str = ""


@dataclass(frozen=True)
class _Spec:
    rule_type: RuleType
    label: str
    description: str
    scope: Literal["quest", "task"]
    target: str
    quest_id: str
    task_ids: tuple[str, ...]
    field: str
    params: tuple[ParamSpec, ...]
    fmt: Callable[[Any], str]
    #: ``None`` means the whole-day comparison cannot say anything about this
    #: rule; the application probe (``rule_application``) reads these keys.
    dimension_hint: str = ""


SPECS: dict[str, _Spec] = {
    s.rule_type.value: s for s in (
        _Spec(RuleType.retry_before_help, "본인 재연락",
              "다른 사람에게 부탁하기 전에 본인에게 전화로 다시 연락하는 횟수와 간격.",
              "task", "timing_burden", QUEST_WELFARE, ("task:contact-subject",), "retry",
              (ParamSpec("count", "재연락 횟수", "int", "retryCount", 0, 6, unit="회"),
               ParamSpec("intervalMinutes", "재연락 간격", "int", "retryIntervalMin", 5, 240,
                         unit="분")),
              _fmt_retry, "help_resolution"),
        _Spec(RuleType.quiet_period, "연락 최소 간격",
              "같은 사람에게 다시 연락하기까지 반드시 비워 두는 시간.",
              "task", "timing_burden", QUEST_WELFARE, ("task:contact-subject",), "quiet_period",
              (ParamSpec("minutes", "비워 두는 시간", "int", "quietWindowMin", 0, 240, unit="분"),),
              _fmt_quiet, "time_labour"),
        _Spec(RuleType.helper_daily_cap, "한 사람이 받는 부탁 상한",
              "한 사람이 하루에 받을 수 있는 조율 부탁의 수. 넘으면 그 사람에게는 묻지 않는다.",
              "task", "task_assignment_refusal", QUEST_WELFARE,
              ("task:request-welfare-check", "task:arrange-transport"), "workload_limit",
              (ParamSpec("perDay", "하루 부탁 상한", "int", "helperContactCap", 0, 10, unit="번"),),
              _fmt_cap, "time_labour"),
        _Spec(RuleType.neighbour_ask_limit, "한 건에 묻는 이웃 수",
              "거절당했을 때 몇 명까지 차례로 물어볼지.",
              "task", "task_assignment_refusal", QUEST_WELFARE,
              ("task:request-welfare-check",), "assignment_order",
              (ParamSpec("people", "이웃 수", "int", "neighbourAskLimit", 1, 8, unit="명"),),
              _fmt_limit, "time_labour"),
        _Spec(RuleType.disclosure_scope, "제3자에게 알리는 범위",
              "이웃·기관에 부탁할 때 함께 넘기는 정보의 범위.",
              "task", "explanation_disclosure", QUEST_WELFARE,
              ("task:request-welfare-check", "task:institution-handoff"), "disclosure",
              (ParamSpec("level", "공개 범위", "enum", "disclosure",
                         options=(("minimal", "응답 없음 사실만"),
                                  ("named", "연락 시각과 동의된 일과까지"))),),
              _fmt_disclosure, "disclosure"),
        _Spec(RuleType.institution_deadline, "기관 인계 기한",
              "접수 후 이 시간이 지나면 순서와 무관하게 기관으로 넘긴다.",
              "quest", "quest_completion_escalation", QUEST_WELFARE,
              ("task:institution-handoff",), "escalation",
              (ParamSpec("afterMinutes", "인계 기한", "int", "escalateToInstitutionAfterMin",
                         5, 600, unit="분", nullable=True, nullLabel="기한 없음"),),
              _fmt_deadline, "help_resolution"),
        _Spec(RuleType.contact_order, "본인에게 닿지 않을 때의 연락 순서",
              "재연락이 끝난 뒤 누구에게 가는가, 그리고 이장에게 물어도 되는가.",
              "quest", "task_composition_flow", QUEST_WELFARE,
              ("task:contact-subject", "task:request-welfare-check", "task:institution-handoff"),
              "task_flow",
              (ParamSpec("strategy", "연락 순서", "enum", "contactStrategy",
                         options=tuple((s.value, _STRATEGY_WORDS[s.value])
                                       for s in ContactStrategy)),
               ParamSpec("allowHeadContact", "이장에게 물어도 되는가", "bool", "allowHeadContact")),
              _fmt_order, "help_resolution"),
        _Spec(RuleType.ride_candidate_order, "동승 부탁 순서",
              "동승을 누구에게 먼저 부탁하는가.",
              "task", "task_assignment_refusal", QUEST_TRANSPORT,
              ("task:arrange-transport",), "assignment_order",
              (ParamSpec("order", "부탁 순서", "enum", "rideCandidateOrder",
                         options=(("closest_first", "동선이 가까운 사람 먼저"),
                                  ("kin_first", "기록된 친척 먼저"))),),
              _fmt_ride_order, "choice_refusal"),
        _Spec(RuleType.ride_detour_limit, "동승 우회 한도",
              "운전자에게 부탁할 수 있는 추가 우회 시간.",
              "task", "timing_burden", QUEST_TRANSPORT, ("task:arrange-transport",),
              "travel_limit",
              (ParamSpec("maxDetourMinutes", "최대 우회", "int", "maxRideDetourMin", 0, 120,
                         unit="분"),),
              _fmt_detour, "time_labour"),
    )
}

#: Which deck exercises which quest. A rule for the transport quest is not
#: applicable to a session that runs only the check-in deck, and the validator
#: says so instead of letting the run show "no difference".
DECK_QUESTS: dict[str, str] = {
    "deck-p1-no-response-v1": QUEST_WELFARE,
    "deck-p9-transport-v1": QUEST_TRANSPORT,
}


def spec(rule_type: str) -> _Spec:
    try:
        return SPECS[rule_type]
    except KeyError as exc:
        raise ValueError("지원하지 않는 규칙 종류다: %s" % rule_type) from exc


def read_values(rule_type: str, policy: dict[str, Any]) -> Base:
    """The rule's current values, read off the current MEDial revision."""
    s = spec(rule_type)
    params = policy.get("params") or {}
    raw: dict[str, Any] = {}
    for p in s.params:
        if p.binding == "contactStrategy":
            raw[p.key] = policy.get("contactStrategy")
        else:
            raw[p.key] = params.get(p.binding, PolicyParams.model_fields[p.binding].default)
    return VALUE_MODELS[rule_type].model_validate(raw)


def build_change(rule_type: str, policy: dict[str, Any], after: dict[str, Any]) -> Any:
    """A validated semantic change whose ``before`` is the current revision."""
    before = read_values(rule_type, policy)
    after_model = VALUE_MODELS[rule_type].model_validate(after)
    return CHANGE_MODELS[rule_type].model_validate({
        "ruleType": rule_type, "before": before.model_dump(mode="json"),
        "after": after_model.model_dump(mode="json")})


def merge_after(rule_type: str, policy: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    """Current values overlaid with the keys the caller actually set.

    An unknown key is kept so that validation names it instead of silently
    dropping a typo."""
    current = read_values(rule_type, policy).model_dump(mode="json")
    return {**current, **after}


def format_rule(rule_type: str, values: Any) -> str:
    return spec(rule_type).fmt(values)


def compile_bindings(change: Any) -> list[dict[str, Any]]:
    """Engine bindings for a change - only the parameters that actually move."""
    s = spec(change.ruleType)
    out = []
    for p in s.params:
        before = getattr(change.before, p.key)
        after = getattr(change.after, p.key)
        if before == after:
            continue
        out.append({"key": p.binding,
                    "before": before.value if isinstance(before, Enum) else before,
                    "after": after.value if isinstance(after, Enum) else after})
    return out


def semantic_hash(changes: list[Any]) -> str:
    """Identity of *what will run*. Label and rationale are excluded on purpose."""
    rows = sorted(
        [c.ruleType, c.before.model_dump(mode="json"), c.after.model_dump(mode="json")]
        for c in changes)
    return content_hash(rows)


def coherence_errors(changes: list[Any], policy: dict[str, Any]) -> list[str]:
    """Cross-rule constraints on the *resulting* revision."""
    strategy = policy.get("contactStrategy")
    allow_head = (policy.get("params") or {}).get("allowHeadContact", True)
    for c in changes:
        if c.ruleType == RuleType.contact_order.value:
            strategy = c.after.strategy.value
            allow_head = c.after.allowHeadContact
    errors = []
    if strategy == ContactStrategy.head_first.value and not allow_head:
        errors.append("이장 우선 순서에서는 이장 연락을 비활성화할 수 없다.")
    return errors


def catalog(active_decks: list[str] | None = None,
            policy: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """What the screen and the model may compose from.

    ``policy`` fills in the current values so a control can start from what the
    run actually uses; ``active_decks`` marks which rules the session can
    exercise at all.
    """
    active_quests = ({DECK_QUESTS[d] for d in active_decks if d in DECK_QUESTS}
                     if active_decks is not None else None)
    rows = []
    for s in SPECS.values():
        row: dict[str, Any] = {
            "ruleType": s.rule_type.value, "label": s.label, "description": s.description,
            "scope": s.scope, "target": s.target, "questId": s.quest_id,
            "taskIds": list(s.task_ids), "field": s.field,
            "applicable": (active_quests is None or s.quest_id in active_quests),
            "params": [{
                "key": p.key, "label": p.label, "kind": p.kind, "binding": p.binding,
                "minimum": p.minimum, "maximum": p.maximum,
                "options": [{"value": v, "label": l} for v, l in p.options],
                "unit": p.unit, "nullable": p.nullable, "nullLabel": p.nullLabel,
            } for p in s.params],
        }
        if policy is not None:
            current = read_values(s.rule_type.value, policy)
            row["current"] = current.model_dump(mode="json")
            row["currentRule"] = s.fmt(current)
        rows.append(row)
    return rows


class ProposedRule(Base):
    """What the model (or the screen) sends: a rule type and the values after.

    Flat on purpose: one optional slot per parameter across every rule type, so
    the JSON schema handed to the model is concrete and the server can say
    exactly which value was missing.
    """

    ruleType: RuleType
    count: int | None = None
    intervalMinutes: int | None = None
    minutes: int | None = None
    perDay: int | None = None
    people: int | None = None
    level: Literal["minimal", "named"] | None = None
    afterMinutes: int | None = None
    #: The deadline rule needs "no deadline" to be sayable; ``afterMinutes``
    #: alone cannot tell "unset" from "none".
    noDeadline: bool | None = None
    strategy: ContactStrategy | None = None
    allowHeadContact: bool | None = None
    order: Literal["closest_first", "kin_first"] | None = None
    maxDetourMinutes: int | None = None

    def after_values(self, policy: dict[str, Any]) -> dict[str, Any]:
        """The ``after`` dict for this rule; unspecified parameters keep their
        current value so a one-parameter edit does not have to restate the
        rest."""
        current = read_values(self.ruleType.value, policy).model_dump(mode="json")
        s = spec(self.ruleType.value)
        out = dict(current)
        for p in s.params:
            value = getattr(self, p.key)
            if p.key == "afterMinutes" and self.noDeadline:
                out[p.key] = None
            elif value is not None:
                out[p.key] = value.value if isinstance(value, Enum) else value
        return out
