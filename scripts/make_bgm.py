"""The exhibition's background sound: a quiet, slow pad that loops without a seam.

    python scripts/make_bgm.py        # -> src/features/simulation/assets/bgm.mp3

Made from sine partials whose frequencies and swells all fit a whole number of times into the loop, so the
end meets the start exactly. Synthesised, so there is no licence to carry.
"""
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

RATE, LOOP = 44100, 96  # seconds
OUT = Path(__file__).resolve().parents[1] / "src" / "features" / "simulation" / "assets" / "bgm.mp3"


def main():
    t = np.arange(RATE * LOOP) / RATE
    rng = np.random.default_rng(7)
    snap = lambda hz: round(hz * LOOP) / LOOP  # a whole number of cycles per loop
    # A slow A-minor colour: root, fifth, ninth, then a high shimmer; each note swells on its own cycle.
    notes = [(110.0, 0.30, 6), (164.8, 0.22, 4), (220.0, 0.16, 3), (261.6, 0.14, 8), (329.6, 0.12, 12), (493.9, 0.05, 16), (659.3, 0.03, 24)]
    sig = np.zeros_like(t)
    for hz, amp, swells in notes:
        for detune in (-0.4, 0.0, 0.4):  # a little chorus so it is not a bare tone
            f = snap(hz + detune)
            swell = 0.55 + 0.45 * np.sin(2 * np.pi * swells * t / LOOP + rng.uniform(0, 6.28))
            sig += amp / 3 * swell * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28))
    sig /= np.abs(sig).max()
    pcm = (sig * 0.5 * 32767).astype("<i2")
    tmp = OUT.with_suffix(".wav")
    with wave.open(str(tmp), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(tmp), "-b:a", "96k", str(OUT)], check=True)
    tmp.unlink()
    print(OUT, OUT.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    sys.exit(main())
