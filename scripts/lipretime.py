"""Lay a clip's mouth on another voice that says the same words: retime the clip so its own voice lines up with ours.

    python scripts/lipretime.py clip.mp4 our.wav out.mp4

The video model speaks the line in its own voice; ours is the one we want to hear. Both say the same sentence, so the two
recordings are aligned (DTW on MFCCs), and the clip's time is bent along that alignment: the mouth then opens where OUR
voice speaks. Our voice is not touched. If ours has extra words at the start (the model's line is a part of it) the clip's
voice is matched inside ours (a subsequence DTW is not used: both say the same sentence).
"""
import subprocess
import sys

import cv2
import librosa
import numpy as np

clip, ours, out = sys.argv[1:4]
SR, HOP = 16000, 160  # 10 ms
tmp = out + ".own.wav"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", clip, "-vn", "-ac", "1", "-ar", str(SR), tmp], check=True)
a, _ = librosa.load(tmp, sr=SR)
b, _ = librosa.load(ours, sr=SR)


def feats(x):
    m = librosa.feature.mfcc(y=x, sr=SR, n_mfcc=20, hop_length=HOP)[1:]
    return (m - m.mean(1, keepdims=True)) / (m.std(1, keepdims=True) + 1e-6)


fa, fb = feats(a), feats(b)
_, wp = librosa.sequence.dtw(X=fa, Y=fb, subseq=False, metric="euclidean")
wp = wp[::-1]  # (model frame, our frame) in time order
# for every 10 ms of OUR voice that the path covers: the model's time that matches it
our_t, mod_t = {}, {}
for i, j in wp:
    our_t.setdefault(j, []).append(i)
js = np.array(sorted(our_t))
ms = np.array([np.mean(our_t[j]) for j in js]) * HOP / SR
js = js * HOP / SR
dur = len(b) / SR
cap = cv2.VideoCapture(clip)
fps = cap.get(cv2.CAP_PROP_FPS)
frames = []
while True:
    ok, f = cap.read()
    if not ok:
        break
    frames.append(f)
h, w = frames[0].shape[:2]
vw = cv2.VideoWriter(out + ".silent.mp4", cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
for k in range(int(dur * fps) + 1):
    t = k / fps
    mt = 0.0 if t < js[0] else (ms[-1] if t > js[-1] else float(np.interp(t, js, ms)))
    vw.write(frames[min(len(frames) - 1, int(round(mt * fps)))])
vw.release()
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", out + ".silent.mp4", "-i", ours, "-map", "0:v", "-map", "1:a", "-c:v", "libx264",
                "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out], check=True)
print("covered ours %.2f-%.2fs of %.2fs; model audio %.2fs; stretch range %.2f-%.2f" % (
    js[0], js[-1], dur, len(a) / SR, float(np.min(np.diff(ms) / np.maximum(np.diff(js), 1e-3))), float(np.max(np.diff(ms) / np.maximum(np.diff(js), 1e-3)))))
