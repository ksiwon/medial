"""Wav2Lip avatar wrapper.

The exhibition plan uses Wav2Lip on the H100 to lip-sync a still
photo of MEDI to the TTS audio. Since Wav2Lip is non-trivial to
package (it requires the original repo + a pretrained checkpoint),
this module provides:

  * A `CssAvatar` no-op that signals "frontend should use CSS avatar"
    (this is the default — AVATAR_MODE=css in .env.example)
  * A `Wav2LipAvatar` stub that, when enabled (AVATAR_MODE=wav2lip),
    runs the Wav2Lip inference script via subprocess.

See README §"Avatar Setup" for installation steps.
"""
from __future__ import annotations
import asyncio
import base64
import logging
import os
import subprocess
import tempfile
import uuid
from typing import Optional

from app.config import get_settings

log = logging.getLogger(__name__)


class _AvatarBase:
    mode: str = "css"

    async def render(self, audio_bytes: bytes) -> Optional[str]:
        """Return base64-encoded mp4 of the talking avatar, or None."""
        return None


class CssAvatar(_AvatarBase):
    mode = "css"

    async def render(self, audio_bytes: bytes) -> Optional[str]:
        # No-op: frontend uses its CSS-animated VirtualDoctor.
        return None


class Wav2LipAvatar(_AvatarBase):
    mode = "wav2lip"

    def __init__(self) -> None:
        s = get_settings()
        self.checkpoint = s.WAV2LIP_CHECKPOINT_PATH
        self.face_image = s.WAV2LIP_FACE_IMAGE_PATH
        self.fps = s.WAV2LIP_FPS
        self.resolution = s.WAV2LIP_RESOLUTION
        if not os.path.exists(self.checkpoint):
            log.error(f"Wav2Lip checkpoint missing: {self.checkpoint}")
        if not os.path.exists(self.face_image):
            log.error(f"Face image missing: {self.face_image}")

    def _run_sync(self, audio_bytes: bytes) -> Optional[str]:
        if not (os.path.exists(self.checkpoint) and os.path.exists(self.face_image)):
            return None
        # Wav2Lip expects file-on-disk for audio + face + output.
        tmp = tempfile.mkdtemp(prefix="wav2lip_")
        audio_path = os.path.join(tmp, "input.wav")
        out_path = os.path.join(tmp, f"out_{uuid.uuid4().hex[:8]}.mp4")
        with open(audio_path, "wb") as f:
            f.write(audio_bytes)
        try:
            # Original Rudrabha/Wav2Lip exposes `inference.py`. Adapt the
            # checkpoint dir / script location to where you cloned the repo.
            subprocess.run(
                [
                    "python", "Wav2Lip/inference.py",
                    "--checkpoint_path", self.checkpoint,
                    "--face", self.face_image,
                    "--audio", audio_path,
                    "--outfile", out_path,
                    "--resize_factor", "1",
                    "--fps", str(self.fps),
                    "--pads", "0", "10", "0", "0",
                ],
                check=True,
                capture_output=True,
                timeout=10,
            )
            with open(out_path, "rb") as f:
                return base64.b64encode(f.read()).decode("ascii")
        except subprocess.TimeoutExpired:
            log.warning("Wav2Lip inference timed out — falling back to CSS avatar.")
            return None
        except subprocess.CalledProcessError as e:
            log.error(f"Wav2Lip failed: {e.stderr.decode(errors='ignore')[:300]}")
            return None
        finally:
            try:
                import shutil
                shutil.rmtree(tmp, ignore_errors=True)
            except Exception:
                pass

    async def render(self, audio_bytes: bytes) -> Optional[str]:
        if not audio_bytes:
            return None
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._run_sync, audio_bytes)


_avatar: Optional[_AvatarBase] = None

def get_avatar() -> _AvatarBase:
    global _avatar
    if _avatar is None:
        mode = get_settings().AVATAR_MODE.lower()
        _avatar = Wav2LipAvatar() if mode == "wav2lip" else CssAvatar()
        log.info(f"Avatar mode: {_avatar.mode}")
    return _avatar
