"""Why somebody says no, one reason at a time.

Until now a resident who *could* go, went. So a policy comparison measured
routing and never the cost of asking, and a village where nobody can refuse has
no burden to report.

The obvious fix - score how busy they are, how close they are to the asker, how
often they have been called, add it up and refuse above a threshold - is the one
thing this must not do. A single number hides which part of it was evidence: a
3.2 made of two measured points and one guess reads exactly like a 3.2 made of
three guesses. And a score looks measured in a way a stated guess does not, so it
invites being tuned until the results look right.

So the rules are a list, in order, and the **first one that fires is the reason**.
Nothing is added together. Each line carries its own provenance, and each can be
switched off on its own so a run can show which line actually changed the day.
This is the same shape the phone table already uses (D016).

Deliberately still absent: any acceptance probability, any trust score, any
conversion of a refusal into a relationship penalty. Refusing costs nothing and
is remembered by nobody.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

#: Every rule key, in the order they are asked. Most-grounded first, so that when
#: several would fire the reason a person is given is the best-evidenced one.
RULE_ORDER = (
    "persona_condition",
    "cannot_leave_here",
    "asked_too_often",
    "too_far",
)


@dataclass
class Verdict:
    """What this person does, and the one reason for it."""

    action: Literal["accept", "decline", "step_aside"]
    #: ``None`` when nothing fired and the answer is simply yes.
    rule: str | None = None
    reason: str = ""
    provenance: str = "researcher-assumption"
    detail: dict[str, Any] = field(default_factory=dict)
    evidence: list[str] = field(default_factory=list)


def assess(view: Any, rules: Any, requester_id: str | None = None,
           relation_kind: str | None = None) -> Verdict:
    """Ask each line in turn. The first that fires is the answer.

    ``step_aside`` means "not from here" rather than "no": the caller offers it
    to a neighbour first and only defers if there is nobody to hand it to.
    """
    # An empty list means "ask nothing", which is a legitimate run - it is how a
    # comparison shows what the table as a whole was doing. ``or RULE_ORDER``
    # would have quietly turned every line back on.
    configured = getattr(rules, "enabledDeclineRules", None)
    enabled = set(RULE_ORDER if configured is None else configured)
    persona = view.persona or {}
    offer = view.latest("request.offered") or view.latest("request.relayed")
    payload = offer.payload if offer is not None else {}

    for key in RULE_ORDER:
        if key not in enabled:
            continue
        verdict = _RULES[key](view, rules, persona, payload, requester_id, relation_kind)
        if verdict is not None:
            return verdict

    return Verdict(action="accept", reason="지금 하던 일을 잠시 놓고 다녀올 수 있다.",
                   provenance="researcher-assumption",
                   detail={"activity": view.own_activity, "place": view.own_place})


# -- the lines ---------------------------------------------------------------
def _persona_condition(view, rules, persona, payload, requester_id, relation_kind):
    """Something this person said in their own interview about not leaving.

    The only line whose magnitude is not a researcher setting: it either appears
    in the compiled profile or it does not.
    """
    conditions = persona.get("declineConditions") or []
    if not conditions:
        return None
    return Verdict(
        action="decline", rule="persona_condition",
        reason=conditions[0],
        provenance="source-adapted",
        detail={"conditions": list(conditions)},
        evidence=[c["id"] for c in (persona.get("evidence") or [])
                  if c.get("field") == "declineConditions"])


def _cannot_leave_here(view, rules, persona, payload, requester_id, relation_kind):
    """Tied up where they are. Not a refusal - see ``step_aside``."""
    if view.own_interruptible:
        return None
    return Verdict(
        action="step_aside", rule="cannot_leave_here",
        reason="지금 하는 일 때문에 여기서 바로는 못 간다.",
        provenance="researcher-assumption",
        detail={"activity": view.own_activity, "place": view.own_place})


def _asked_too_often(view, rules, persona, payload, requester_id, relation_kind):
    """The one number a designer already controls, and the only one they should.

    ``helperContactCap`` is an existing policy condition. Nothing new is exposed
    here - being asked repeatedly is the burden the policy is meant to trade off.
    """
    cap = int(view.policy.get("helperContactCap", 2))
    if view.contacts_received_today <= cap:
        return None
    return Verdict(
        action="decline", rule="asked_too_often",
        reason="오늘 이미 여러 번 불렸다.",
        provenance="researcher-assumption",
        detail={"contactsToday": view.contacts_received_today, "capFromPolicy": cap})


def _too_far(view, rules, persona, payload, requester_id, relation_kind):
    """How long the walk is. The distance is measured; the limit is not.

    One exception, and it is not invented: some people said in their interview
    that a close relative's request overrides the trouble. Until the relation
    graph existed the engine could not tell whether a request had come through a
    relative and had to record ``kinExceptionApplies: unknown``. Now it can.
    """
    minutes = payload.get("travelMinutes")
    limit = int(getattr(rules, "maxErrandMinutes", 25))
    if minutes is None or float(minutes) <= limit:
        return None

    kin_rule = [c for c in (persona.get("acceptanceConditions") or []) if "친척" in c]
    if kin_rule and relation_kind == "kin":
        return None

    return Verdict(
        action="decline", rule="too_far",
        reason="거기까지 가기에는 너무 멀다.",
        provenance="researcher-assumption",
        detail={"travelMinutes": round(float(minutes), 1), "limitMinutes": limit,
                "requesterId": requester_id, "relationKind": relation_kind,
                "kinExceptionExists": bool(kin_rule),
                "kinExceptionApplies": bool(kin_rule) and relation_kind == "kin",
                "distanceBasis": "road-graph-shortest-path",
                "note": ("거리는 도로망에서 계산한 값이고 %d분이라는 한도는 연구자 설정이다. "
                         "원자료에 '몇 분까지 간다'는 기록은 없다." % limit)})


_RULES = {
    "persona_condition": _persona_condition,
    "cannot_leave_here": _cannot_leave_here,
    "asked_too_often": _asked_too_often,
    "too_far": _too_far,
}
