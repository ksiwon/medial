"""3안: the residents' lines as video (Seedance 2.5; text + fixed reference portraits + the place's picture + the line's voice as timbre).

    python scripts/video3.py scene <scene-id>        # every resident line of the scene
    python scripts/video3.py listen <scene-id>       # the 8 s "listening" take for the lines MEDial speaks (no sound of its own)

    env RES=480p|720p|1080p (default 480p)   ONLY=05 (a single line)   SEED=n   TAG=.name (default: .<res>)

Outputs go to local-data/video/clips/<file>.<res>.mp4. A rejected request (face filter) costs nothing; every accepted one is rendered and billed.
Portraits: local-data/video/lab/faces/<P>_<set>_urls.json (REF). See docs/presentations/2026-10-07-exhibition/design/ver3-design.md.
"""
import base64
import io
import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seedance_lab as L  # noqa: E402

SEED_OF_SCENE = 11
OUT = L.ROOT / "local-data" / "video" / "clips"
FACES = L.LAB / "faces"
RES = os.environ.get("RES", "480p")
TAG = os.environ.get("TAG", "." + RES)
ONLY = os.environ.get("ONLY")
REF = {"P6": ("P6_s_urls.json", 3), "P1": ("P1_t_urls.json", 0), "P9": ("P9_u_urls.json", 0), "P12": ("P12_u_urls.json", 0),
       "P7": ("P7_u_urls.json", 0), "P8": ("P8_u_urls.json", 1), "HC_NURSE": ("HC_NURSE_u_urls.json", 0)}
WHO = {"P6": "the middle-aged man in the navy jacket and white polo", "P1": "the old man in the sun hat and olive shirt",
       "P9": "the grey-haired man in the grey hoodie", "P12": "the grey-haired man in the dark fleece jacket",
       "P7": "the man in the navy cap and work jacket", "P8": "the grey-haired heavy-set man in the green fleece vest and plaid shirt",
       "HC_NURSE": "the woman in the white coat with a blue lanyard"}
# kind: pair = two people in one close two-shot; call = one person on the phone; special = the emergency
SCENES = {
    "d1-w2": dict(bg="PATROL", cast=["P6"], kind="call", place="on a village road by the sea during his patrol, a phone held to his ear"),
    "d1-w3-disclosed": dict(bg="FARM", cast=["P1", "P6"], kind="pair"),
    "d2-t2": dict(bg="HOME", cast=["P9"], kind="call", place="inside his house, a phone held to his ear"),
    "d2-w3-factonly": dict(bg="FARM", cast=["P1", "P6"], kind="pair"),
    "d3-w3-nurse": dict(bg="CLINIC", cast=["HC_NURSE"], kind="call", place="at her desk in a small rural health centre office with a window, a landline phone held to her ear"),
    "d3-m2-search": dict(bg="TOWN", cast=["P12"], kind="call", place="on the street of a small coastal town, a phone held to his ear"),
    "d3-e2": dict(bg="HOME", cast=["P7", "P8"], kind="special"),
}
HE = {"HC_NURSE": "She"}


def portrait(p):
    f, i = REF[p]
    return json.loads((FACES / f).read_text(encoding="utf-8"))[i]


def location(art):
    from PIL import Image
    im = Image.open(L.ROOT / "local-data/art" / (art + ".webp")).convert("RGB")
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=90)
    return {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()}, "role": "reference_image"}


HOURS = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열", "열한", "열두"]
TENS = ["", "십", "이십", "삼십", "사십", "오십"]
UNITS = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"]


