"""Model access for the review and improvement roles - Gemini only.

Three rules are enforced here rather than trusted to the caller:

* **the key is read from the server environment and never leaves it.** It is not
  in any response, any log line, any stored call record or any document;
* **a failed online call is a failure.** There is no silent fallback to the
  scripted adapter. If a session was configured to use a model and the model is
  unreachable, the session stops with ``model_failure`` and says so;
* **every call is recorded** - provider, model id, prompt version, request and
  response content hashes, token usage, latency, and whether the response
  validated. The bodies themselves stay out of the public export.

The HTTP calls go straight to Gemini's OpenAI-compatible chat endpoint (it
accepts ``response_format: json_schema``), not through a vendor SDK, so the code
does not drift when an SDK's major version changes. There is one provider on
purpose: a second one was more to keep straight than it was worth (2026-09-15),
and adding one back is a small, separate change. Model names change more often
than this file does - check Google's current list before changing a default.
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

PROVIDER = "google"

#: Default only. Model ids move; ``MEDIAL_LLM_MODEL`` overrides this and the
#: health endpoint reports whichever one is actually configured. Checked against
#: Google's model list on 2026-09-15.
#:
#: The mid tier is the default on purpose. A generation asks for one review per
#: actor (13) plus a synthesis and a proposal round, so a cycle is tens of calls,
#: and the work is grounded extraction - read these events, grade these six
#: dimensions, cite the event ids - rather than open-ended reasoning.
DEFAULT_MODEL = "gemini-3.8-flash"

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"


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
        self.base_url = base_url or GEMINI_BASE_URL
        self.timeout_s = timeout_s
        self.max_retries = max_retries

    # -- configuration ----------------------------------------------------
    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "LlmClient":
        env = dict(env if env is not None else os.environ)
        key = env.get("GOOGLE_API_KEY") or None
        base = env.get("MEDIAL_LLM_BASE_URL") or GEMINI_BASE_URL
        model = env.get("MEDIAL_LLM_MODEL") or DEFAULT_MODEL
        timeout = float(env.get("MEDIAL_LLM_TIMEOUT_S") or DEFAULT_TIMEOUT_S)
        return cls(model=model, api_key=key, base_url=base, timeout_s=timeout)

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
            "envKeys": ["GOOGLE_API_KEY", "MEDIAL_LLM_MODEL", "MEDIAL_LLM_BASE_URL"],
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
                "서버 환경변수 GOOGLE_API_KEY(그리고 필요하면 MEDIAL_LLM_MODEL)를 "
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
        }
        response = httpx.post(
            self.base_url.rstrip("/") + "/chat/completions", json=body,
            timeout=self.timeout_s,
            headers={"Authorization": "Bearer %s" % (self._api_key or ""),
                     "content-type": "application/json"})
        response.raise_for_status()
        data = response.json()
        usage = {"input": (data.get("usage") or {}).get("prompt_tokens", 0),
                 "output": (data.get("usage") or {}).get("completion_tokens", 0)}
        text = (data.get("choices") or [{}])[0].get("message", {}).get("content")
        return (json.loads(text) if text else None), usage


def _retryable(exc: Exception) -> bool:
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if status is not None:
        return status == 429 or status >= 500
    return "timeout" in type(exc).__name__.lower() or "connect" in type(exc).__name__.lower()
