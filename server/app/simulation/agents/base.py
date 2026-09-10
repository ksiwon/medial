"""Adapter boundary.

Everything an actor can do goes through ``propose``. An adapter returns
``ActionProposal`` objects and never touches world state; the engine validates
and only then commits events. Swapping the rule adapter for an LLM adapter must
not require any change to the engine.
"""
from __future__ import annotations

from typing import Protocol, Sequence

from ..contracts import ActionProposal, ProposalAction
from ..observations import ActorView


class AdapterError(RuntimeError):
    """Adapter could not produce a usable proposal.

    The engine records this as an adapter failure. It is never written down as a
    resident declining or failing to answer.
    """


class AgentAdapter(Protocol):
    name: str

    def propose(self, view: ActorView,
                allowed: Sequence[ProposalAction]) -> list[ActionProposal]: ...


class ProposalFactory:
    """Stable ids so that two runs of the same rules produce the same log."""

    def __init__(self, attempt_id: str) -> None:
        self.attempt_id = attempt_id
        self._n = 0

    def make(self, actor_id: str, sim_time_ms: int, action: ProposalAction,
             source: str = "rule", **kwargs) -> ActionProposal:
        self._n += 1
        return ActionProposal(
            id="prop-%d" % self._n,
            attemptId=self.attempt_id,
            actorId=actor_id,
            simTimeMs=sim_time_ms,
            action=action,
            source=source,  # type: ignore[arg-type]
            **kwargs,
        )
