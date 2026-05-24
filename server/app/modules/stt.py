"""Whisper STT — large-v3-turbo via 🤗 transformers pipeline.

Audio chunks arrive from the browser as webm/opus binary frames. We
decode them with FFmpeg into 16 kHz mono PCM, optionally pre-filter
with Silero VAD, then run Whisper.
"""
from __future__ import annotations
import io
import logging
import shutil
import subprocess
import tempfile
import os
from typing import Optional

import numpy as np
import soundfile as sf
import torch
from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline

from app.config import get_settings

log = logging.getLogger(__name__)
_SR = 16_000


class WhisperSTT:
    def __init__(self) -> None:
        s = get_settings()
        self.device = s.STT_DEVICE if torch.cuda.is_available() or s.STT_DEVICE != "cuda" else "cpu"
        if self.device == "cpu":
            log.warning("CUDA not available — falling back to CPU (slow).")

        dtype_map = {"float16": torch.float16, "float32": torch.float32, "bfloat16": torch.bfloat16}
        torch_dtype = dtype_map.get(s.STT_DTYPE, torch.float16) if self.device != "cpu" else torch.float32

        log.info(f"Loading Whisper '{s.STT_MODEL_ID}' on {self.device} ({s.STT_DTYPE})...")
        model = AutoModelForSpeechSeq2Seq.from_pretrained(
            s.STT_MODEL_ID,
            torch_dtype=torch_dtype,
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
        self.language = s.STT_LANGUAGE
        self.initial_prompt = s.STT_INITIAL_PROMPT
        self.vad_enabled = s.STT_VAD_ENABLED
        self.ffmpeg = self._resolve_ffmpeg()
        self._vad_model = None
        if self.vad_enabled:
            self._load_vad()
        log.info("Whisper ready.")

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

    # ── Public API ──────────────────────────────────────────
    def decode_webm_chunks(self, chunks: list[bytes]) -> Optional[np.ndarray]:
        """webm/opus binary → 16 kHz mono float32 numpy array."""
        if not chunks:
            return None
        blob = b"".join(chunks)
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as fin:
            fin.write(blob)
            fin_path = fin.name
        try:
            proc = subprocess.run(
                [self.ffmpeg, "-y", "-i", fin_path, "-f", "wav", "-ar", str(_SR), "-ac", "1", "pipe:1"],
                capture_output=True,
                check=True,
            )
            audio, sr = sf.read(io.BytesIO(proc.stdout), dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            if sr != _SR:
                # shouldn't happen given ffmpeg -ar, but guard anyway
                import librosa
                audio = librosa.resample(audio, orig_sr=sr, target_sr=_SR)
            return audio
        except subprocess.CalledProcessError as e:
            log.error(f"ffmpeg decode failed: {e.stderr.decode(errors='ignore')[:300]}")
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
            tensor = torch.from_numpy(audio).float()
            speech = get_speech_timestamps(tensor, self._vad_model, sampling_rate=_SR)
            if not speech:
                return audio
            start = speech[0]["start"]
            end = speech[-1]["end"]
            return audio[start:end]
        except Exception as e:
            log.warning(f"VAD failed (using raw audio): {e}")
            return audio

    def transcribe(self, audio: np.ndarray) -> str:
        if audio is None or len(audio) < _SR // 4:
            return ""
        audio = self._trim_silence_vad(audio)
        try:
            generate_kwargs = {"language": self.language, "task": "transcribe"}
            if self.initial_prompt:
                # Whisper's "initial_prompt" is exposed via `prompt_ids`
                tokenizer = self.pipe.tokenizer
                prompt_ids = tokenizer.get_prompt_ids(self.initial_prompt, return_tensors="pt").to(self.device)
                generate_kwargs["prompt_ids"] = prompt_ids
            result = self.pipe(
                {"raw": audio, "sampling_rate": _SR},
                generate_kwargs=generate_kwargs,
                chunk_length_s=30,
                batch_size=1,
            )
            text = result.get("text", "").strip()
            return text
        except Exception as e:
            log.exception(f"Whisper transcription failed: {e}")
            return ""


_stt: Optional[WhisperSTT] = None

def get_stt() -> WhisperSTT:
    global _stt
    if _stt is None:
        _stt = WhisperSTT()
    return _stt
