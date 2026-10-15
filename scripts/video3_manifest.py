"""Writes local-data/video/clips/manifest.json: which line of the exhibition has a video clip (the app's video mode, `?video=1`).

    python scripts/video3_manifest.py [tag]      # tag default .480p; use the clips named <line>.<tag>.mp4

{"speaker|text": {"file", "start", "seconds", "sound", "fit", "zoom", "tx", "ty"}}   fit: cover (one person on a call) | contain (two people in one shot)
  - a resident's line: the clip that speaks it (sound true); it plays from `start` (just before the voice: the model leads in with a
    silent second) for `seconds` (to where its speech ends; it leaves a silent tail)
  - a line MEDial speaks: the scene's "listening" clip (sound false), once, with MEDial's own recording on top
  - zoom/tx/ty (a call only): every take is a separate generation and the man stands a little elsewhere in each, so each is scaled and
    shifted (CSS: translate(tx%, ty%) scale(zoom)) to put his face where the scene's other takes have it; a cut then does not jump
A line that is not here stays a picture, so a scene whose clips are not all made yet still plays.
"""
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
V = ROOT / "local-data" / "video" / "clips"
AUDIO = ROOT / "local-data" / "audio" / "gemini-3.8-flash-tts"
TAG = sys.argv[1] if len(sys.argv) > 1 else ".480p"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from video3 import SCENES  # noqa: E402


def speech_end(f):
    """Seconds to where a silence that runs to the clip's end begins (+0.25 s of air), else the whole clip."""
    log = subprocess.run(["ffmpeg", "-i", str(f), "-af", "silencedetect=noise=-38dB:d=0.4", "-f", "null", "-"], capture_output=True, text=True).stderr
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)]))
    starts = [float(l.split("silence_start:")[1].split()[0]) for l in log.splitlines() if "silence_start" in l]
    ends = [l for l in log.splitlines() if "silence_end" in l]
    return round(min(dur, starts[-1] + 0.25) if starts and len(starts) > len(ends) else dur, 2)


def speech_start(f):
    """Seconds to where the voice begins (-0.12 s of air): the first 80 ms whose level is a quarter of the loud ones'."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(f), "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True).stdout
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
    n = len(x) // 320
    if n < 10:
        return 0.0
    rms = np.sqrt((x[: n * 320].reshape(n, 320) ** 2).mean(axis=1))
    loud = np.percentile(rms, 90)
    hot = rms > 0.25 * loud
    for i in range(n - 3):
        if hot[i : i + 4].all():
            return round(min(max(0.0, i * 0.02 - 0.12), 1.2), 2)
    return 0.0


CASCADES = [cv2.CascadeClassifier(cv2.data.haarcascades + n) for n in ("haarcascade_frontalface_default.xml", "haarcascade_frontalface_alt2.xml", "haarcascade_profileface.xml")]


def face_of(f, a, b):
    """Median (centre x, centre y, width) of the biggest face, as fractions of the frame, over seconds a..b of the clip; None when not found."""
    cap = cv2.VideoCapture(str(f))
    fps, w, h = cap.get(cv2.CAP_PROP_FPS) or 24, cap.get(cv2.CAP_PROP_FRAME_WIDTH), cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
    seen = []
    for i in range(int(a * fps), int(b * fps), 4):
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, im = cap.read()
        if not ok:
            break
        gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
        for c in CASCADES:
            found = c.detectMultiScale(gray, 1.1, 5, minSize=(40, 40))
            if len(found):
                x, y, fw, fh = max(found, key=lambda r: r[2])
                seen.append(((x + fw / 2) / w, (y + fh / 2) / h, fw / w))
                break
    return tuple(float(np.median([s[k] for s in seen])) for k in range(3)) if len(seen) >= 3 else None


def place(face, target):
    """zoom, tx, ty (% of the frame) that bring `face` onto `target` and still cover the whole frame."""
    fx, fy, fw = face
    tx_, ty_, tw = target
    s = min(1.3, max(1.0, tw / fw))
    while True:
        tx, ty = tx_ - 0.5 - s * (fx - 0.5), ty_ - 0.5 - s * (fy - 0.5)
        room = (s - 1) / 2
        if (abs(tx) <= room and abs(ty) <= room) or s >= 1.4:
            break
        s += 0.01
    room = (s - 1) / 2
    return round(s, 3), round(100 * max(-room, min(room, tx)), 2), round(100 * max(-room, min(room, ty)), 2)


scenes = json.load(open(AUDIO / "scenes.json", encoding="utf-8"))
out = {}
for scene, cfg in SCENES.items():
    fit = "cover" if cfg["kind"] == "call" else "contain"  # a call is one close face; two people stay whole
    mine = {}
    for row in scenes[scene]:
        key = "%s|%s" % (row["speaker"], row["text"])
        if row["speaker"] == "MEDial":
            listen = V / ("%s.listen%s.mp4" % (scene, TAG))
            if not listen.exists():
                continue
            entry = {"file": listen.name, "start": 0.0, "seconds": 8.0, "sound": False, "fit": fit}
        elif row["speaker"] in cfg["cast"]:
            clip = V / row["file"].replace(".wav", TAG + ".mp4")
            if not clip.exists():
                continue
            start = speech_start(clip)
            entry = {"file": clip.name, "start": start, "seconds": round(speech_end(clip) - start, 2), "sound": True, "fit": fit}
        else:
            continue
        mine[key] = entry
    if cfg["kind"] == "call":
        faces = {}
        for e in {e["file"]: e for e in mine.values()}.values():
            faces[e["file"]] = face_of(V / e["file"], e["start"], e["start"] + min(e["seconds"], 4.0))
        found = [f for f in faces.values() if f]
        target = tuple(float(np.median([f[k] for f in found])) for k in range(3)) if found else None
        for e in mine.values():
            f = faces.get(e["file"])
            e["zoom"], e["tx"], e["ty"] = place(f, target) if f and target else (1.0, 0.0, 0.0)
    for key, entry in mine.items():
        if key in out and out[key]["file"] != entry["file"]:
            print("same line in two scenes, the later one wins:", key)
        out[key] = entry
(V / "manifest.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(len(out), "lines with a clip,", sum(1 for e in out.values() if e["sound"]), "of them spoken by the clip")
