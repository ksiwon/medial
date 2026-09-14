"""LLM adapter boundary.

The interface exists so that the engine never has to change when a model is
plugged in. No provider is wired in this build; what *is* wired is the part a
provider cannot be trusted to do on its own - every call goes through
``ModelCallLog``, which records it or replays it. See ``model_calls`` for why
that, and not temperature=0, is what makes an LLM run reproducible.

Four constraints are written down here because they are easy to violate later:

* the prompt may contain only what is already in ``ActorView`` - that actor's own
  observations, commitments and evidence. Another actor's private memory, the
  scenario deck, or the outcome of a different policy must never be added;
* one adapter instance per actor. A shared instance mixes one actor's call
  counter into another's prompt key, and the two recordings then collide;
* a model failure is an adapter failure, recorded as an adapter error and never
  written down as the resident declining or failing to answer. So is an
  unparseable response: a model that returned prose where the schema asked for
  JSON did not make the resident refuse;
* whatever comes back still goes through the engine's proposal validation. A
  model's output earns no more trust than a rule agent's.
"""
from __future__ import annotations

import json
from typing import Any, Sequence

from ..contracts import ActionProposal, ModelPolicy, ProposalAction
from ..observations import ActorView
from .base import AdapterError, ProposalFactory
from .model_calls import ModelCallLog

#: Bumped whenever ``build_prompt_payload`` changes shape. It is part of the
#: call key, so an old recording is not silently replayed against a new prompt.
PROMPT_REVISION = "prompt-v1"


def build_prompt_payload(view: ActorView, allowed: Sequence[ProposalAction]) -> dict[str, Any]:
    """Exactly the fields a model may see. Kept as a function so it is testable."""
    return {
        "promptRevision": PROMPT_REVISION,
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
    """One actor's model-backed adapter.

    Holds no world state and no other actor's anything: a view, a prompt, a
    recorded or live answer, a proposal.
    """

    name = "llm"

    def __init__(self, factory: ProposalFactory, actor_id: str,
                 log: ModelCallLog, policy: ModelPolicy | None = None,
                 provider: Any | None = None) -> None:
        self.factory = factory
        self.actor_id = actor_id
        self.log = log
        self.policy = policy or log.policy
        #: ``(prompt, policy) -> raw text``. Absent in this build; a ``record``
        #: run without one fails loudly rather than pretending to have asked.
        self.provider = provider

    def propose(self, view: ActorView,
                allowed: Sequence[ProposalAction]) -> list[ActionProposal]:
        if not allowed:
            return []
        prompt = build_prompt_payload(view, allowed)
        record = self.log.resolve(view.actor_id, view.sim_time_ms, prompt,
                                  provider=self.provider)
        return self._parse(record.response, view, allowed)

    def _parse(self, text: str | None, view: ActorView,
               allowed: Sequence[ProposalAction]) -> list[ActionProposal]:
        """Turn raw text into at most one proposal, or fail as an adapter.

        Silence is a legitimate answer - an adapter that returns nothing means
        this actor does nothing now - but *malformed* is not silence, and the
        two are kept apart so that a broken parser cannot read as a village of
        people who stopped replying.
        """
        if text is None or not text.strip():
            raise AdapterError("모델 응답이 비어 있다. 주민의 무응답이 아니라 어댑터 실패다.")
        try:
            data = json.loads(_strip_fence(text))
        except (TypeError, ValueError) as exc:
            raise AdapterError(
                "모델 응답을 스키마로 읽을 수 없다: %s. 형식 오류이며 주민의 거절이 아니다."
                % exc) from exc
        if not isinstance(data, dict):
            raise AdapterError("모델 응답이 객체가 아니다. 어댑터 실패로 기록한다.")

        raw_action = data.get("action")
        if raw_action in (None, "", "none", "noop"):
            return []
        try:
            action = ProposalAction(raw_action)
        except ValueError as exc:
            raise AdapterError(
                "모델이 존재하지 않는 행동 %r을 골랐다. 어댑터 실패다." % raw_action) from exc
        if action not in allowed:
            raise AdapterError(
                "모델이 지금 허용되지 않은 행동 %s를 골랐다. 허용 목록은 %s였다."
                % (action.value, [a.value for a in allowed]))

        cited = data.get("usedObservationIds") or []
        if not isinstance(cited, list):
            raise AdapterError("usedObservationIds가 목록이 아니다.")

        return [self.factory.make(
            view.actor_id, view.sim_time_ms, action, source="llm",
            requestId=data.get("requestId"),
            params=data.get("params") or {},
            utterance=data.get("utterance"),
            observationIds=[str(o) for o in cited],
            uncertainty=data.get("uncertainty"),
        )]


def _strip_fence(text: str) -> str:
    """Providers wrap JSON in ``` fences often enough to be worth handling."""
    body = text.strip()
    if not body.startswith("```"):
        return body
    body = body.split("\n", 1)[1] if "\n" in body else ""
    if body.rstrip().endswith("```"):
        body = body.rstrip()[:-3]
    return body.strip()
