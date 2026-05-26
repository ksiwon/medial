"""STT 모듈 — 실행 환경에 따라 구현체를 선택한다.

  RUN_MODE=gpu_server  →  WhisperSTT   (HF transformers, 로컬 GPU/CPU 추론)
  RUN_MODE=notebook    →  OpenAISTT    (openai.audio.transcriptions, API 호출)

공통 인터페이스:
    await stt.transcribe_chunks(chunks: list[bytes]) -> str
        webm/opus 바이너리 프레임 리스트를 받아 한국어 텍스트를 반환한다.

기존의 decode_webm_chunks / transcribe 메서드는 WhisperSTT에 그대로 유지되므로
직접 호출하는 코드는 수정 없이 동작한다.
"""
from __future__ import annotations
import asyncio
import io
import logging
import os
import shutil
import subprocess
import tempfile
from typing import Optional

import numpy as np

from app.config import get_settings

log = logging.getLogger(__name__)
_SR = 16_000


# ─────────────────────────────────────────────────────────────
# GPU 서버 — 로컬 HuggingFace Whisper
# ─────────────────────────────────────────────────────────────
class WhisperSTT:
    """transformers pipeline 기반 로컬 Whisper (gpu_server 전용)."""

    def __init__(self) -> None:
        import torch
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline

        s = get_settings()
        self.device = s.STT_DEVICE if torch.cuda.is_available() or s.STT_DEVICE != "cuda" else "cpu"
        if self.device == "cpu":
            log.warning("CUDA not available — falling back to CPU (slow).")

        dtype_map = {
            "float16": torch.float16,
            "float32": torch.float32,
            "bfloat16": torch.bfloat16,
        }
        torch_dtype = (
            dtype_map.get(s.STT_DTYPE, torch.float16)
            if self.device != "cpu"
            else torch.float32
        )

        log.info(f"Loading Whisper '{s.STT_MODEL_ID}' on {self.device} ({s.STT_DTYPE})...")
        model = AutoModelForSpeechSeq2Seq.from_pretrained(
            s.STT_MODEL_ID,
            dtype=torch_dtype,
            low_cpu_mem_usage=True,
            use_safetensors=True,
        ).to(self.device)
        processor = AutoProcessor.from_pretrained(s.STT_MODEL_ID)

        self.pipe = pipeline(
            "automatic-speech-recognition",
            model=model,
            tokenizer=processor.tokenizer,
            feature_extractor=processor.feature_extractor,
            torch_dtype=torch_dtype,
            device=self.device,
        )
        self._torch = torch
        self.language = s.STT_LANGUAGE
        self.initial_prompt = s.STT_INITIAL_PROMPT
        self.vad_enabled = s.STT_VAD_ENABLED
        self.ffmpeg = self._resolve_ffmpeg()
        self._vad_model = None
        if self.vad_enabled:
            self._load_vad()
        log.info("Whisper ready.")

    # ── private ──────────────────────────────────────────
    def _resolve_ffmpeg(self) -> str:
        s = get_settings()
        if s.FFMPEG_BINARY:
            return s.FFMPEG_BINARY
        which = shutil.which("ffmpeg")
        if which:
            return which
        try:
            from imageio_ffmpeg import get_ffmpeg_exe
            return get_ffmpeg_exe()
        except Exception:
            log.error("ffmpeg binary not found. Install ffmpeg or pip install imageio-ffmpeg.")
            return "ffmpeg"

    def _load_vad(self) -> None:
        try:
            from silero_vad import load_silero_vad
            self._vad_model = load_silero_vad()
            log.info("Silero VAD loaded.")
        except Exception as e:
            log.warning(f"Could not load Silero VAD: {e}")
            self.vad_enabled = False

    # ── public (레거시 호환) ──────────────────────────────
    def decode_webm_chunks(self, chunks: list[bytes]) -> Optional[np.ndarray]:
        """webm/opus binary → 16 kHz mono float32 numpy array."""
        if not chunks:
            return None
        import soundfile as sf
        blob = b"".join(chunks)
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as fin:
            fin.write(blob)
            fin_path = fin.name
        try:
            proc = subprocess.run(
                [self.ffmpeg, "-y", "-i", fin_path,
                 "-f", "wav", "-ar", str(_SR), "-ac", "1", "pipe:1"],
                capture_output=True,
                check=True,
            )
            audio, sr = sf.read(io.BytesIO(proc.stdout), dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            if sr != _SR:
                import librosa
                audio = librosa.resample(audio, orig_sr=sr, target_sr=_SR)
            return audio
        except subprocess.CalledProcessError as e:
            log.error(f"ffmpeg decode failed: {e.stderr.decode(errors='ignore')[:2000]}")
            return None
        finally:
            try:
                os.unlink(fin_path)
            except OSError:
                pass

    def _trim_silence_vad(self, audio: np.ndarray) -> np.ndarray:
        if not self.vad_enabled or self._vad_model is None or len(audio) < _SR:
            return audio
        try:
            from silero_vad import get_speech_timestamps
            tensor = self._torch.from_numpy(audio).float()
            speech = get_speech_timestamps(tensor, self._vad_model, sampling_rate=_SR)
            if not speech:
                return audio
            return audio[speech[0]["start"]: speech[-1]["end"]]
        except Exception as e:
            log.warning(f"VAD failed (using raw audio): {e}")
            return audio

    def transcribe(self, audio: np.ndarray) -> str:
        if audio is None or len(audio) < _SR // 4:
            return ""
        audio = self._trim_silence_vad(audio)
        try:
            generate_kwargs: dict = {"language": self.language, "task": "transcribe"}
            if self.initial_prompt:
                tokenizer = self.pipe.tokenizer
                prompt_ids = tokenizer.get_prompt_ids(
                    self.initial_prompt, return_tensors="pt"
                ).to(self.device)
                generate_kwargs["prompt_ids"] = prompt_ids
            result = self.pipe(
                {"raw": audio, "sampling_rate": _SR},
                generate_kwargs=generate_kwargs,
                chunk_length_s=30,
                batch_size=1,
            )
            return result.get("text", "").strip()
        except Exception as e:
            log.exception(f"Whisper transcription failed: {e}")
            return ""

    # ── unified async interface ──────────────────────────
    async def transcribe_chunks(self, chunks: list[bytes]) -> str:
        """webm 청크 리스트 → 텍스트. 블로킹 작업은 executor에서 실행."""
        loop = asyncio.get_event_loop()

        def _run() -> str:
            pcm = self.decode_webm_chunks(chunks)
            return self.transcribe(pcm) if pcm is not None else ""

        return await loop.run_in_executor(None, _run)


# ─────────────────────────────────────────────────────────────
# 노트북 — OpenAI Whisper API
# ─────────────────────────────────────────────────────────────
class OpenAISTT:
    """OpenAI audio.transcriptions API 기반 STT (notebook 전용).

    브라우저 MediaRecorder webm 청크는 단독으로는 EBML 헤더가 없어 OpenAI API에
    직접 전송하면 400 "Invalid file format"이 발생한다.
    → ffmpeg로 WAV 변환 후 전송 (imageio-ffmpeg 번들 사용).
    """

    def __init__(self) -> None:
        from openai import AsyncOpenAI
        s = get_settings()
        if not s.OPENAI_API_KEY:
            log.error("OPENAI_API_KEY가 설정되지 않아 STT API 호출이 실패합니다.")
        self._client = AsyncOpenAI(api_key=s.OPENAI_API_KEY)
        self.model = s.STT_OPENAI_MODEL
        self.language = s.STT_LANGUAGE
        self.initial_prompt = s.STT_INITIAL_PROMPT or None
        self.ffmpeg = self._resolve_ffmpeg()
        log.info(f"OpenAI Whisper API STT ready (model={self.model}, ffmpeg={self.ffmpeg}).")

    def _resolve_ffmpeg(self) -> str:
        s = get_settings()
        if s.FFMPEG_BINARY:
            return s.FFMPEG_BINARY
        which = shutil.which("ffmpeg")
        if which:
            return which
        try:
            from imageio_ffmpeg import get_ffmpeg_exe
            return get_ffmpeg_exe()
        except Exception:
            log.warning("ffmpeg를 찾을 수 없습니다. pip install imageio-ffmpeg 로 설치하세요.")
            return "ffmpeg"

    def _chunks_to_wav(self, chunks: list[bytes]) -> Optional[bytes]:
        """webm 청크 리스트 → WAV bytes (ffmpeg 변환, 동기)."""
        blob = b"".join(chunks)
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as fin:
            fin.write(blob)
            fin_path = fin.name
        try:
            proc = subprocess.run(
                [self.ffmpeg, "-y", "-i", fin_path,
                 "-f", "wav", "-ar", "16000", "-ac", "1", "pipe:1"],
                capture_output=True,
            )
            if proc.returncode != 0:
                log.error(f"ffmpeg error: {proc.stderr.decode(errors='ignore')[:2000]}")
                return None
            return proc.stdout
        finally:
            try:
                os.unlink(fin_path)
            except OSError:
                pass

    async def transcribe_chunks(self, chunks: list[bytes]) -> str:
        """webm 청크 리스트 → WAV 변환 → OpenAI API → 텍스트."""
        if not chunks:
            return ""
        loop = asyncio.get_event_loop()
        wav_bytes = await loop.run_in_executor(None, self._chunks_to_wav, chunks)
        if not wav_bytes:
            return ""
        try:
            import io
            result = await self._client.audio.transcriptions.create(
                model=self.model,
                file=("audio.wav", io.BytesIO(wav_bytes), "audio/wav"),
                language=self.language,
                prompt=self.initial_prompt,
            )
            return result.text.strip()
        except Exception as e:
            log.exception(f"OpenAI STT failed: {e}")
            return ""

    def decode_webm_chunks(self, chunks: list[bytes]) -> Optional[bytes]:
        return b"".join(chunks) if chunks else None

    def transcribe(self, audio) -> str:
        log.warning("OpenAISTT.transcribe() 동기 호출 — transcribe_chunks()를 사용하세요.")
        return ""


# ─────────────────────────────────────────────────────────────
# 싱글턴 팩토리
# ─────────────────────────────────────────────────────────────
_stt: Optional[WhisperSTT | OpenAISTT] = None


def get_stt() -> WhisperSTT | OpenAISTT:
    global _stt
    if _stt is None:
        s = get_settings()
        if s.is_notebook:
            _stt = OpenAISTT()
        else:
            _stt = WhisperSTT()
    return _stt
