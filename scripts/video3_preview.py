"""Joins a scene's clips in order into one preview, each clip cut where its speech ends (the model leaves a silent tail).

    python scripts/video3_preview.py <scene-id> <out.mp4>
"""
import json, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
scene, out = sys.argv[1], sys.argv[2]
rows = json.load(open(ROOT / "local-data/audio/gemini-3.8-flash-tts/scenes.json", encoding="utf-8"))[scene]
parts = []
for r in rows:
    f = ROOT / "local-data/video/clips" / r["file"].replace(".wav", sys.argv[3] if len(sys.argv) > 3 else ".mp4")
    if not f.exists():
        continue
    log = subprocess.run(["ffmpeg", "-i", str(f), "-af", "silencedetect=noise=-38dB:d=0.4", "-f", "null", "-"], capture_output=True, text=True).stderr
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)]))
    # only a silence that runs to the end of the clip is a tail to cut; a pause inside the sentence is not
    starts = [float(l.split("silence_start:")[1].split()[0]) for l in log.splitlines() if "silence_start" in l]
    ended = [float(l.split("silence_end:")[1].split()[0]) for l in log.splitlines() if "silence_end" in l]
    tail = starts[-1] if starts and len(starts) > len(ended) else None
    cut = min(dur, tail + 0.3) if tail is not None else dur
    t = ROOT / "local-data/video/clips" / ("_cut_" + f.name)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(f), "-t", "%.2f" % cut, "-c:v", "libx264", "-c:a", "aac", "-ar", "44100", "-ac", "2", "-vf", "scale=854:480,fps=24", str(t)], check=True)
    parts.append(t)
lst = ROOT / "local-data/video/clips/_list.txt"
lst.write_text("".join("file '%s'\n" % p.as_posix() for p in parts), encoding="utf-8")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", out], check=True)
print("preview", out, len(parts), "clips")
