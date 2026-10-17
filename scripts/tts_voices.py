"""The voices of the exhibition: one Voice design per person, made once, kept by id.

    python scripts/tts_voices.py list                 # who has a voice (local-data/tts/voices.json)
    python scripts/tts_voices.py make P3 P7           # (re)design these voices; the old id is deleted
    python scripts/tts_voices.py calibrate P1 P3      # measure a voice; draw again until its pitch is back at the approved one

All twelve residents are lifelong people of Eunjeom, Namhae County (South Gyeongsang), so each one has a
heavy Gyeongsang dialect; what tells them apart is age, pitch, timbre, pace and temper. A person's
voice is fixed here - the line-by-line acting (worry, annoyance, relief) is a separate, short note on
each line (tts_scenes.py styles). The description is English because the model reads it best that way;
it is one or two sentences, as the Voice design guide asks (long descriptions drift).

The ids are in local-data/tts/voices.json (not committed); the descriptions below are the record of
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
FILE = ROOT / "local-data" / "tts" / "voices.json"
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
    # P6 is the first design the researcher approved by ear ("the early one was much better"): the heavy-dialect
    # template made him worse, so he keeps his own plainer description.
    "P6": ("male", "A 56-year-old man from a small fishing village in Namhae County, South Gyeongsang Province, a lifelong native speaking authentic Namhae Gyeongsang dialect in a hearty, dependable, slightly gruff voice, the kind of neighbour everyone relies on."),
    "P7": ("male", "A 58-year-old man who works on a fishing boat. Mild, soft-spoken, mid-low voice; shy and careful." + LIFE),
    "P8": ("male", "A 57-year-old man who works on a fishing boat. Lighter, higher-pitched voice, brisk and easygoing." + LIFE),
    "P9": ("male", man(58, "pension owner") + "Smooth, polite soft baritone; mild and slightly tired, more refined than the others."),
    # Sex follows the interview record (2026-09-28): P11 is the only woman, P10 is a man. Names do not tell.
    "P10": ("male", man(75, "restaurant owner who also farms") + "Steady, quietly capable old man's voice; mid-low, calm and unhurried, with a plain practical tone."),
    "P11": ("female", "A 79-year-old woman who runs a small restaurant with her husband" + FROM % ("she", "her") + "Thin, slightly raspy old woman voice; warm, motherly, talkative and quick, a little worn by aches."),
    "P12": ("male", man(63, "shop owner") + "Smooth, slightly nasal mid-high voice; quick-witted, sly, businesslike."),
    # Not residents: the system's voice and the health centre's nurse speak standard Korean.
    "MEDIAL": ("female", "A composed, bright woman in her mid-30s speaking clear standard Korean at a brisk, natural conversational pace, with a crisp, friendly, matter-of-fact tone; confident and efficient, not soft, not breathy, not sing-song."),
    # The narrator of the opening film and the closing page: not a resident, not MEDial (a bright woman), so the
    # audience never takes the narration for the system speaking. Low, standard Korean, brisk because time is short.
    "NARRATOR": ("male", "A man in his 40s narrating a design exhibition film in clear standard Seoul Korean: a low, calm, steady voice with a smooth documentary delivery, brisk and confident, no dialect, no sing-song."),
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


#: The median pitch (Hz) each voice had when the researcher approved it by ear (2026-10-13). A voice
#: is a random draw from its description, so a re-made one is measured and drawn again until it is
#: back within TOLERANCE of this - the pitch is the one thing that was complained about (P1 too high).
TARGET_HZ = {"P1": 132, "P2": 139, "P3": 121, "P4": 115, "P5": 107, "P6": 129, "P7": 95, "P8": 115,
             "P9": 114, "P10": 174, "P11": 130, "P12": 126}
TOLERANCE = 14
SAMPLE = "내가 언제 밭에 오는지 남한테까지 알리나? 영 싫네."


def pitch(path: Path) -> float:
    """Median fundamental frequency of the voiced parts (autocorrelation; for comparing voices, not for science)."""
    import struct
    import wave

    with wave.open(str(path)) as w:
        rate, raw = w.getframerate(), w.readframes(w.getnframes())
    x = struct.unpack("<%dh" % (len(raw) // 2), raw)
    n, found = int(rate * 0.04), []
    for start in range(0, len(x) - n * 2, n):
        frame = x[start:start + n * 2]
        if sum(abs(v) for v in frame) / len(frame) < 800:
            continue
        best = max(range(int(rate / 350), int(rate / 60)),
                   key=lambda lag: sum(frame[i] * frame[i + lag] for i in range(n)))
        found.append(rate / best)
    found.sort()
    return found[len(found) // 2] if found else 0.0


def calibrate(names):
    sys.path.insert(0, str(ROOT / "scripts"))
    import tts_scenes as t

    ids = json.load(open(FILE))
    out = ROOT / "local-data" / "audio" / "calibration"
    out.mkdir(parents=True, exist_ok=True)
    for name in names:
        for attempt in range(6):
            path = out / ("%s.wav" % name)
            path.write_bytes(t.speak(key(), ids[name], SAMPLE, "", "gemini-3.8-flash-tts"))
            t.trim(path)
            hz = pitch(path)
            ok = abs(hz - TARGET_HZ[name]) <= TOLERANCE
            print("%-4s attempt %d: %3.0f Hz (target %d) %s" % (name, attempt + 1, hz, TARGET_HZ[name], "ok" if ok else "again"))
            if ok:
                break
            make([name])
            ids = json.load(open(FILE))
        else:
            print(name, "stayed outside the tolerance after 6 tries; left as is")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    mk = sub.add_parser("make")
    mk.add_argument("names", nargs="+")
    cal = sub.add_parser("calibrate")
    cal.add_argument("names", nargs="+")
    args = ap.parse_args()
    if args.cmd == "list":
        have = json.load(open(FILE)) if FILE.exists() else {}
        for name, (gender, text) in SPECS.items():
            print("%-9s %-6s %s %s" % (name, gender, have.get(name, "(none)"), text[:60]))
    elif args.cmd == "calibrate":
        calibrate(args.names)
    else:
        make(args.names)


if __name__ == "__main__":
    main()
