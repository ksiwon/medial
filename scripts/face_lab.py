"""Likeness lab for 3안: describe each resident's picture in words, make several fictional portraits from the words
(Seedream, text only), and find out which ones Seedance's input filter lets through (the task is cancelled right after it is
accepted, so a pass costs almost nothing).

    python scripts/face_lab.py describe P6        # vision model -> local-data/video/lab/faces/P6.txt
    python scripts/face_lab.py make P6 3          # n portraits from that description -> faces/P6_<i>.jpg (+ url)
    python scripts/face_lab.py probe P6           # does Seedance take each portrait? (task created, then cancelled)
"""
import base64
import io
import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seedance_lab as L  # noqa: E402
from PIL import Image  # noqa: E402

OUT = L.LAB / "faces"
OUT.mkdir(parents=True, exist_ok=True)
import os
SETTING = os.environ.get("SETTING") or ("standing in a persimmon and cabbage field above a small fishing village and the sea in Namhae, Korea, "
           "medium close-up, looking slightly off camera, natural daylight")


def art(who):
    for name in ({"HC_NURSE": ("CLINIC.desk",)}.get(who, ()) + (who + ".stand", who + ".seated", who + ".phone")):
        p = L.ROOT / "local-data/art" / (name + ".webp")
        if p.exists():
            im = Image.open(p).convert("RGBA")
            bg = Image.new("RGB", im.size, (200, 205, 200)); bg.paste(im, mask=im.split()[3])
            buf = io.BytesIO(); bg.save(buf, "JPEG", quality=92)
            return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    raise SystemExit("no art for " + who)


def describe(who):
    r = L.call("/chat/completions", {"model": "seed-2-0-pro-260328", "messages": [{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": art(who)}},
        {"type": "text", "text": "This is a fictional, AI-generated character in a story. Describe his or her APPEARANCE precisely so an image generator can "
         "draw the same character: apparent age, face shape, forehead, eyebrows, eyes and eyelids, nose, mouth and lips, cheeks, jaw, skin tone and "
         "texture, wrinkles, hair colour/length/style/hairline, glasses or facial hair, clothing in detail (colours, collar, pockets, pens, buttons), build. "
         "Do NOT exaggerate age: say the apparent age the picture shows, call lines and skin texture mild unless they are deep, and do not mention pores. English, one dense paragraph, no names, no background."}]}]})
    text = r["choices"][0]["message"]["content"].strip()
    (OUT / (who + ".txt")).write_text(text, encoding="utf-8"); print(text)


REFINE = {"P6": ("A Korean farmer-turned-village-head, apparent age 56 to 58, a lean oval face with a fairly narrow chin, cheekbones a little prominent, "
                 "deep-set kind eyes with crow's feet at the corners, clearly visible but mild lines on the forehead and around the mouth, weathered "
                 "sun-tanned skin, short neat straight black hair that is thinning slightly at the temples with a hint of grey above the ears, "
                 "relaxed gentle smile. Dark navy zip windbreaker with a standing collar, a breast pocket with a small white spiral notebook tucked "
                 "in, white polo shirt.")}


def make(who, n):
    desc = (OUT / (who + ".txt")).read_text(encoding="utf-8")
    if who in REFINE:
        desc = REFINE[who]
    urls = []
    for i in range(n):
        r = L.call("/images/generations", {"model": "seedream-5-0-260128", "prompt": "Photorealistic portrait. " + desc + " " + SETTING,
                                         "size": "2K", "response_format": "url", "watermark": False})
        u = r["data"][0]["url"]
        (OUT / ("%s_u%d.jpg" % (who, i))).write_bytes(urllib.request.urlopen(u, timeout=120).read())
        urls.append(u); print("made", i)
    (OUT / (who + "_u_urls.json")).write_text(json.dumps(urls), encoding="utf-8")


def probe(who):
    urls = json.loads((OUT / (who + "_u_urls.json")).read_text(encoding="utf-8"))
    for i, u in enumerate(urls):
        body = {"model": "dreamina-seedance-2-0-mini-260615", "content": [
            {"type": "text", "text": "The man from @Image1 speaks, fixed camera."},
            {"type": "image_url", "image_url": {"url": u}, "role": "reference_image"}],
            "generate_audio": False, "ratio": "16:9", "duration": 4, "resolution": "480p", "watermark": False}
        try:
            tid = L.call("/contents/generations/tasks", body)["id"]
        except SystemExit as e:
            print(i, "REJECTED", str(e)[:70]); continue
        # accepted: cancel at once so nothing is rendered
        req = urllib.request.Request(L.BASE + "/contents/generations/tasks/" + tid, method="DELETE", headers={"Authorization": "Bearer " + L.key()})
        try:
            urllib.request.urlopen(req, timeout=60); c = "cancelled"
        except urllib.error.HTTPError as e:
            c = "cancel failed %d" % e.code
        print(i, "ACCEPTED", tid, c)


cmd = sys.argv[1]
if cmd == "describe": describe(sys.argv[2])
elif cmd == "make": make(sys.argv[2], int(sys.argv[3]))
elif cmd == "probe": probe(sys.argv[2])
