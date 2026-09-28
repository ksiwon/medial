"""Model access for the review and improvement roles - OpenAI only.

Three rules are enforced here rather than trusted to the caller:

* **the key is read from the server environment and never leaves it.** It is not
  in any response, any log line, any stored call record or any document;
* **a failed online call is a failure.** There is no silent fallback to the
  scripted adapter. If a session was configured to use a model and the model is
  unreachable, the session stops with ``model_failure`` and says so;
* **every call is recorded** - provider, model id, prompt version, request and
  response content hashes, token usage, latency, and whether the response
  validated. The bodies themselves stay out of the public export.

The HTTP calls go straight to OpenAI's chat completions endpoint (it accepts
``response_format: json_schema``), not through a vendor SDK, so the code does not
drift when an SDK's major version changes. There is one provider on purpose: a
second one was more to keep straight than it was worth (D107). Model names
change more often than this file does - check OpenAI's current list before
changing a default.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

#: Bumped whenever a role prompt changes in a way that could change the output.
PROMPT_VERSION = "medial-prompts/1.0.0"

DEFAULT_TIMEOUT_S = 60.0
DEFAULT_MAX_TOKENS = 2048

PROVIDER = "openai"

#: Default only. Model ids move; ``MEDIAL_LLM_MODEL`` overrides this and the
#: health endpoint reports whichever one is actually configured. Checked against
#: OpenAI's model list on 2026-09-28.
#:
#: Two tiers are used across the project: ``gpt-6-sol`` where the judgement is
#: the result, ``gpt-6-luna`` where a lighter model is enough. Reviews are the
#: research's evaluations - a resident's grade and the events it cites are what
#: the whole study reads - and a proposal round reasons over all of them, so this
#: role takes the higher tier. A cycle is tens of calls (13 reviews, a synthesis,
#: a proposal round), which is affordable at that tier.
DEFAULT_MODEL = "gpt-6-sol"

OPENAI_BASE_URL = "https://api.openai.com/v1"


class ModelNotConfigured(RuntimeError):
    """No key or provider is configured. Offline is a mode, not an error -
    but asking for an online adapter without a key is."""


class ModelCallError(RuntimeError):
    """The model was configured but the call did not produce a valid result.

    Never resolved by substituting a scripted answer. The caller records the
    failure and stops.
    """


class BudgetExhausted(RuntimeError):
    """The session's call or token budget ran out mid-loop."""


