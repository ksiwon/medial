"""Speaks the exhibition scenes' lines with Gemini TTS, once, ahead of time (never live).

    python scripts/tts_scenes.py list              # the lines and what is sent for each (no calls)
    python scripts/tts_scenes.py make              # missing audio only -> local-data/audio/<model>/<hash>.wav
    python scripts/tts_scenes.py make --limit 40   # stop after this many calls (the daily quota is 100)
    python scripts/tts_scenes.py styles            # each line's acting note -> local-data/tts-styles.json

What the screen shows and what the voice reads are different strings. ``spoken`` is the voice's:
"MEDial" is always read 메디얼 (without it the voice said 엠이디얼, 미디알, ...), clock times and
minutes are written out the way a person says them (08:00 -> 여덟 시, 20:56 -> 여덟 시 오십육 분).
The voice of each person is a Voice design id (`local-data/tts-voices.json`, made once with
gemini-3.8-flash-tts; the description carries the age, the dialect and the timbre). Style text goes in
speech_metadata, never in the text: the model reads whatever is in the text aloud.

Audio is named by the hash of (voice, spoken text, style), so a line that did not change is never made
twice and a changed line gets new audio. Nothing here is called at runtime; the screen plays the file.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.stdout.reconfigure(encoding="utf-8")

DB = ROOT / "local-data" / "runs" / "sim.sqlite3"
VOICES = ROOT / "local-data" / "tts-voices.json"
AUDIO_ROOT = ROOT / "local-data" / "audio"
MODEL = "gemini-3.8-flash-tts"  # --model gemini-3.8-flash-lite-tts for a cheaper, separately-metered try
#: MEDial's lines are delivered brisk; the residents' voices carry their own manner.
STYLE = {"MEDial": "brisk and efficient, natural pace"}
VOICE_KEY = {"MEDial": "MEDIAL"}
STYLES = ROOT / "local-data" / "tts-styles.json"
DIALOGUE = ROOT / "local-data" / "runs" / "dialogue-2026-10-13.json"

NOTES = """당신은 음성 연출가다. 마을 장면의 대사 한 줄마다 '연기 지시'를 짧은 영어로 쓴다. 이 지시는 Gemini TTS의 speech_metadata.style 로 들어가 그 줄의 감정·속도·세기만 정한다.

