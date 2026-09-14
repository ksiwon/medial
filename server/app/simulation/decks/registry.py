"""Every deck, policy and resource revision the service can run.

Kept in one place so that adding a scenario does not mean editing the service,
the runner and the API. Ids are unique across decks; a duplicate is a mistake
worth failing on at import time rather than resolving by dictionary order.
"""
from __future__ import annotations

from typing import Any

from . import iteration_start as it
from . import p1_no_response as p1
from . import p9_transport as p9


def _merge(name: str, *groups: Any) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for group in groups:
        for item in group:
            if item.id in out:
                raise ValueError("duplicate %s id %s" % (name, item.id))
            out[item.id] = item
    return out


DECKS = _merge("deck", [p1.DECK], [p9.DECK])
POLICIES = _merge("policy", [p1.POLICY_A, p1.POLICY_B, p1.POLICY_C],
                  [p9.POLICY_T_A, p9.POLICY_T_B],
                  [it.POLICY_ITER_V0])
RESOURCE_SETS = _merge("resource revision", [p1.RESOURCES], [p9.RESOURCES_T])

#: The policy an iteration session starts from. It runs on both development
#: decks because every condition it sets is read by the engine in both.
ITERATION_START_POLICY = it.POLICY_ITER_V0.id

#: Which resource revision and policies belong with which deck. The UI uses this
#: so it cannot offer a transport policy for the check-in deck.
DECK_DEFAULTS = {
    p1.DECK.id: {"resourceRevisionId": p1.RESOURCES.id,
                 "policyIds": [p1.POLICY_A.id, p1.POLICY_B.id]},
    p9.DECK.id: {"resourceRevisionId": p9.RESOURCES_T.id,
                 "policyIds": [p9.POLICY_T_A.id, p9.POLICY_T_B.id]},
}
