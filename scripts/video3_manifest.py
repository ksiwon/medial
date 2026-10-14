"""Writes local-data/video3/manifest.json: which line of the exhibition has a video clip (the app's video mode, `?video=1`).

    python scripts/video3_manifest.py [tag]      # tag default .480p; use the clips named <line>.<tag>.mp4

{"speaker|text": {"file", "seconds", "sound", "fit"}}   fit: cover (one person on a call) | contain (two people in one shot)
  - a resident's line: the clip that speaks it (sound true); seconds = where its speech ends, the model leaves a silent tail
  - a line MEDial speaks: the scene's "listening" clip (sound false), looped, with MEDial's own recording on top
A line that is not here stays a picture, so a scene whose clips are not all made yet still plays.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
V = ROOT / "local-data" / "video3"
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


scenes = json.load(open(AUDIO / "scenes.json", encoding="utf-8"))
out = {}
for scene, cfg in SCENES.items():
    fit = "cover" if cfg["kind"] == "call" else "contain"  # a call is one close face; two people stay whole
    for row in scenes[scene]:
        key = "%s|%s" % (row["speaker"], row["text"])
        if row["speaker"] == "MEDial":
            listen = V / ("%s.listen%s.mp4" % (scene, TAG))
            if not listen.exists():
                continue
            entry = {"file": listen.name, "seconds": 8.0, "sound": False, "fit": fit}
        elif row["speaker"] in cfg["cast"]:
            clip = V / row["file"].replace(".wav", TAG + ".mp4")
            if not clip.exists():
                continue
            entry = {"file": clip.name, "seconds": speech_end(clip), "sound": True, "fit": fit}
        else:
            continue
        if key in out and out[key]["file"] != entry["file"]:
            print("same line in two scenes, the later one wins:", key)
        out[key] = entry
(V / "manifest.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(len(out), "lines with a clip,", sum(1 for e in out.values() if e["sound"]), "of them spoken by the clip")