def content_hash(obj: Any) -> str:
    payload = json.dumps(obj, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


@dataclass
class ModelCallRecord:
    """What gets stored about one call. No prompt or completion text."""

    id: str
    sessionId: str | None
    generationIndex: int | None
    role: str
    subject: str | None
    provider: str
    model: str
    promptVersion: str
    requestHash: str
    responseHash: str | None
    inputRefs: list[str] = field(default_factory=list)
    inputTokens: int = 0
    outputTokens: int = 0
    latencyMs: int = 0
    attempts: int = 1
    status: str = "ok"          # ok | invalid_response | error
    error: str | None = None
    createdAt: str = ""

    def as_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


@dataclass
class ModelResult:
    data: dict[str, Any]
    record: ModelCallRecord


class LlmClient:
    """One client, several roles. Roles differ by prompt and schema, not by key."""

    provider = PROVIDER

    def __init__(self, model: str | None = None, api_key: str | None = None,
                 base_url: str | None = None, timeout_s: float = DEFAULT_TIMEOUT_S,
                 max_retries: int = 2) -> None:
        self.model = model or ""
        self._api_key = api_key
        self.base_url = base_url or OPENAI_BASE_URL
        self.timeout_s = timeout_s
        self.max_retries = max_retries

    # -- configuration ----------------------------------------------------
    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "LlmClient":
        env = dict(env if env is not None else os.environ)
        key = env.get("OPENAI_API_KEY") or None
        base = env.get("MEDIAL_LLM_BASE_URL") or OPENAI_BASE_URL
        model = env.get("MEDIAL_LLM_MODEL") or DEFAULT_MODEL
        timeout = float(env.get("MEDIAL_LLM_TIMEOUT_S") or DEFAULT_TIMEOUT_S)
        # The same patience as the village's calls (provider.py): a cycle is
        # tens of calls, and one dropped connection should not end it.
        retries = int(env.get("MEDIAL_LLM_MAX_RETRIES") or 6)
        return cls(model=model, api_key=key, base_url=base, timeout_s=timeout,
                   max_retries=retries)

    @property
    def available(self) -> bool:
        return bool(self._api_key and self.model)

    def describe(self) -> dict[str, Any]:
        """Safe to serve to a browser: says whether a key is present, never what."""
        return {
            "provider": self.provider,
            "model": self.model or None,
            "configured": self.available,
            "promptVersion": PROMPT_VERSION,
            "baseUrl": self.base_url or None,
            "note": ("키는 서버 환경변수에서만 읽고 응답·로그·문서에 포함하지 않는다. "
                     "키가 없으면 온라인 어댑터를 선택할 수 없고, 실패를 scripted 성공으로 "
                     "대체하지 않는다."),
            "envKeys": ["OPENAI_API_KEY", "MEDIAL_LLM_MODEL", "MEDIAL_LLM_BASE_URL"],
        }

    # -- the call ---------------------------------------------------------
    def complete_json(self, *, role: str, system: str, payload: dict[str, Any],
                      schema: dict[str, Any], schema_name: str,
                      session_id: str | None = None,
                      generation_index: int | None = None,
                      subject: str | None = None,
                      input_refs: list[str] | None = None,
                      created_at: str = "",
                      max_tokens: int = DEFAULT_MAX_TOKENS) -> ModelResult:
        """Ask for one JSON object matching ``schema``.

        The user turn is JSON *data*, and the system prompt says so: anything
        inside it is village material, never an instruction. The boundaries that
        matter - which events an actor may cite and which Quest/Task rules a Change Set may
        touch - are re-checked in code afterwards, because a sentence in a prompt
        is not an access control mechanism.
        """
        if not self.available:
            raise ModelNotConfigured(
                "온라인 어댑터를 선택했지만 모델 키·모델 id가 설정되지 않았다. "
                "서버 환경변수 OPENAI_API_KEY(그리고 필요하면 MEDIAL_LLM_MODEL)를 "
                "설정하거나 rule/scripted 어댑터로 실행한다.")

        request_body = {"system": system, "payload": payload, "schema": schema_name}
        request_hash = content_hash(request_body)
        started = time.monotonic()
        last_error: str | None = None

        for attempt in range(1, self.max_retries + 2):
            try:
                raw, usage = self._post(system, payload, schema, schema_name, max_tokens)
            except Exception as exc:  # noqa: BLE001 - recorded, then re-raised below
                last_error = "%s: %s" % (type(exc).__name__, exc)
                if attempt <= self.max_retries and _retryable(exc):
                    time.sleep(min(2 ** attempt, 8))
                    continue
                break
            if isinstance(raw, dict):
                record = ModelCallRecord(
                    id="call-%s" % uuid.uuid4().hex[:12],
                    sessionId=session_id, generationIndex=generation_index,
                    role=role, subject=subject, provider=self.provider,
                    model=self.model, promptVersion=PROMPT_VERSION,
                    requestHash=request_hash, responseHash=content_hash(raw),
                    inputRefs=list(input_refs or []),
                    inputTokens=int(usage.get("input", 0)),
                    outputTokens=int(usage.get("output", 0)),
                    latencyMs=int((time.monotonic() - started) * 1000),
                    attempts=attempt, status="ok", createdAt=created_at)
                return ModelResult(data=raw, record=record)
            last_error = "model returned %s, not a JSON object" % type(raw).__name__

        raise ModelCallError(
            "%s 역할의 모델 호출이 %d회 시도 후 실패했다: %s"
            % (role, self.max_retries + 1, last_error))

    # -- the wire ---------------------------------------------------------
    def _post(self, system: str, payload: dict[str, Any], schema: dict[str, Any],
              schema_name: str, max_tokens: int) -> tuple[Any, dict[str, int]]:
        """One chat completion, received as a stream.

        Streamed so the connection is never silent: somewhere between this
        machine and the provider an idle connection is cut at 60 s, and a
        higher-tier synthesis thinks for longer than that before its first
        word. Unstreamed, that call was dropped at 60.7 s every time
        ("Server disconnected without sending a response"), whatever the
        client's own timeout; streamed, the same call answered in 74 s
        (2026-09-28). ``timeout_s`` is therefore the longest wait *between*
        chunks, not for the whole answer.
        """
        import httpx  # imported lazily: the offline path must not need it

        user = json.dumps(payload, ensure_ascii=False)
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": user}],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": schema_name, "schema": schema},
            },
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        parts: list[str] = []
        usage: dict[str, Any] = {}
        with httpx.stream(
                "POST", self.base_url.rstrip("/") + "/chat/completions", json=body,
                timeout=self.timeout_s,
                headers={"Authorization": "Bearer %s" % (self._api_key or ""),
                         "content-type": "application/json"}) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if not line.startswith("data: ") or line == "data: [DONE]":
                    continue
                chunk = json.loads(line[len("data: "):])
                usage = chunk.get("usage") or usage
                for choice in chunk.get("choices") or []:
                    parts.append((choice.get("delta") or {}).get("content") or "")
        text = "".join(parts)
        return (json.loads(text) if text else None), {
            "input": usage.get("prompt_tokens", 0), "output": usage.get("completion_tokens", 0)}


def _retryable(exc: Exception) -> bool:
    """A 429, a 5xx, or a request that may never have reached the model."""
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if status is not None:
        return status == 429 or status >= 500
    # A dropped connection, a read that never came back, a timeout: httpx calls
    # all of them TransportError. Matching on the class name used to miss
    # RemoteProtocolError ("Server disconnected without sending a response"),
    # which ended a live session on its first review (2026-09-28).
    import httpx  # lazy: the offline path must not need it

    return isinstance(exc, httpx.TransportError)
