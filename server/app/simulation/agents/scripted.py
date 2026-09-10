"""Scripted adapter: fixture-driven behaviour for functional and regression tests.

A script entry matches on (actorId, kind of the newest observation) and returns a
fixed proposal. If nothing matches, the adapter returns no proposal - it never
guesses, because a silent guess in a test fixture is indistinguishable from a
real rule.
"""
from __future__ import annotations

from typing import Any, Sequence

from ..contracts import ActionProposal, ProposalAction
from ..observations import ActorView
from .base import ProposalFactory


class ScriptedAdapter:
    name = "scripted"

    def __init__(self, factory: ProposalFactory, script: list[dict[str, Any]]) -> None:
        self.factory = factory
        self.script = script
        self.used: list[int] = []

    def propose(self, view: ActorView,
                allowed: Sequence[ProposalAction]) -> list[ActionProposal]:
        latest = view.observations[-1] if view.observations else None
        if latest is None:
            return []
        for index, entry in enumerate(self.script):
            if index in self.used:
                continue
            if entry.get("actorId") != view.actor_id:
                continue
            if entry.get("onObservationKind") != latest.kind:
                continue
            action = ProposalAction(entry["action"])
            if action not in allowed:
                continue
            self.used.append(index)
            return [self.factory.make(
                view.actor_id, view.sim_time_ms, action, source="scripted",
                requestId=latest.payload.get("requestId"),
                params=entry.get("params", {}),
                utterance=entry.get("utterance"),
                observationIds=[latest.id],
            )]
        return []
