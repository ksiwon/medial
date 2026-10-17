"""Asking the model, for the tools that write the exhibition's words ahead of time.

``gen_week_dialogue.py`` and ``gen_week_evaluations.py`` are the only things in this repository that call a model.
The server never does: it reads what they wrote. So the call lives here, beside them, and not in the server.

One provider, OpenAI, called straight over HTTP (chat completions with a JSON schema) rather than through a vendor
SDK, so it does not drift when an SDK's major version does. The key is read from ``server/.env`` (or the
environment) and goes nowhere else - not into a file this writes, not into a message. A failed call is a failure:
there is no silent fallback to some other answer.

Model names move more often than this file does - check OpenAI's current list before changing the default.
"""
from __future__ import annotations

import io
import json
import os
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "https://api.openai.com/v1"
#: Where the judgement is the result, the larger tier (D107); the exhibition's words are all written at it.
DEFAULT_MODEL = "gpt-6.1-sol"
TIMEOUT_S = 60.0
MAX_RETRIES = 6


class ModelNotConfigured(RuntimeError):
    """No key: say so and stop, rather than write words nobody asked a model for."""


def read_env() -> dict[str, str]:
    """The process environment, plus ``server/.env``'s ``KEY=value`` lines (values already set win)."""
    env = dict(os.environ)
    dotenv = ROOT / "server" / ".env"
    if dotenv.exists():
        for line in io.open(dotenv, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return env


class Model:
    """One model, asked for one JSON object at a time."""

    def __init__(self, env: dict[str, str] | None = None) -> None:
        env = env if env is not None else read_env()
        self.key = env.get("OPENAI_API_KEY") or None
        self.id = env.get("MEDIAL_LLM_HEAD_MODEL") or DEFAULT_MODEL
        self.base_url = env.get("MEDIAL_LLM_BASE_URL") or BASE_URL
        if not self.key:
            raise ModelNotConfigured("OPENAI_API_KEY 가 없습니다. server/.env 에 두세요.")

    def ask(self, system: str, payload: dict[str, Any], schema: dict[str, Any], name: str, max_tokens: int = 2048) -> dict[str, Any]:
        """One JSON object matching ``schema``. A 429, a 5xx or a dropped connection is tried again; anything else
        is the caller's failure."""
        last: Exception | None = None
        for attempt in range(1, MAX_RETRIES + 2):
            try:
                result = self._post(system, payload, schema, name, max_tokens)
            except Exception as exc:  # noqa: BLE001 - re-raised below when it is not worth another try
                last = exc
                if attempt <= MAX_RETRIES and _retryable(exc):
                    time.sleep(min(3 * 2 ** (attempt - 1), 30))
                    continue
                raise
            if isinstance(result, dict):
                return result
            last = RuntimeError("모델이 JSON 객체가 아닌 것을 돌려주었다 (%s)" % type(result).__name__)
        raise RuntimeError("모델 호출이 %d회 시도 후 실패했다: %s" % (MAX_RETRIES + 1, last))

    def _post(self, system: str, payload: dict[str, Any], schema: dict[str, Any], name: str, max_tokens: int) -> Any:
        """One chat completion, received as a stream. Streamed so the connection is never silent: somewhere between
        this machine and the provider an idle connection is cut at 60 s, and a long answer thinks for longer than
        that before its first word (2026-09-28). ``TIMEOUT_S`` is the longest wait *between* chunks."""
        import httpx

        body = {
            "model": self.id,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
            "response_format": {"type": "json_schema", "json_schema": {"name": name, "schema": schema}},
            "stream": True,
        }
        parts: list[str] = []
        with httpx.stream("POST", self.base_url.rstrip("/") + "/chat/completions", json=body, timeout=TIMEOUT_S,
                          headers={"Authorization": "Bearer %s" % self.key, "content-type": "application/json"}) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if not line.startswith("data: ") or line == "data: [DONE]":
                    continue
                for choice in json.loads(line[len("data: "):]).get("choices") or []:
                    parts.append((choice.get("delta") or {}).get("content") or "")
        text = "".join(parts)
        return json.loads(text) if text else None


def _retryable(exc: Exception) -> bool:
    """A 429, a 5xx, or a request that may never have reached the model."""
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if status is not None:
        return status == 429 or status >= 500
    import httpx

    return isinstance(exc, httpx.TransportError)
