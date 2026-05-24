"""OpenAI Text-to-Speech for MEDI.

Uses the steerable `gpt-4o-mini-tts` model with WAV output so the
frontend can play the bytes directly via Web Audio API. The persona
is injected through the `instructions` parameter so MEDI sounds like
a warm Korean village doctor.

Korean is well-supported by the gpt-4o-mini-tts model.
"""
from __future__ import annotations
import asyncio
import base64
import logging
from typing import Optional

from openai import OpenAI

from app.config import get_settings

log = logging.getLogger(__name__)


class OpenAITTS:
    def __init__(self) -> None:
        s = get_settings()
        if not s.OPENAI_API_KEY:
            log.error("OPENAI_API_KEY is not set — TTS will fail.")
            self.client: Optional[OpenAI] = None
        else:
            try:
                self.client = OpenAI(api_key=s.OPENAI_API_KEY)
            except Exception as e:
                log.error(f"Failed to init OpenAI client: {e}")
                self.client = None

        self.model = s.TTS_MODEL
        self.voice = s.TTS_VOICE
        self.speed = s.TTS_SPEED
        self.response_format = s.TTS_RESPONSE_FORMAT
        self.instructions = s.TTS_INSTRUCTIONS

    def _synthesize_sync(self, text: str, speed: Optional[float] = None) -> Optional[bytes]:
        if not self.client or not text:
            return None
        try:
            spd = self.speed if speed is None else max(0.5, min(2.0, speed))
            kwargs: dict = {
                "model": self.model,
                "voice": self.voice,
                "input": text,
                "response_format": self.response_format,
                "speed": spd,
            }
            # `instructions` is only supported by gpt-4o-mini-tts;
            # passing it to tts-1 / tts-1-hd raises a 400.
            if self.model.startswith("gpt-4o") and self.instructions:
                kwargs["instructions"] = self.instructions

            resp = self.client.audio.speech.create(**kwargs)
            return resp.content
        except Exception as e:
            log.exception(f"OpenAI TTS synth failed: {e}")
            return None

    async def synthesize(self, text: str, speed: Optional[float] = None) -> Optional[bytes]:
        if not text:
            return None
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._synthesize_sync, text, speed)

    async def synthesize_b64(self, text: str, speed: Optional[float] = None) -> Optional[str]:
        audio = await self.synthesize(text, speed)
        if audio is None:
            return None
        return base64.b64encode(audio).decode("ascii")


_tts: Optional[OpenAITTS] = None

def get_tts() -> OpenAITTS:
    global _tts
    if _tts is None:
        _tts = OpenAITTS()
    return _tts
