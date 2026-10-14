"""3안: the residents' lines as video (Seedance 2.5, text + a fixed reference portrait + the line's voice as the timbre reference).

    python scripts/video3.py scene <scene-id>      # every line of the scene that a resident speaks -> local-data/video3/<file>.mp4

The reference portraits are `local-data/video-lab/faces/<P>_<set>_urls.json`; REF below says which one each resident uses.
One task per line; 480p; the model speaks the written line itself (its voice and its dialect are the ones we use).
"""
import json
import math
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seedance_lab as L  # noqa: E402

OUT = L.ROOT / "local-data" / "video3"  # the first single-person takes are kept in video3/ as <file>.mp4; the two-shots are <file>.two.mp4
FACES = L.LAB / "faces"
REF = {"P6": ("P6_s_urls.json", 3), "P1": ("P1_t_urls.json", 0)}
WHO = {"P6": "the middle-aged man in the navy jacket and white polo", "P1": "the old man in the sun hat and olive shirt"}


def portrait(p):
    f, i = REF[p]
    return json.loads((FACES / f).read_text(encoding="utf-8"))[i]


def one(row):
    speaker, text, seconds, file = row["speaker"], row["text"], row["seconds"], row["file"]
    target = OUT / file.replace(".wav", ".two.mp4")
    if target.exists():
        return file, "have"
    mp3 = OUT / (file + ".mp3")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(L.ROOT / "local-data/audio/gemini-3.8-flash-tts" / file), "-b:a", "128k", str(mp3)], check=True)
    import re
    pair = {"이": "가", "가": "가", "은": "는", "는": "는", "을": "를", "를": "를"}  # the residents say it as "메디얼이라는 에이아이가" (tts_scenes.spoken)
    say = re.sub(r"MEDial(이|가|은|는|을|를)?", lambda m: "메디얼이라는 에이아이" + pair.get(m.group(1) or "", ""), text)
    cast = [p for p in REF if p in row["cast"]]
    names = {p: "%s (@Image%d)" % (WHO[p], i + 1) for i, p in enumerate(cast)}
    others = [names[p] for p in cast if p != speaker]
    prompt = ("Medium two-shot, fixed camera, no camera movement. %s stand together in the same persimmon and cabbage field above a small fishing "
              "village and the sea in Namhae, Korea, both visible from the waist up, facing each other at a slight angle. Only %s speaks: he talks "
              "Korean naturally in a thick Gyeongsang-province accent, the way a farmer in a village talks, with small natural head and hand "
              "movements, and his mouth moves with the words. %s stays silent, listens and reacts a little, mouth closed. He says: \"%s\"" % (
                  " and ".join(names[p] for p in cast), names[speaker], " and ".join(others).capitalize() if others else "The other", say))
    voice_of = [{"type": "audio_url", "audio_url": {"url": L.data_uri(mp3, "audio/mpeg")}, "role": "reference_audio"}]
    body = {"model": "dreamina-seedance-2-5-260628", "generate_audio": True, "ratio": "16:9", "resolution": "480p", "watermark": False,
            "duration": min(15, max(4, math.ceil(seconds + 0.8))),
            "content": [{"type": "text", "text": prompt}]
                       + [{"type": "image_url", "image_url": {"url": portrait(p)}, "role": "reference_image"} for p in cast] + voice_of}
    tid = L.call("/contents/generations/tasks", body)["id"]
    while True:
        time.sleep(8)
        got = L.call("/contents/generations/tasks/" + tid)
        if got["status"] in ("succeeded", "failed", "cancelled", "expired"):
            break
    if got["status"] != "succeeded":
        return file, "FAILED %s" % got.get("error")
    for _ in range(3):
        try:
            target.write_bytes(urllib.request.urlopen(got["content"]["video_url"], timeout=180).read()); break
        except Exception:
            time.sleep(3)
    mp3.unlink()
    return file, "ok %s tokens" % got.get("usage", {}).get("total_tokens")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    scene = sys.argv[2]
    rows = json.load(open(L.ROOT / "local-data/audio/gemini-3.8-flash-tts/scenes.json", encoding="utf-8"))[scene]
    cast = sorted({r["speaker"] for r in rows if r["speaker"] in REF})
    todo = [dict(r, cast=cast) for r in rows if r["speaker"] in REF]
    print(scene, len(rows), "lines;", len(todo), "to make")
    with ThreadPoolExecutor(3) as ex:
        for file, state in ex.map(one, todo):
            print(file, state, flush=True)


main()
