"""The one place the simulation actually talks to a model.

Everything above this file - the head policy, the resident adapter, the call
log - works on prompts and raw text. This file turns a prompt into an HTTP
request against the provider the server was given a key for, and it does two
things a caller cannot be trusted to remember:

* **the model ids are checked against the provider before a run starts.** Model
  names move, and a run that fails on its fortieth call because the resident
  model was retired is worse than one that refuses to start;
* **the key never leaves the process.** Not in a record, not in an error
  message, not in the catalogue. ``describe()`` says whether one is present.

Two tiers, one provider: the head asks the larger model and residents the
lighter one. Which is which is on the ``ModelPolicy`` and is hashed into the
attempt, so two runs that asked different models are different inputs.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any

from ..contracts import ModelPolicy
from ..iteration.llm import LlmClient, ModelNotConfigured, _retryable

#: What the two tiers default to. Checked against Google's model list on
#: 2026-09-15 with the project key; ``MEDIAL_LLM_HEAD_MODEL`` and
#: ``MEDIAL_LLM_RESIDENT_MODEL`` override them.
DEFAULT_HEAD_MODEL = "gemini-3.8-flash"
DEFAULT_RESIDENT_MODEL = "gemini-3.1-flash-lite"


@dataclass
class CallSpec:
    """What the provider needs beyond the prompt payload.

    Not part of the content address: the system prompt is versioned through
    ``promptRevisionId`` instead, so a wording change bumps the revision rather
    than silently making every recording stale.
    """

    role: str
    system: str
    schema: dict[str, Any]
    schema_name: str
    max_tokens: int = 1024
    #: Free text for the record, e.g. which question this is.
    note: str = ""
    extra: dict[str, Any] = field(default_factory=dict)


def policy_from_env(env: dict[str, str] | None = None,
                    mode: str = "record") -> ModelPolicy:
    """The model policy the server would run an ``llm`` attempt under."""
    env = dict(env if env is not None else os.environ)
    head = env.get("MEDIAL_LLM_HEAD_MODEL") or DEFAULT_HEAD_MODEL
    resident = env.get("MEDIAL_LLM_RESIDENT_MODEL") or DEFAULT_RESIDENT_MODEL
    return ModelPolicy(provider=LlmClient.provider, headModelId=head, residentModelId=resident,
                       temperature=float(env.get("MEDIAL_LLM_TEMPERATURE") or 0.2),
                       mode=mode)


class ModelProvider:
    """``(prompt, policy, spec) -> raw JSON text`` over the configured provider.

    One ``LlmClient`` per model id, built lazily, so the head and the residents
    share the key and the base URL and differ only in the model they ask.
    """

    def __init__(self, base: LlmClient, max_retries: int = 4) -> None:
        self._base = base
        self._clients: dict[str, LlmClient] = {}
        self.max_retries = max_retries
        self.calls = 0

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "ModelProvider":
        env = dict(env if env is not None else os.environ)
        return cls(LlmClient.from_env(env),
                   max_retries=int(env.get("MEDIAL_LLM_MAX_RETRIES") or 6))

    @property
    def available(self) -> bool:
        return self._base.available or bool(self._base._api_key)

    def describe(self, policy: ModelPolicy) -> dict[str, Any]:
        """Safe for a browser: which models, whether a key exists, never the key."""
        return {
            "provider": self._base.provider,
            "configured": self.available,
            "headModel": policy.headModelId,
            "residentModel": policy.residentModelId,
            "temperature": policy.temperature,
            "promptRevision": policy.promptRevisionId,
            "note": ("MEDial 머리는 큰 모델, 주민은 가벼운 모델을 쓴다. 키는 서버 환경변수에서만 "
                     "읽는다. 모델 호출은 전부 기록되고 재실행·분기는 기록을 재생한다."),
        }

    # -- the pre-flight check -------------------------------------------
    def verify_models(self, policy: ModelPolicy) -> list[str]:
        """Names Google does not offer. Empty means both tiers exist."""
        if not self.available:
            return [policy.headModelId, policy.residentModelId]
        import httpx  # lazy: the offline path must not need it

        url = self._base.base_url.rstrip("/") + "/models"
        response = httpx.get(url, timeout=self._base.timeout_s,
                             headers={"Authorization": "Bearer %s" % (self._base._api_key or "")})
        response.raise_for_status()
        offered = set()
        for row in response.json().get("data", []):
            name = str(row.get("id", ""))
            offered.add(name)
            offered.add(name.split("/", 1)[-1])
        return [m for m in (policy.headModelId, policy.residentModelId) if m not in offered]

    # -- the call ----------------------------------------------------------
    def _client(self, model_id: str) -> LlmClient:
        client = self._clients.get(model_id)
        if client is None:
            b = self._base
            client = LlmClient(model=model_id, api_key=b._api_key, base_url=b.base_url,
                               timeout_s=b.timeout_s, max_retries=b.max_retries)
            self._clients[model_id] = client
        return client

    def __call__(self, prompt: dict[str, Any], policy: ModelPolicy,
                 spec: CallSpec | None = None) -> str:
        if spec is None:
            raise ModelNotConfigured("모델 호출에 system prompt와 schema(CallSpec)가 없다.")
        if not self.available:
            raise ModelNotConfigured(
                "llm 어댑터를 골랐지만 서버에 모델 키가 없다. server/.env 를 보라.")
        model_id = policy.model_for(spec.role)
        client = self._client(model_id)
        # Same retry rule as the review client - a 429 or a 5xx is tried
        # again, anything else is the caller's failure to record - but with
        # more patience: the provider answers "high demand" 503s in bursts, and
        # a village day is a few dozen calls where one burst would end the run.
        import time
        raw = None
        for attempt in range(1, self.max_retries + 2):
            try:
                raw, _usage = client._post(spec.system, prompt, spec.schema,
                                           spec.schema_name, spec.max_tokens)
                break
            except Exception as exc:  # noqa: BLE001 - re-raised below
                if attempt <= self.max_retries and _retryable(exc):
                    time.sleep(min(3 * 2 ** (attempt - 1), 30))
                    continue
                raise
        self.calls += 1
        if raw is None:
            raise RuntimeError("모델이 빈 응답을 돌려주었다 (%s)" % model_id)
        # The log stores text; the adapter parses. A dict comes back from the
        # structured-output path, so it is serialised here rather than parsed
        # twice.
        return raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False)


__all__ = ["CallSpec", "ModelProvider", "policy_from_env", "DEFAULT_HEAD_MODEL",
           "DEFAULT_RESIDENT_MODEL"]
