"""Seedance lab, part 2: people made from words, not from a photo (the input-face filter looks at input images only).

    python scripts/seedance_lab2.py t2v <name>        # text + reference_audio, no image: 2.5, 480p, 4 s (about 0.4 USD)
    python scripts/seedance_lab2.py image <name>      # a portrait from Seedream 5.0 (a few cents); prints its URL
    python scripts/seedance_lab2.py i2v <name> <url>  # that image by URL as reference_image + the line's voice
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seedance_lab as L  # noqa: E402

PERSON = ("a Korean man in his late 50s, short grey-flecked black hair, navy zip-up work jacket over a white polo shirt, "
          "weathered kind face, standing in a persimmon and cabbage field above a small fishing village and sea in Namhae, Korea")


def mp3():
    wav = L.ROOT / "local-data/audio/gemini-3.8-flash-tts" / __import__("os").environ.get("WAV", "d1-w3-disclosed_03_P6.wav")
    out = L.LAB / "line.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-b:a", "128k", str(out)], check=True)
    return out


def wait(tid, name):
    while True:
        time.sleep(6)
        got = L.call("/contents/generations/tasks/" + tid)
        print(" ", got.get("status"))
        if got.get("status") in ("succeeded", "failed", "cancelled", "expired"):
            break
    (L.LAB / (name + ".json")).write_text(json.dumps(got, ensure_ascii=False, indent=1), encoding="utf-8")
    if got["status"] == "succeeded":
        (L.LAB / (name + ".mp4")).write_bytes(urllib.request.urlopen(got["content"]["video_url"], timeout=180).read())
        print("saved", name + ".mp4", got.get("usage"))
    else:
        print("error:", got.get("error"))


def task(content, name):
    body = {"model": "dreamina-seedance-2-5-260628", "content": content, "generate_audio": __import__("os").environ.get("GENAUDIO") == "1", "ratio": "16:9",
            "duration": int(__import__("os").environ.get("DUR", "4")), "resolution": "480p", "watermark": False}
    tid = L.call("/contents/generations/tasks", body)["id"]
    print("task", tid)
    wait(tid, name)


def main():
    cmd, name = sys.argv[1], sys.argv[2]
    L.LAB.mkdir(parents=True, exist_ok=True)
    audio = {"type": "audio_url", "audio_url": {"url": L.data_uri(mp3(), "audio/mpeg")}, "role": "reference_audio"}
    if cmd == "t2v":
        text = ("Medium close-up, fixed camera. " + PERSON + ". He speaks Korean to someone off camera, mouth movements synced "
                "exactly to the supplied voice recording. He says: \"" + __import__("os").environ.get("SAY", "이맘때 밭에 있다 카더라.") + "\"")
        task([{"type": "text", "text": text}, audio], name)
    elif cmd == "image":
        r = L.call("/images/generations", {"model": "seedream-5-0-260128", "prompt": "Photorealistic medium close-up portrait of " + PERSON +
                                         ", looking slightly off camera, natural daylight, shallow depth of field", "size": "2K",
                                         "response_format": "url", "watermark": False})
        print(json.dumps(r, ensure_ascii=False)[:600])
    elif cmd == "i2v":
        url = sys.argv[3]
        text = ("The man from @Image1 is the speaker, medium close-up, fixed camera. His mouth moves in sync with the supplied voice recording. "
                "He says: \"" + __import__("os").environ.get("SAY", "이맘때 밭에 있다 카더라.") + "\"")
        task([{"type": "text", "text": text}, {"type": "image_url", "image_url": {"url": url}, "role": "reference_image"}, audio], name)


main()