def clock(m):
    """09:52 -> 아홉 시 오십이 분: the model reads digits as numbers (15 52) otherwise."""
    h, mi = int(m.group(1)), int(m.group(2))
    return "%s 시%s" % (HOURS[h % 12 or 12], (" %s%s 분" % (TENS[mi // 10], UNITS[mi % 10])) if mi else "")


def spoken(text):
    pair = {"이": "가", "가": "가", "은": "는", "는": "는", "을": "를", "를": "를"}
    text = re.sub(r"(\d{1,2}):(\d{2})", clock, text)
    return re.sub(r"MEDial(이|가|은|는|을|를)?", lambda m: "메디얼이라는 에이아이" + pair.get(m.group(1) or "", ""), text)


# words the model says wrong unless told how (found by listening back: scripts/video3_stt.py)
SAY = {"메디얼": "pronounced clearly in three syllables: me, di, eol", "밭": "pronounced 'bat' (a field), with a final t sound, not 'bap' or 'bak'"}


def prompt_for(cfg, speaker, say, n_images):
    cast = cfg["cast"]
    names = {p: "%s (@Image%d)" % (WHO[p], i + 1) for i, p in enumerate(cast)}
    # every take of a scene is its own generation: say the camera does not move between them, or the background is a different view each time
    loc = (" The place is exactly the one in @Image%d, seen from exactly the camera position, angle, lens and framing of that picture; the background "
           "never changes between shots of this scene. Natural daylight, the same lighting in every shot." % n_images)
    he = HE.get(speaker, "He")
    word = "".join(' The word "%s" is %s.' % (w, how) for w, how in SAY.items() if w in say)
    voice = ("%s talks Korean naturally in a thick Gyeongsang-province accent, the way a person in a village in Namhae talks, with small natural "
             "movements, and the mouth moves with the words.%s %s says: \"%s\"" % (he, word, he, say))
    if cfg["kind"] == "pair":
        a, b = cast
        other = names[b if speaker == a else a]
        return ("Medium two-shot, fixed camera, no camera movement. %s stand together in the same persimmon and cabbage field above a small fishing "
                "village and the sea in Namhae, Korea, both visible from the waist up, facing each other at a slight angle, %s on the left side of the frame and %s on the right side, and they keep these positions. Only %s speaks. %s stays "
                "silent, listens and reacts a little, mouth closed.%s %s" % (" and ".join(names[p] for p in cast), names[a], names[b], names[speaker], other.capitalize(), loc, voice))
    if cfg["kind"] == "special":
        return ("Medium shot, fixed camera, no camera movement. %s kneels on the floor beside %s who lies unconscious on his back, doing chest "
                "compressions with both hands, frightened and out of breath, speaking toward a phone on the floor. Only %s speaks.%s %s" % (
                    names["P7"], names["P8"], names["P7"], loc, voice))
    return ("Medium close-up, fixed camera, no camera movement. %s is %s. Only this person is in the frame.%s %s" % (
        names[speaker].capitalize(), cfg["place"], loc, voice))


def submit(body):
    tid = L.call("/contents/generations/tasks", body)["id"]
    while True:
        time.sleep(8)
        got = L.call("/contents/generations/tasks/" + tid)
        if got["status"] in ("succeeded", "failed", "cancelled", "expired"):
            return got


def save(got, target):
    for _ in range(3):
        try:
            target.write_bytes(urllib.request.urlopen(got["content"]["video_url"], timeout=180).read())
            return
        except Exception:
            time.sleep(3)


def one(job):
    cfg, row = job["cfg"], job["row"]
    speaker, file = row["speaker"], row["file"]
    target = OUT / file.replace(".wav", TAG + ".mp4")
    if target.exists():
        return file, "have"
    mp3 = OUT / (file + ".mp3")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(L.ROOT / "local-data/audio/gemini-3.8-flash-tts" / file), "-af", "apad=whole_dur=2", "-b:a", "128k", str(mp3)], check=True)
    refs = [{"type": "image_url", "image_url": {"url": portrait(p)}, "role": "reference_image"} for p in cfg["cast"]] + [location(cfg["bg"])]
    body = {"model": "dreamina-seedance-2-5-260628", "generate_audio": True, "ratio": "16:9", "resolution": RES, "watermark": False,
            "duration": min(15, max(4, math.ceil(row["seconds"] + 0.8))),
            "content": [{"type": "text", "text": prompt_for(cfg, speaker, spoken(row["text"]), len(refs))}] + refs
                       + [{"type": "audio_url", "audio_url": {"url": L.data_uri(mp3, "audio/mpeg")}, "role": "reference_audio"}]}
    body["seed"] = int(os.environ.get("SEED", SEED_OF_SCENE))  # one seed for a scene: its takes then start from the same composition
    got = submit(body)
    mp3.unlink()
    if got["status"] != "succeeded":
        return file, "FAILED %s" % got.get("error")
    save(got, target)
    return file, "ok %s tokens seed %s" % (got.get("usage", {}).get("total_tokens"), got.get("seed"))


def listen(scene):
    cfg = SCENES[scene]
    who = [p for p in cfg["cast"] if p != "P8"][0]
    target = OUT / ("%s.listen%s.mp4" % (scene, TAG))
    if target.exists():
        print("have", target.name)
        return
    refs = [{"type": "image_url", "image_url": {"url": portrait(p)}, "role": "reference_image"} for p in cfg["cast"]] + [location(cfg["bg"])]
    loc = " The place is exactly the one in @Image%d, natural lighting." % len(refs)
    if cfg["kind"] == "special":
        text = ("Medium shot, fixed camera. %s kneels beside %s who lies on the floor and keeps pressing his chest, breathing hard, glancing at the phone "
                "on the floor and listening, mouth closed, not speaking.%s" % (WHO["P7"].capitalize() + " (@Image1)", WHO["P8"] + " (@Image2)", loc))
    else:
        text = ("Medium close-up, fixed camera. %s (@Image1) is %s, listening carefully to the voice on the phone, mouth closed, not speaking, small nods "
                "and slight changes of expression.%s" % (WHO[who].capitalize(), cfg.get("place", "in the place"), loc))
    body = {"model": "dreamina-seedance-2-5-260628", "generate_audio": False, "ratio": "16:9", "resolution": RES, "watermark": False, "duration": 8,
            "content": [{"type": "text", "text": text}] + refs}
    got = submit(body)
    print(target.name, got["status"], got.get("usage"), got.get("error") or "")
    if got["status"] == "succeeded":
        save(got, target)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cmd, scene = sys.argv[1], sys.argv[2]
    if cmd == "listen":
        listen(scene)
        return
    rows = json.load(open(L.ROOT / "local-data/audio/gemini-3.8-flash-tts/scenes.json", encoding="utf-8"))[scene]
    cfg = SCENES[scene]
    todo = [dict(cfg=cfg, row=r) for r in rows if r["speaker"] in cfg["cast"] and (not ONLY or ("_%s_" % ONLY) in r["file"])]
    print(scene, len(rows), "lines;", len(todo), "to make at", RES)
    with ThreadPoolExecutor(3) as ex:
        for file, state in ex.map(one, todo):
            print(file, state, flush=True)


if __name__ == "__main__":
    main()
