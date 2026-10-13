"""Puts the voice on the recorded walk: python scripts/mux_voice.py <run dir> <out.mp4>.

The video has no sound, so every clip the page started is laid on a silent track at the moment it
started (plays.json from record_walk.cjs, +-0.2 s), and the two are joined (ffmpeg)."""
import glob
import json
import subprocess
import sys

run, out = sys.argv[1], sys.argv[2]
from pathlib import Path

AUDIO = Path(__file__).resolve().parents[1] / "local-data" / "audio" / "gemini-3.8-flash-tts"
data = json.load(open(f"{run}/plays.json", encoding="utf-8"))
t_page = data["tPage"]
plays = [p for p in data["plays"] if p["file"].endswith(".wav")]
video = glob.glob(f"{run}/*.webm")[0]
print("clips:", len(plays), "first at %.2fs" % ((plays[0]["at"] - t_page) / 1000))

dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]).decode().strip())
cmd = ["ffmpeg", "-y", "-i", video]
for p in plays:
    cmd += ["-i", f"{AUDIO / p['file']}"]
chains, labels = [], []
for i, p in enumerate(plays, start=1):
    delay = max(0, int(p["at"] - t_page))
    chains.append(f"[{i}:a]adelay={delay}|{delay}[a{i}]")
    labels.append(f"[a{i}]")
chains.append("".join(labels) + f"amix=inputs={len(plays)}:normalize=0:dropout_transition=0,apad[aout]")
cmd += ["-filter_complex", ";".join(chains), "-map", "0:v", "-map", "[aout]",
        "-c:v", "libx264", "-crf", "22", "-preset", "medium", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-t", str(dur), "-loglevel", "error", out]
subprocess.run(cmd, check=True)
