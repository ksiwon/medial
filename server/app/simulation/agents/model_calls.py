"""Recording and replaying model calls.

A run that calls a model is not reproducible. temperature=0 is not determinism -
providers batch, quantize and re-route, and the same prompt comes back different
weeks apart, or never, because the model was retired. Without this module the
comparison screen's central claim ("these two runs differ only in the policy")
would quietly stop being true the moment an LLM adapter was wired in.

So the answer is not to ask the provider to behave. It is to write every call
down and replay it:

* the key is **content-addressed** - model, temperature, prompt revision, which
  actor asked, that actor's call index, and the prompt payload. Wall-clock time
  is deliberately excluded, which is the whole reason the same day re-run
  produces the same keys;
* in ``replay`` mode a prompt with no recorded answer raises. It is never a
  silent fresh call. A silent re-call is the failure this module exists to
  prevent: the run would look replayed, cost money, and differ;
* a fork loads its parent's records. The shared prefix therefore replays the
  parent's exact answers, and divergence after the checkpoint is the policy's
  doing rather than the model's mood.

An adapter failure here is an engine fault. It is never written down as a
resident declining or failing to answer - see ``AdapterError``.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Iterable

from ..contracts import ModelCallRecord, ModelPolicy
from .base import AdapterError


class MissingModelCall(AdapterError):
    """Replay was asked for a prompt that was never recorded.

    Raised rather than calling the provider, because a run that silently filled
    its own gaps is not a replay of anything.
    """


def call_key(policy: ModelPolicy, actor_id: str, call_index: int,
             prompt: dict[str, Any]) -> str:
    """Content address of one call.

    ``call_index`` is in the key on purpose. Two content-identical prompts from
    the same actor are two questions, and at any temperature above zero they may
    have two different answers; collapsing them would make a recording that
    cannot reproduce the run it came from.
    """
    payload = json.dumps(prompt, ensure_ascii=False, sort_keys=True, default=str)
    material = "|".join([
        policy.modelId,
        "%.6f" % policy.temperature,
        policy.promptRevisionId,
        actor_id,
        str(call_index),
        payload,
    ])
    return "mc-" + hashlib.sha256(material.encode("utf-8")).hexdigest()[:32]


class ModelCallLog:
    """The per-attempt record of model calls, and the gate in front of them.

    One log per attempt, shared by every actor's adapter. The adapters are split
    per actor - see ``engine._build_adapters`` - but the log is not, because the
    recording belongs to the run.
    """

    def __init__(self, attempt_id: str, policy: ModelPolicy,
                 inherited: Iterable[ModelCallRecord] | None = None) -> None:
        self.attempt_id = attempt_id
        self.policy = policy
        #: Calls available to be replayed: for a fork, the parent's. Keyed by the
        #: content address, so a child that walks the same path finds them and a
        #: child that diverges does not.
        self.inherited: dict[str, ModelCallRecord] = {
            record.key: record for record in (inherited or [])}
        #: What this attempt actually used, in order. Stored with the run.
        self.records: list[ModelCallRecord] = []
        self._counts: dict[str, int] = {}

    # -- bookkeeping ----------------------------------------------------
    def next_index(self, actor_id: str) -> int:
        """This actor's next call number. Per actor, so that one resident being
        asked more often does not renumber everybody else's calls."""
        return self._counts.get(actor_id, 0)

    def _bump(self, actor_id: str) -> None:
        self._counts[actor_id] = self._counts.get(actor_id, 0) + 1

    # -- the gate -------------------------------------------------------
    def resolve(self, actor_id: str, sim_time_ms: int, prompt: dict[str, Any],
                provider: Any | None = None) -> ModelCallRecord:
        """Answer one prompt, from the recording or from the provider.

        ``provider`` is a callable taking ``(prompt, policy)`` and returning raw
        text. It is only ever reached in ``record`` mode.
        """
        policy = self.policy
        if policy.mode == "off":
            raise AdapterError(
                "modelPolicy.mode가 off다. 이 실행은 모델을 부르지 않기로 되어 있으므로 "
                "LLM 어댑터를 쓰려면 record 또는 replay로 실행해야 한다.")

        index = self.next_index(actor_id)
        key = call_key(policy, actor_id, index, prompt)

        found = self.inherited.get(key)
        if found is not None:
            record = found.model_copy(update={
                "attemptId": self.attempt_id, "origin": "replayed"})
            self._bump(actor_id)
            self.records.append(record)
            return record

        if policy.mode == "replay":
            raise MissingModelCall(
                "%s의 %d번째 호출에 해당하는 기록이 없다 (key=%s). 재생 실행은 "
                "빠진 호출을 모델에게 다시 묻지 않는다. 조용히 다시 부르면 재생이 아니라 "
                "새 실행이고, 비교는 통제를 잃는다." % (actor_id, index + 1, key))

        if provider is None:
            raise AdapterError(
                "record 모드인데 모델 공급자가 연결되어 있지 않다. 이 빌드는 아직 "
                "모델을 호출하지 않으며, 기록된 호출을 재생하는 것만 가능하다.")

        record = self._call(provider, key, actor_id, index, sim_time_ms, prompt)
        self._bump(actor_id)
        self.records.append(record)
        if record.status == "error":
            raise AdapterError("모델 호출이 실패했다: %s" % record.error)
        return record

    def _call(self, provider: Any, key: str, actor_id: str, index: int,
              sim_time_ms: int, prompt: dict[str, Any]) -> ModelCallRecord:
        import time
        from datetime import datetime, timezone

        policy = self.policy
        started = time.monotonic()
        base = {
            "key": key, "attemptId": self.attempt_id, "actorId": actor_id,
            "callIndex": index, "simTimeMs": sim_time_ms,
            "modelId": policy.modelId, "temperature": policy.temperature,
            "promptRevisionId": policy.promptRevisionId, "prompt": prompt,
            "createdAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
            "origin": "live",
        }
        try:
            text = provider(prompt, policy)
        except Exception as exc:  # noqa: BLE001 - recorded, then re-raised by the caller
            # A failed call is written down too. A run that quietly dropped the
            # calls it could not make would report fewer decisions than it
            # actually attempted.
            return ModelCallRecord(status="error", error=str(exc), response=None,
                                   latencyMs=int((time.monotonic() - started) * 1000),
                                   **base)
        return ModelCallRecord(status="ok", response=text,
                               latencyMs=int((time.monotonic() - started) * 1000),
                               **base)
