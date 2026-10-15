"""How well the mouth follows the voice in each generated clip: python scripts/video3_sync.py [tag]   (tag default .480p)

The motion of the lower face (frame to frame) is laid against the loudness of the voice; the lag with the best match is the
picture's delay behind the sound (+ = the mouth is late), the match (0..1) is how much the mouth moves with the words at all.
Only the clips with one face (a call, the emergency); a two-shot's mouth is too small for this.
"""
import glob
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

V = Path(__file__).resolve().parents[1] / "local-data" / "video" / "clips"
TAG = sys.argv[1] if len(sys.argv) > 1 else ".480p"
FPS = 24
CASCADE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")


def voice(f):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(f), "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True).stdout
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
    step = 16000 // FPS
    n = len(x) // step
    return np.sqrt((x[: n * step].reshape(n, step) ** 2).mean(axis=1))


def mouth(f):
    cap = cv2.VideoCapture(str(f))
    cap.set(cv2.CAP_PROP_FPS, FPS)
    frames = []
    while True:
        ok, im = cap.read()
        if not ok:
            break
        frames.append(cv2.cvtColor(im, cv2.COLOR_BGR2GRAY))
    box = None
    for g in frames[:: max(1, len(frames) // 6)]:
        found = CASCADE.detectMultiScale(g, 1.1, 5, minSize=(40, 40))
        if len(found):
            box = max(found, key=lambda r: r[2])
            break
    if box is None:
        return None
    x, y, w, h = box
    lo = [g[y + int(h * 0.55): y + int(h * 1.05), x + int(w * 0.15): x + int(w * 0.85)].astype(np.float32) for g in frames]
    return np.array([np.abs(a - b).mean() for a, b in zip(lo[1:], lo[:-1])])


for f in sorted(glob.glob(str(V / ("*%s.mp4" % TAG)))):
    name = Path(f).name
    if name.startswith("scene_") or ".listen" in name or "_P1." in name or "d3-e2" in name or "factonly" in name or "d1-w3" in name:
        continue
    m, a = mouth(f), voice(f)
    if m is None:
        print(name, "no face")
        continue
    a = np.abs(np.diff(a))  # the voice's changes follow the mouth's, the level alone does not
    n = min(len(m), len(a))
    m, a = m[:n] - m[:n].mean(), a[:n] - a[:n].mean()
    best = (-2, 0)
    for lag in range(-8, 9):  # frames the mouth is behind the voice
        u, v = (m[lag:], a[: n - lag]) if lag >= 0 else (m[: n + lag], a[-lag:])
        if len(u) > 10 and u.std() and v.std():
            r = float(np.corrcoef(u, v)[0, 1])
            best = max(best, (r, lag))
    print("%-36s match %.2f  lag %+.2f s" % (name, best[0], best[1] / FPS))
