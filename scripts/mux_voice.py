"""Puts the voice on the recorded walk: python scripts/mux_voice.py <run dir> <out.mp4>.

The video has no sound, so every clip the page started is laid on a silent track at the moment it
started (plays.json from record_walk.cjs, +-0.2 s), under the background pad the page loops at the same low volume
(ui/ambient.ts); the two are joined (ffmpeg)."""
import glob
import json
import subprocess
import sys

run, out = sys.argv[1], sys.argv[2]
from pathlib import Path

AUDIO = Path(__file__).resolve().parents[1] / "local-data" / "audio" / "gemini-3.8-flash-tts"
data = json.load(open(f"{run}/plays.json", encoding="utf-8"))
t_page = data["tPage"]
VIDEO = Path(__file__).resolve().parents[1] / "local-data" / "video" / "clips"
clips = json.load(open(VIDEO / "manifest.json", encoding="utf-8")) if (VIDEO / "manifest.json").exists() else {}
spoken = {c["file"]: c["seconds"] for c in clips.values() if c["sound"]}  # the clips that speak a line (3안); a listening clip has no sound of its own
plays = [p for p in data["plays"] if p["file"].endswith(".wav") or p["file"] in spoken]
# A clip the page started before it had read its length reports 0: the manifest has it.
length = {v["file"]: v["seconds"] for v in json.load(open(AUDIO / "manifest.json", encoding="utf-8")).values()}
for p in plays:
    # a clip's voice ends where its speech does: the page moves to the next line then (the clip itself runs on a little)
    p["dur"] = spoken[p["file"]] if p["file"] in spoken else p["dur"] or length.get(p["file"], 0)
    p["path"] = VIDEO / p["file"] if p["file"] in spoken else AUDIO / p["file"]
video = glob.glob(f"{run}/*.webm")[0]
print("clips:", len(plays), "first at %.2fs" % ((plays[0]["at"] - t_page) / 1000))

dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]).decode().strip())
BGM = Path(__file__).resolve().parents[1] / "src" / "features" / "simulation" / "assets" / "bgm.mp3"
cmd = ["ffmpeg", "-y", "-i", video, "-stream_loop", "-1", "-i", str(BGM)]
for p in plays:
    cmd += ["-i", str(p["path"])]
# The pad drops to 40% under the narrator, as the page does (ui/ambient.ts duckAmbient).
duck = "+".join("between(t,%.2f,%.2f)" % ((p["at"] - t_page) / 1000, (p["at"] - t_page) / 1000 + (p["dur"] or 0)) for p in plays if p["file"].startswith(("intro_", "outro_")))
chains = ["[1:a]volume=eval=frame:volume='0.12*(1-0.6*min(1,%s))'[bgm]" % (duck or "0")]
labels = ["[bgm]"]
for i, p in enumerate(plays, start=2):
    delay = max(0, int(p["at"] - t_page))
    # a clip is cut where its speech ends and levelled (the model's voices come out at very different loudness)
    cut = f"atrim=0:{p['dur']:.2f},loudnorm=I=-17:TP=-2:LRA=7," if p["file"] in spoken else ""
    chains.append(f"[{i}:a]{cut}adelay={delay}|{delay}[a{i}]")
    labels.append(f"[a{i}]")
chains.append("".join(labels) + f"amix=inputs={len(plays) + 1}:normalize=0:dropout_transition=0,apad[aout]")
cmd += ["-filter_complex", ";".join(chains), "-map", "0:v", "-map", "[aout]",
        "-c:v", "libx264", "-crf", "22", "-preset", "medium", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-t", str(dur), "-loglevel", "error", out]
subprocess.run(cmd, check=True)
