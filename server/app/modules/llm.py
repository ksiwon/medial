"""Gemini LLM wrapper with primary→fallback timeout chain.

Uses the new google-genai unified SDK (google.genai). The older
google-generativeai package is deprecated.
"""
from __future__ import annotations
import asyncio
import logging
import json
import re
from typing import Any, Optional

from google import genai
from google.genai import types

from app.config import get_settings

log = logging.getLogger(__name__)


class GeminiLLM:
    def __init__(self) -> None:
        s = get_settings()
        if not s.GOOGLE_API_KEY:
            log.error("GOOGLE_API_KEY is not set — LLM calls will fail.")
        self.client = genai.Client(api_key=s.GOOGLE_API_KEY) if s.GOOGLE_API_KEY else None
        self.primary = s.LLM_PRIMARY_MODEL
        self.fallback = s.LLM_FALLBACK_MODEL
        self.timeout = s.LLM_TIMEOUT_SECONDS
        self.max_output = s.LLM_MAX_OUTPUT_TOKENS
        self.temperature = s.LLM_TEMPERATURE

    async def _generate(self, model: str, prompt: str, *, json_mode: bool = False) -> str:
        if self.client is None:
            return ""
        config = types.GenerateContentConfig(
            temperature=self.temperature,
            max_output_tokens=self.max_output,
            response_mime_type="application/json" if json_mode else "text/plain",
            # gemini-3.5-flash는 thinking 모델 — thinking 토큰이 출력 예산을 잠식해
            # JSON이 잘리고 지연이 커진다. 실시간 음성 동반자에는 thinking을 끈다.
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        )
        # Wrap the sync client call into an executor with timeout.
        loop = asyncio.get_event_loop()
        def _call() -> str:
            resp = self.client.models.generate_content(
                model=model,
                contents=prompt,
                config=config,
            )
            return (resp.text or "").strip()
        return await asyncio.wait_for(loop.run_in_executor(None, _call), timeout=self.timeout)

    async def generate_vision(
        self, prompt: str, image_bytes: bytes, mime_type: str = "image/jpeg",
        *, json_mode: bool = False,
    ) -> tuple[str, str]:
        """이미지 + 프롬프트 멀티모달 호출. 실패 시 ('', '') 반환."""
        if self.client is None:
            return "", ""
        config = types.GenerateContentConfig(
            temperature=self.temperature,
            max_output_tokens=self.max_output,
            response_mime_type="application/json" if json_mode else "text/plain",
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        )
        loop = asyncio.get_event_loop()
        def _call() -> str:
            resp = self.client.models.generate_content(
                model=self.primary,
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                    prompt,
                ],
                config=config,
            )
            return (resp.text or "").strip()
        try:
            text = await asyncio.wait_for(loop.run_in_executor(None, _call), timeout=self.timeout * 2)
            return text, self.primary
        except Exception as e:
            log.warning(f"vision call failed ({e!s})")
            return "", ""

    async def generate(self, prompt: str, *, json_mode: bool = False) -> tuple[str, str]:
        """Try primary; on timeout / error fall back. Returns (text, model_used)."""
        try:
            text = await self._generate(self.primary, prompt, json_mode=json_mode)
            if text:
                return text, self.primary
            raise RuntimeError("empty response")
        except asyncio.TimeoutError:
            log.warning(f"{self.primary} timed out after {self.timeout}s — falling back.")
        except Exception as e:
            log.warning(f"{self.primary} failed ({e!s}) — falling back.")

        try:
            # Fallback gets the full timeout window again
            text = await self._generate(self.fallback, prompt, json_mode=json_mode)
            return text, self.fallback
        except Exception as e:
            log.exception(f"Fallback {self.fallback} also failed: {e}")
            return "", ""

    @staticmethod
    def extract_json(text: str) -> Optional[dict[str, Any]]:
        if not text:
            return None
        # Try direct
        try:
            return json.loads(text)
        except Exception:
            pass
        # Strip code-fence markdown
        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return None
        return None


_llm: Optional[GeminiLLM] = None

def get_llm() -> GeminiLLM:
    global _llm
    if _llm is None:
        _llm = GeminiLLM()
    return _llm
