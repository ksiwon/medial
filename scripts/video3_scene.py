"""Whole-scene preview: the residents' generated clips and, for the lines MEDial speaks, the "listening" clip with MEDial's existing voice.

    python scripts/video3_scene.py <scene-id> [out.mp4]      # reads *.480p.mp4 in local-data/video3
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
V = ROOT / "local-data/video3"
AUDIO = ROOT / "local-data/audio/gemini-3.8-flash-tts"
TAG = ".480p"
scene = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else str(V / ("scene_%s%s.mp4" % (scene, TAG)))
rows = json.load(open(AUDIO / "scenes.json", encoding="utf-8"))[scene]
ENC = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "44100", "-ac", "2"]
VF = "scale=854:480,fps=24"


def run(*a):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *a], check=True)


def speech_end(f):
    """Seconds up to where a silence running to the clip's end begins (+0.3 s), else the whole clip."""
    log = subprocess.run(["ffmpeg", "-i", str(f), "-af", "silencedetect=noise=-38dB:d=0.4", "-f", "null", "-"], capture_output=True, text=True).stderr
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)]))
    starts = [float(l.split("silence_start:")[1].split()[0]) for l in log.splitlines() if "silence_start" in l]
    ends = [l for l in log.splitlines() if "silence_end" in l]
    return min(dur, starts[-1] + 0.3) if starts and len(starts) > len(ends) else dur


parts = []
for r in rows:
    n = V / ("_s_%s_%02d.mp4" % (scene, r["index"]))
    if r["speaker"] == "MEDial":
        listen = V / ("%s.listen%s.mp4" % (scene, TAG))
        if not listen.exists():
            continue
        wav = AUDIO / r["file"]
        # the listening take loops (back and forth is not needed for a preview) to cover the line; MEDial's own voice on top
        run("-stream_loop", "-1", "-i", str(listen), "-i", str(wav), "-t", "%.2f" % (r["seconds"] + 0.25), "-map", "0:v", "-map", "1:a", "-vf", VF, *ENC, "-shortest", str(n))
    else:
        f = V / r["file"].replace(".wav", TAG + ".mp4")
        if not f.exists():
            continue
        run("-i", str(f), "-t", "%.2f" % speech_end(f), "-vf", VF, *ENC, str(n))
    parts.append(n)
lst = V / "_list_scene.txt"
lst.write_text("".join("file '%s'\n" % p.as_posix() for p in parts), encoding="utf-8")
run("-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", out)
for p in parts:
    p.unlink()
print("scene", scene, out, len(parts), "clips")
