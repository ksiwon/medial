"""The voices of the exhibition: one Voice design per person, made once, kept by id.

    python scripts/tts_voices.py list                 # who has a voice (local-data/tts-voices.json)
    python scripts/tts_voices.py make P3 P7           # (re)design these voices; the old id is deleted

All twelve residents are lifelong people of Eunjeom, Namhae County (South Gyeongsang), so each one has a
heavy Gyeongsang dialect; what tells them apart is age, pitch, timbre, pace and temper. A person's
voice is fixed here - the line-by-line acting (worry, annoyance, relief) is a separate, short note on
each line (tts_scenes.py styles). The description is English because the model reads it best that way;
it is one or two sentences, as the Voice design guide asks (long descriptions drift).

The ids are in local-data/tts-voices.json (not committed); the descriptions below are the record of
how each voice was asked for. gemini-3.8-flash-tts sometimes answers a design with a 500 or a safety
refusal; ``make`` tries again, and a different wording usually passes.
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.stdout.reconfigure(encoding="utf-8")
FILE = ROOT / "local-data" / "tts-voices.json"
URL = "https://generativelanguage.googleapis.com/v1beta/voices"

LIFE = (" Lifelong resident of Eunjeom, a tiny seaside village in Namhae County, South Gyeongsang Province, "
        "speaking very heavy, broad, unmistakable Namhae Gyeongsang dialect with a strong abrupt pitch accent, "
        "steep falling endings and thick rural intonation.")
FROM = (" from Eunjeom, a tiny fishing village in Namhae County, South Gyeongsang Province, where %s has lived "
        "all %s life. Speaks very heavy, broad, unmistakable Namhae Gyeongsang dialect (saturi) with a strong "
        "abrupt pitch accent, steep falling sentence endings and thick rural intonation. ")


def man(age, job):
    return "A %d-year-old %s" % (age, job) + FROM % ("he", "his")


SPECS: dict[str, tuple[str, str]] = {
    "P1": ("male", man(72, "farmer") + "Very deep, low-pitched, firm and clear bass voice of a man who has worked outdoors for decades; blunt and curt, speaks at a natural pace without drawling, smooth with no breathiness, never high or thin."),
    "P2": ("male", man(66, "builder") + "Loud, booming, gravelly voice; hearty, fast-talking, a bit domineering."),
    "P3": ("male", man(65, "retired man") + "Plain, steady mid-low voice with an ordinary tone; mild, even-tempered and a little reserved, speaks at a natural pace."),
    "P4": ("male", man(56, "factory manager") + "Crisp, clear mid-high voice; businesslike, quick, a little anxious and responsible."),
    "P5": ("male", man(68, "fisherman and farmer") + "Raspy, sea-weathered low voice; laconic, slow, gruff but warm."),
    "P6": ("male", man(56, "village head") + "Warm mid-pitched baritone; hearty, dependable, friendly authority, medium pace."),
    "P7": ("male", "A 58-year-old man who works on a fishing boat. Mild, soft-spoken, mid-low voice; shy and careful." + LIFE),
    "P8": ("male", "A 57-year-old man who works on a fishing boat. Lighter, higher-pitched voice, brisk and easygoing." + LIFE),
    "P9": ("male", man(58, "pension owner") + "Smooth, polite soft baritone; mild and slightly tired, more refined than the others."),
    "P10": ("female", "A 75-year-old woman who runs a small restaurant" + FROM % ("she", "her") + "Thin, high-pitched, raspy old woman voice; warm, motherly, talkative and quick."),
    "P11": ("male", man(79, "restaurant owner") + "Elderly but sturdy and healthy voice; low, gravelly and firm, a little slower than younger men but clear and steady, with a stubborn old-timer's authority."),
    "P12": ("male", man(63, "shop owner") + "Smooth, slightly nasal mid-high voice; quick-witted, sly, businesslike."),
    # Not residents: the system's voice and the health centre's nurse speak standard Korean.
    "MEDIAL": ("female", "A composed, bright woman in her mid-30s speaking clear standard Korean at a brisk, natural conversational pace, with a crisp, friendly, matter-of-fact tone; confident and efficient, not soft, not breathy, not sing-song."),
    "HC_NURSE": ("female", "A woman in her mid-40s who works at a small rural clinic in South Korea, speaking clear standard Korean with a calm, courteous, professional voice."),
}


def key() -> str:
    for line in io.open(ROOT / "server" / ".env", encoding="utf-8"):
        if line.startswith("GEMINI_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("server/.env 에 GEMINI_API_KEY 가 없다")


def call(method: str, path: str = "", body=None):
    req = urllib.request.Request(URL + path, data=json.dumps(body).encode() if body else None, method=method,
                                 headers={"Content-Type": "application/json", "x-goog-api-key": key()})
    return json.load(urllib.request.urlopen(req, timeout=240))


def make(names):
    ids = json.load(open(FILE)) if FILE.exists() else {}
    for name in names:
        gender, text = SPECS[name]
        for attempt in range(6):
            body = {"store": True, "voice": {"model": "gemini-3.8-flash-tts", "type": "prompted",
                                             "display_name": "medial-" + name, "gender": gender,
                                             "language_code": "ko-KR", "prompted": {"input": text}}}
            try:
                new = call("POST", "", body)["id"]
                break
            except urllib.error.HTTPError as e:
                print(name, "attempt", attempt + 1, e.code)
                time.sleep(15)
        else:
            raise SystemExit("%s: could not be designed; reword it in SPECS" % name)
        if name in ids:
            try:
                call("DELETE", "/" + ids[name])
            except urllib.error.HTTPError:
                pass
        ids[name] = new
        print(name, new)
        FILE.write_text(json.dumps(ids), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    mk = sub.add_parser("make")
    mk.add_argument("names", nargs="+")
    args = ap.parse_args()
    if args.cmd == "list":
        have = json.load(open(FILE)) if FILE.exists() else {}
        for name, (gender, text) in SPECS.items():
            print("%-9s %-6s %s %s" % (name, gender, have.get(name, "(none)"), text[:60]))
    else:
        make(args.names)


if __name__ == "__main__":
    main()
