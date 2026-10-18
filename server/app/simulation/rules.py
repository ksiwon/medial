"""The AI's operating rules, said in words.

A request changes one or more of nine typed rules (``briefs.json`` ``rules[].type``). The screens never show a raw
value: the AI's judgment panel says which rules the event ran under, and after a request was chosen, which of them
it changed, before and after. One sentence per rule type and value, written once here (the sentences are the ones
v3's ``semantic_rules.py`` used; that module went with the engine, these did not).

A rule type nobody wrote a sentence for stops the read: an unnamed rule would reach the wall as a key.
"""
from __future__ import annotations

from typing import Any, Callable

_STRATEGY_WORDS = {
    "head_first": "이장에게 확인을 부탁한다",
    "retry_then_clinic": "보건소 담당자에게 넘긴다",
    "neighbour_first": "가까이 사는 이웃에게 먼저 부탁하고, 거절하면 다음 사람에게 간다",
    "relation_first": "기록된 가까운 관계에게 먼저 부탁하고 이장은 마지막에 부탁한다",
}


def _retry(v: dict[str, Any]) -> str:
    if v["count"] == 0:
        return "응답이 없으면 본인에게 다시 연락하지 않고 바로 다음 단계로 간다."
    return "응답이 없으면 본인에게 %d분 간격으로 %d회 다시 연락한 뒤 다음 단계로 간다." % (v["intervalMinutes"], v["count"])


def _quiet(v: dict[str, Any]) -> str:
    if v["minutes"] == 0:
        return "같은 사람에게 다시 연락하기까지 비워 두는 시간이 없다."
    return "같은 사람에게 다시 연락하려면 적어도 %d분을 비워 둔다." % v["minutes"]


def _cap(v: dict[str, Any]) -> str:
    if v["perDay"] == 0:
        return "주민에게 조율 부탁을 하지 않는다."
    return "한 사람이 하루에 받는 조율 부탁은 %d번까지다. 넘으면 그 사람에게는 묻지 않는다." % v["perDay"]


def _limit(v: dict[str, Any]) -> str:
    return "한 건에 대해 이웃 %d명까지 차례로 물어본다." % v["people"]


def _disclosure(v: dict[str, Any]) -> str:
    return ("제3자에게는 응답이 없었다는 사실만 전달한다." if v["level"] == "minimal"
            else "제3자에게 연락 시각과 공개 동의된 평소 일과까지 함께 전달한다.")


def _deadline(v: dict[str, Any]) -> str:
    if v.get("afterMinutes") is None:
        return "미해결이어도 기관으로 넘기는 기한이 없다."
    return "접수 후 %d분 안에 풀리지 않으면 기관으로 넘긴다." % v["afterMinutes"]


def _order(v: dict[str, Any]) -> str:
    head = "" if v["allowHeadContact"] else " 이장에게는 묻지 않는다."
    return "본인에게 닿지 않으면 %s.%s" % (_STRATEGY_WORDS[v["strategy"]], head)


def _ride_order(v: dict[str, Any]) -> str:
    return ("동승은 동선이 가장 가까운 사람에게 먼저 부탁한다." if v["order"] == "closest_first"
            else "동승은 기록된 친척에게 먼저 부탁한다.")


def _detour(v: dict[str, Any]) -> str:
    return "운전자에게 최대 %d분까지의 우회를 부탁한다." % v["maxDetourMinutes"]


#: rule type -> (its name on screen, the sentence for a value)
RULES: dict[str, tuple[str, Callable[[dict[str, Any]], str]]] = {
    "retry_before_help": ("본인 재연락", _retry),
    "quiet_period": ("연락 최소 간격", _quiet),
    "helper_daily_cap": ("한 사람이 받는 부탁 상한", _cap),
    "neighbour_ask_limit": ("한 건에 묻는 이웃 수", _limit),
    "disclosure_scope": ("제3자에게 알리는 범위", _disclosure),
    "institution_deadline": ("기관 인계 기한", _deadline),
    "contact_order": ("본인에게 닿지 않을 때의 연락 순서", _order),
    "ride_candidate_order": ("동승 부탁 순서", _ride_order),
    "ride_detour_limit": ("동승 우회 한도", _detour),
}


class UnknownRule(ValueError):
    pass


def label(rule_type: str) -> str:
    if rule_type not in RULES:
        raise UnknownRule(rule_type)
    return RULES[rule_type][0]


def sentence(rule_type: str, values: dict[str, Any]) -> str:
    if rule_type not in RULES:
        raise UnknownRule(rule_type)
    return RULES[rule_type][1](values)
