"""Transcribe what each generated 3안 clip says and print it next to the intended line.

    python scripts/video3_stt.py [tag]      # tag default .480p; reads local-data/video/clips/*<tag>.mp4
"""
import base64
import json
import subprocess
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tts_scenes as T  # noqa: E402
import video3 as V  # noqa: E402,F401  (SCENES only; main() is guarded below)

OUT = T.ROOT / "local-data" / "video" / "clips"
TAG = sys.argv[1] if len(sys.argv) > 1 else ".480p"
KEY = T.api_key()


def hear(mp4):
    mp3 = mp4.with_suffix(".stt.mp3")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(mp4), "-vn", "-b:a", "96k", str(mp3)], check=True)
    body = {"contents": [{"parts": [{"text": "이 오디오에서 들리는 한국어 말을 그대로 받아 적어라. 사투리 억양은 표준 철자로 적고, 받아쓴 글만 출력하라."},
                                    {"inline_data": {"mime_type": "audio/mp3", "data": base64.b64encode(mp3.read_bytes()).decode()}}]}]}
    req = urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
                                 data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": KEY})
    mp3.unlink()
    try:
        r = json.load(urllib.request.urlopen(req, timeout=120))
        return r["candidates"][0]["content"]["parts"][0]["text"].strip()
    except Exception as e:
        return "STT 실패 %s" % e


scenes = json.load(open(OUT.parent / "audio/gemini-3.8-flash-tts/scenes.json", encoding="utf-8"))
jobs = []
for sc, rows in scenes.items():
    for r in rows:
        mp4 = OUT / r["file"].replace(".wav", TAG + ".mp4")
        if mp4.exists():
            jobs.append((r, mp4))
with ThreadPoolExecutor(4) as ex:
    for (r, mp4), got in zip(jobs, ex.map(lambda j: hear(j[1]), jobs)):
        print(r["file"], "\n  원문:", V.spoken(r["text"]), "\n  들림:", got)