규칙
- 줄마다 2~6단어의 영어 구. 예: "worried, a little hurried", "gruff and curt", "relieved, softening", "frightened, short of breath", "brisk but reassuring".
- 지시는 그 줄에 일어나는 감정 한 가지와 속도만. 나이·성별·사투리·억양·음색은 쓰지 않는다(그것은 목소리가 이미 정한다). 장면 안에서 감정이 변하는 흐름을 줄마다 반영한다.
- MEDial은 기본이 brisk and efficient, friendly. 소식이 나쁘면 "brisk, a little sorry", 위급하면 "calm and steady, reassuring"처럼 조금만 바꾼다. 늘어지거나 간지럽게 하지 않는다.
- 과장하지 않는다. 한 줄을 읽는 데 어울리는 정도로만.
- lines 배열은 대사 수와 같은 길이, 같은 순서로 돌려준다. JSON만."""

NOTE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {"styles": {"type": "array", "items": {"type": "string"}}},
    "required": ["styles"],
}

NATIVE_HOUR = {0: "영", 1: "한", 2: "두", 3: "세", 4: "네", 5: "다섯", 6: "여섯", 7: "일곱", 8: "여덟", 9: "아홉",
               10: "열", 11: "열한", 12: "열두", 13: "열세", 14: "열네", 15: "열다섯", 16: "열여섯", 17: "열일곱",
               18: "열여덟", 19: "열아홉", 20: "스무", 21: "스물한", 22: "스물두", 23: "스물세", 24: "스물네"}
SINO = "영일이삼사오육칠팔구"


def sino(n: int) -> str:
    if n < 10:
        return SINO[n]
    tens, ones = divmod(n, 10)
    return ("" if tens == 1 else SINO[tens]) + "십" + ("" if ones == 0 else SINO[ones])


def spoken(text: str) -> str:
    """The line as it is read aloud."""
    def clock(m):
        h, mi = int(m.group(1)), int(m.group(2))
        h = h - 12 if h > 12 else h  # people say 한 시 for 13:00, 여덟 시 for 20:56
        return NATIVE_HOUR[h] + " 시" + ("" if mi == 0 else " " + sino(mi) + " 분")

    text = re.sub(r"(\d{1,2}):(\d{2})", clock, text)
    text = re.sub(r"(\d+)\s*분", lambda m: sino(int(m.group(1))) + " 분", text)
    return text.replace("MEDial", "메디얼")


def lines_of_record():
    """Every distinct spoken line of the played scenes: (speaker, shown text)."""
    conn = sqlite3.connect(DB)
    seen: dict[tuple[str, str], None] = {}
    for (blob,) in conn.execute("select scenes_json from attempts where scenes_json != '{}' order by rowid"):
        scenes = json.loads(blob)
        for ep in scenes["episodes"]:
            if ep["requestId"] not in scenes["featured"]:
                continue
            for beat in ep["beats"]:
                for ln in beat["lines"]:
                    if ln["kind"] == "say":
                        seen[(ln["speaker"], ln["text"])] = None
    return list(seen)


def styles_of_record():
    """The acting note written for each line, by 'speaker|text' (empty when none was written)."""
    return json.load(open(STYLES, encoding="utf-8")) if STYLES.exists() else {}


def write_styles():
    sys.path.insert(0, str(ROOT / "scripts"))
    import gen_dialogue as g  # the briefs say who is in a scene and what happens

    client = g.ModelProvider.from_env(g.env)._client(g.policy_from_env(g.env, mode="off").headModelId)
    scenes = json.load(open(DIALOGUE, encoding="utf-8"))["scenes"]
    out = {}
    for key, scene in scenes.items():
        brief = g.BRIEFS[key]
        payload = {"장면": brief["scene"], "인물": brief["people"], "끝맺음": brief["ending"],
                   "대사": ["%s: %s" % (l["speaker"], l["text"]) for l in scene["lines"]]}
        for _ in range(3):
            raw, _u = client._post(NOTES, payload, NOTE_SCHEMA, "scene_styles", 2000)
            notes = (raw if isinstance(raw, dict) else json.loads(raw))["styles"]
            if len(notes) == len(scene["lines"]):
                break
        else:
            raise SystemExit("%s: styles do not match the lines" % key)
        for ln, note in zip(scene["lines"], notes):
            out["%s|%s" % (ln["speaker"], ln["text"])] = note
            print("%-8s %-34s %s" % (ln["speaker"], note, ln["text"]))
        print()
    STYLES.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


def key_of(voice: str, text: str, style: str) -> str:
    return hashlib.sha1(json.dumps([voice, text, style], ensure_ascii=False).encode()).hexdigest()[:16]


def api_key() -> str:
    for line in io.open(ROOT / "server" / ".env", encoding="utf-8"):
        line = line.strip()
        if line.startswith("GEMINI_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("server/.env 에 GEMINI_API_KEY 가 없다")


def speak(key: str, voice: str, text: str, style: str, model: str = MODEL) -> bytes:
    item = {"type": "text", "text": text}
    if style:
        item["annotations"] = [{"type": "speech_metadata", "style": style}]
    body = {"model": model, "input": [{"type": "user_input", "content": [item]}],
            "response_format": {"type": "audio"},
            "generation_config": {"speech_config": [{"voice": voice}]}}
    req = urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/interactions",
                                 data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "x-goog-api-key": key})
    reply = json.load(urllib.request.urlopen(req, timeout=180))
    for step in reply.get("steps", []):
        for part in step.get("content", []):
            if part.get("type") == "audio" and part.get("data"):
                return base64.b64decode(part["data"])
    raise RuntimeError("no audio in the reply")


def trim(path: Path) -> None:
    """Cut the silence and any stray noise before the voice starts and after it ends.

    The model starts every clip with about 0.2 s of near-silence and a click, and may end with a
    long tail; the screen wants the line to begin the moment it is played and to end when it is over.
    A 40 ms lead and a 10 ms fade-in are left so the voice does not start with a hard edge.
    """
    import audioop

    with wave.open(str(path)) as w:
        params, raw = w.getparams(), w.readframes(w.getnframes())
    step = params.framerate // 100  # 10 ms
    size = step * 2
    loud = [i for i in range(0, len(raw) - size, size) if audioop.rms(raw[i:i + size], 2) > 400]
    if not loud:
        return
    start = max(0, loud[0] - 4 * size)
    end = min(len(raw), loud[-1] + size * 12)
    body = bytearray(raw[start:end])
    fade = min(len(body) // 2, step * 2)  # 10 ms of samples * 2 bytes
    for k in range(0, fade, 2):
        v = int.from_bytes(body[k:k + 2], "little", signed=True)
        body[k:k + 2] = int(v * (k / fade)).to_bytes(2, "little", signed=True)
    with wave.open(str(path), "wb") as w:
        w.setparams(params)
        w.writeframes(bytes(body))


def seconds(path: Path) -> float:
    with wave.open(str(path)) as w:
        return w.getnframes() / w.getframerate()


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    sub.add_parser("styles")
    mk = sub.add_parser("make")
    mk.add_argument("--limit", type=int, default=90)
    mk.add_argument("--model", default=MODEL)
    args = ap.parse_args()
    if args.cmd == "styles":
        write_styles()
        return
    voices = json.load(open(VOICES, encoding="utf-8"))
    todo = []
    notes = styles_of_record()
    for speaker, text in lines_of_record():
        voice = voices.get(VOICE_KEY.get(speaker, speaker))
        if voice is None:
            raise SystemExit("no voice for %s (local-data/tts-voices.json)" % speaker)
        say, style = spoken(text), notes.get("%s|%s" % (speaker, text)) or STYLE.get(speaker, "")
        todo.append((speaker, text, voice, say, style, key_of(voice, say, style)))
    if args.cmd == "list":
        for speaker, text, _voice, say, _style, key in todo:
            print("%-9s %s  %s%s" % (speaker, key, text, "" if say == text else "\n%s -> %s" % (" " * 20, say)))
        print(len(todo), "lines")
        return
    AUDIO = AUDIO_ROOT / args.model
    AUDIO.mkdir(parents=True, exist_ok=True)
    key, made, manifest = api_key(), 0, {}
    for speaker, text, voice, say, style, name in todo:
        path = AUDIO / ("%s.wav" % name)
        if not path.exists():
            if made >= args.limit:
                print("stopped at the limit (%d calls); run again later" % made)
                break
            try:
                path.write_bytes(speak(key, voice, say, style, args.model))
                trim(path)
            except urllib.error.HTTPError as e:
                print("HTTP", e.code, e.read()[:200].decode("utf-8", "ignore"))
                break
            made += 1
            time.sleep(0.5)
        if path.exists():
            manifest["%s|%s" % (speaker, text)] = {"file": path.name, "seconds": round(seconds(path), 2)}
    (AUDIO / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print("made %d, have %d of %d lines" % (made, len(manifest), len(todo)))


if __name__ == "__main__":
    main()
