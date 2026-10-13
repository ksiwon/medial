"""The exhibition's background sound: a slow, quiet piano-like figure that loops without a seam.

    python scripts/make_bgm.py        # -> src/features/simulation/assets/bgm.mp3

Soft plucked notes (a few decaying harmonics) play a sparse arpeggio over four chords, with a long
reverb; the reverb is a circular convolution, so the end meets the start exactly. Synthesised, so there
is no licence to carry. (The first version was sustained sine partials and only hummed.)
"""
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

RATE, BEAT, BEATS = 44100, 1.5, 64  # 96 s: four chords of sixteen beats... each chord lasts 16 beats
LOOP = BEAT * BEATS
OUT = Path(__file__).resolve().parents[1] / "src" / "features" / "simulation" / "assets" / "bgm.mp3"
N = int(RATE * LOOP)

midi = lambda m: 440.0 * 2 ** ((m - 69) / 12)
# C - Am - F - G, each as (bass, arpeggio notes)
CHORDS = [(36, [60, 64, 67, 72, 76]), (33, [57, 60, 64, 69, 72]), (41, [60, 65, 69, 72, 77]), (43, [59, 62, 67, 71, 74])]


def note(buf, start_s, hz, amp, decay):
    """One plucked note, added in place (wrapping round the end of the loop)."""
    n = int(RATE * decay * 5)
    t = np.arange(n) / RATE
    tone = sum(a * np.exp(-t * decay_k) * np.sin(2 * np.pi * hz * k * t)
               for k, a, decay_k in ((1, 1.0, 1 / decay), (2, 0.35, 2 / decay), (3, 0.12, 3 / decay), (4, 0.05, 5 / decay)))
    tone *= np.minimum(1, t / 0.012) * amp  # a soft attack, no click
    i = int(start_s * RATE)
    idx = (np.arange(n) + i) % len(buf)
    np.add.at(buf, idx, tone)


def main():
    rng = np.random.default_rng(11)
    dry = np.zeros(N)
    per = BEATS // len(CHORDS)
    for c, (bass, arp) in enumerate(CHORDS):
        base = c * per * BEAT
        note(dry, base, midi(bass), 0.34, 5.0)
        note(dry, base + 8 * BEAT, midi(bass + 7), 0.18, 4.0)
        for b in range(per):
            if rng.random() < 0.38:  # rests: it should breathe
                continue
            pitch = arp[(b * 2 + c) % len(arp)] if b % 4 else arp[rng.integers(2, len(arp))]
            note(dry, base + b * BEAT + rng.uniform(0, 0.08), midi(pitch), rng.uniform(0.10, 0.17), 2.6)
    # reverb: noise with an exponential tail, convolved around the loop
    ir_n = int(RATE * 3.2)
    ir = rng.standard_normal(ir_n) * np.exp(-np.arange(ir_n) / RATE / 0.8)
    ir[0] = 1.0
    wet = np.fft.irfft(np.fft.rfft(dry) * np.fft.rfft(ir, N), N)
    sig = dry + 0.35 * wet / np.abs(wet).max() * np.abs(dry).max()
    sig /= np.abs(sig).max()
    pcm = (sig * 0.55 * 32767).astype("<i2")
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
