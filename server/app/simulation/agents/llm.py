"""LLM adapter boundary.

The interface exists so that the engine never has to change when a model is
plugged in. No model is called in this slice and no API key is read.

Two constraints are written down here because they are easy to violate later:

* the prompt may contain only what is already in ``ActorView`` - that actor's own
  observations, commitments and evidence. Another actor private memory, the
  scenario deck, or the outcome of a different policy must never be added;
* a model failure is an adapter failure. It is recorded as ``waiting_model`` or
  ``error`` and must never be written down as the resident declining or failing
  to answer.
"""
from __future__ import annotations

from typing import Any, Sequence

from ..contracts import ActionProposal, ProposalAction
from ..observations import ActorView
from .base import AdapterError, ProposalFactory


def build_prompt_payload(view: ActorView, allowed: Sequence[ProposalAction]) -> dict[str, Any]:
    """Exactly the fields a model may see. Kept as a function so it is testable."""
    return {
        "actorId": view.actor_id,
        "simTimeMs": view.sim_time_ms,
        "currentActivity": view.own_activity,
        "canBeInterrupted": view.own_interruptible,
        "observations": [
            # The id travels with the observation because the response schema
            # asks the model to cite them and the engine rejects a citation it
            # cannot resolve. Without the id here that check could never pass.
            {"id": o.id, "kind": o.kind, "subjectId": o.subjectId, "payload": o.payload,
             "atMs": o.simTimeMs, "confidence": o.confidence}
            for o in view.observations
        ],
        "commitments": view.commitments,
        # This actor's own compiled persona: behavioural structure and the ids
        # of the evidence cards behind it. Names, interview quotes and the
        # role-play prompt are not in the compiled profile at all.
        "self": {
            "drivesSelf": (view.persona or {}).get("drivesSelf"),
            "livesAlone": (view.persona or {}).get("livesAlone"),
            "acceptanceConditions": (view.persona or {}).get("acceptanceConditions", []),
            "declineConditions": (view.persona or {}).get("declineConditions", []),
            "unknowns": (view.persona or {}).get("unknowns", []),
            "evidenceIds": [c["id"] for c in (view.persona or {}).get("evidence", [])],
        },
        "allowedActions": [a.value for a in allowed],
        "responseSchema": {
            "action": "one of allowedActions",
            "requestId": "string or null",
            "utterance": "one or two short sentences",
            "usedObservationIds": "list of ids from observations",
            "uncertainty": "what you do not know, or null",
        },
    }


class LlmAdapter:
    """Placeholder. Wiring a provider goes here and nowhere else."""

    name = "llm"

    def __init__(self, factory: ProposalFactory, model_id: str | None = None) -> None:
        self.factory = factory
        self.model_id = model_id

    def propose(self, view: ActorView,
                allowed: Sequence[ProposalAction]) -> list[ActionProposal]:
        raise AdapterError(
            "LLM adapter is not wired in this build. Run the attempt with "
            "adapter='rule' or adapter='scripted'."
        )
