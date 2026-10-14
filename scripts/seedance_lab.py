"""Small, paid experiments with BytePlus Seedance for the exhibition's talking scenes (3안). Not part of the app.

    python scripts/seedance_lab.py frame            # builds local-data/video-lab/frame.png (first frame of the test)
    python scripts/seedance_lab.py run <name> [--audio on|off] [--ref-audio] [--model ID]   # ONE task, 480p, 4 s, then downloads it

Every `run` is one task: it costs money (about 0.4 USD at 480p / 4 s on dreamina-seedance-2-5). Nothing here loops.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / "local-data" / "video-lab"
BASE = "https://ark.ap-southeast.bytepluses.com/api/v3"
sys.stdout.reconfigure(encoding="utf-8")


def key() -> str:
    for line in io.open(ROOT / "server" / ".env", encoding="utf-8"):
        if line.startswith("BYTEPLUS_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("server/.env 에 BYTEPLUS_API_KEY 가 없다")


def call(path: str, body: dict | None = None):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + key(), "Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=120))
    except urllib.error.HTTPError as e:
        raise SystemExit("HTTP %d %s" % (e.code, e.read()[:600].decode("utf-8", "ignore")))


def frame(full: bool = False):
    from PIL import Image
    LAB.mkdir(parents=True, exist_ok=True)
    bg = Image.open(ROOT / "local-data/art/FARM.webp").convert("RGB")  # 1536x1024
    w, h = 1280, 720
    bg = bg.resize((w, int(w * 1024 / 1536))).crop((0, 60, w, 60 + h))
    p6 = Image.open(ROOT / "local-data/art/P6.stand.webp").convert("RGBA")
    th = int(h * 1.0)
    p6 = p6.resize((int(p6.width * th / p6.height), th))
    bg.paste(p6, (int(w * 0.30), h - th), p6)
    if not full:
        bg = bg.crop((300, 0, 940, 360)).resize((w, h), Image.LANCZOS)  # a medium shot: the face is what moves
    bg.save(LAB / ("frame_full.png" if full else "frame.png"))
    print("frame", bg.size)


def data_uri(path: Path, mime: str) -> str:
    return "data:%s;base64,%s" % (mime, base64.b64encode(path.read_bytes()).decode())


def run(a):
    LAB.mkdir(parents=True, exist_ok=True)
    wav = ROOT / "local-data/audio/gemini-3.8-flash-tts/d1-w3-disclosed_03_P6.wav"
    mp3 = LAB / "line.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-b:a", "128k", str(mp3)], check=True)
    text = ("A man in a navy jacket stands in a persimmon field and speaks Korean directly to the camera. The man from @Image1 is the speaker. Fixed camera, no camera "
            "movement, natural mouth movement synced exactly to the supplied voice recording, subtle body movement. "
            "He says: \"이맘때 밭에 있다 카더라.\"")
    content = [{"type": "text", "text": text},
               {"type": "image_url", "image_url": {"url": data_uri(LAB / ("frame_full.png" if a.full else "frame.png"), "image/png")}, "role": "first_frame" if not a.ref_audio else "reference_image"}]
    if a.ref_audio:
        content.append({"type": "audio_url", "audio_url": {"url": data_uri(mp3, "audio/mpeg")}, "role": "reference_audio"})
    body = {"model": a.model, "content": content, "generate_audio": a.audio == "on", "ratio": "16:9", "duration": 4,
            "resolution": "480p", "watermark": False}
    made = call("/contents/generations/tasks", body)
    tid = made["id"]
    print("task", tid)
    while True:
        time.sleep(6)
        got = call("/contents/generations/tasks/" + tid)
        st = got.get("status")
        print(" ", st)
        if st in ("succeeded", "failed", "cancelled", "expired"):
            break
    (LAB / (a.name + ".json")).write_text(json.dumps(got, ensure_ascii=False, indent=1), encoding="utf-8")
    if st == "succeeded":
        url = got["content"]["video_url"]
        (LAB / (a.name + ".mp4")).write_bytes(urllib.request.urlopen(url, timeout=180).read())
        print("saved", a.name + ".mp4", "usage:", got.get("usage"))
    else:
        print("error:", got.get("error"))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("frame")
    r = sub.add_parser("run")
    r.add_argument("name")
    r.add_argument("--audio", default="on")
    r.add_argument("--full", action="store_true")
    r.add_argument("--ref-audio", action="store_true")
    r.add_argument("--model", default="dreamina-seedance-2-5-260628")
    args = ap.parse_args()
    frame() if args.cmd == "frame" else run(args)
