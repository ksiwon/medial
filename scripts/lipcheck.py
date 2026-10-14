"""How well a clip's mouth follows a voice: mouth-region motion vs the voice's loudness, correlated over small lags.

    python scripts/lipcheck.py clip.mp4 voice.wav
Prints the best lag (s) and correlation, and the correlation against the same voice reversed in time (the chance level).
"""
import sys, wave, subprocess
import numpy as np
import cv2

clip, wav = sys.argv[1], sys.argv[2]
cap = cv2.VideoCapture(clip)
fps = cap.get(cv2.CAP_PROP_FPS)
frames = []
while True:
    ok, f = cap.read()
    if not ok:
        break
    frames.append(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY))
casc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
box = None
for g in frames:
    faces = casc.detectMultiScale(g, 1.05, 3, minSize=(30, 30))
    if len(faces):
        box = max(faces, key=lambda b: b[2] * b[3]); break
if box is None:
    raise SystemExit("no face found")
x, y, w, h = box
roi = lambda g: g[y + int(h * 0.62): y + int(h * 0.95), x + int(w * 0.2): x + int(w * 0.8)].astype(np.float32)
mot = np.array([np.abs(roi(frames[i]) - roi(frames[i - 1])).mean() for i in range(1, len(frames))])
w_ = wave.open(wav); sr = w_.getframerate(); a = np.frombuffer(w_.readframes(w_.getnframes()), dtype=np.int16).astype(np.float32)
hop = sr / fps
env = np.array([np.sqrt((a[int(i * hop): int((i + 1) * hop)] ** 2).mean() + 1e-9) for i in range(int(len(a) / hop))])
n = min(len(mot), len(env))
def z(v): v = v[:n] - v[:n].mean(); return v / (v.std() + 1e-9)
def best(m, e):
    out = []
    for lag in range(-6, 7):
        if lag >= 0: u, v = m[lag:n], e[:n - lag]
        else: u, v = m[:n + lag], e[-lag:n]
        out.append((float((z(u)[:len(v)] * z(v)[:len(u)]).mean()) if len(u) > 5 else 0, lag / fps))
    return max(out)
c, lag = best(z(mot), z(env))
cr, _ = best(z(mot), z(env[::-1].copy()))
print("face box", box.tolist(), "frames", len(frames), "voice %.2fs" % (len(a) / sr))
print("correlation %.2f at lag %.2fs | same voice reversed: %.2f" % (c, lag, cr))
