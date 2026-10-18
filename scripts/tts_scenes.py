"""Speaks the exhibition's lines with Gemini TTS, once, ahead of time (never live).

    python scripts/tts_scenes.py list              # the lines and what is sent for each (no calls)
    python scripts/tts_scenes.py check             # is everything ready to make? (no calls, no key read)
    python scripts/tts_scenes.py styles            # each line's acting note -> fixtures/week/tts-styles.json (model calls)
    python scripts/tts_scenes.py make              # missing audio only -> local-data/audio/<model>/<scene>_<NN>_<speaker>.wav
    python scripts/tts_scenes.py make --limit 40   # at most this many calls per key (the daily quota is 100 per project)

What is spoken is the week's dialogue (``fixtures/week/dialogue.json``: the scenes before and after each request)
and the narration of the opening film and the closing page (``fixtures/exhibition/narration.json``). Each line is
its own file with ``scenes.json`` listing a scene's lines in order and ``manifest.json`` mapping 'speaker|text' to
the file for the screen. What the screen shows and what the voice reads are different strings: ``spoken`` is the
voice's. Clock times and minutes are written out the way a person says them (08:00 -> 여덟 시, 20:56 -> 여덟 시
오십육 분) and "AI" is read 에이아이.

The voice of each person is a Voice design id (`local-data/tts/voices.json`, made once with gemini-3.8-flash-tts;
the description carries the age, the dialect and the timbre). Style text goes in speech_metadata, never in the
text: the model reads whatever is in the text aloud.

A line is made again only when its (voice, spoken text, style) hash changed. Nothing here is called at runtime; the
screen plays the file. The acting notes are written by ``scripts/model.py`` (OpenAI); the voice is Gemini. Neither
key is read by ``list`` or ``check``.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import re
import sys
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.stdout.reconfigure(encoding="utf-8")

VOICES = ROOT / "local-data" / "tts" / "voices.json"
AUDIO_ROOT = ROOT / "local-data" / "audio"
MODEL = "gemini-3.8-flash-tts"  # --model gemini-3.8-flash-lite-tts for a cheaper, separately-metered try
#: The AI's lines are delivered brisk; the residents' voices carry their own manner.
STYLE = {"AI": "brisk and efficient, natural pace",
         "NARRATOR": "calm, low and steady narration, brisk pace, no pauses between phrases"}
# The week's dialogue, the narration and the acting notes are committed (synthetic lines of pseudonymous residents).
# The voices and the audio are not - they live in local-data/.
WEEK = ROOT / "fixtures" / "week"
STYLES = WEEK / "tts-styles.json"
DIALOGUE = WEEK / "dialogue.json"
BRIEFS = WEEK / "briefs.json"
NARRATION = ROOT / "fixtures" / "exhibition" / "narration.json"  # the opening film's big captions (and the closing page's)
#: The narration scenes a screen plays. ``outro`` is the closing page's, which the week's walk no longer has: its
#: recordings would have nowhere to play, so none is made until a closing page exists again.
NARRATION_PLAYED = ("intro",)

NOTES = """당신은 음성 연출가다. 마을 장면의 대사 한 줄마다 '연기 지시'를 짧은 영어로 쓴다. 이 지시는 Gemini TTS의 speech_metadata.style 로 들어가 그 줄의 감정·속도·세기만 정한다. 화자 AI는 안부를 살피고 이웃과 보건소를 잇는 AI 스피커다.

규칙
- 줄마다 2~6단어의 영어 구. 예: "worried, a little hurried", "gruff and curt", "relieved, softening", "frightened, short of breath", "brisk but reassuring".
- 지시는 그 줄에 일어나는 감정 한 가지와 속도만. 나이·성별·사투리·억양·음색은 쓰지 않는다(그것은 목소리가 이미 정한다). 장면 안에서 감정이 변하는 흐름을 줄마다 반영한다.
- AI는 기본이 brisk and efficient, friendly. 소식이 나쁘면 "brisk, a little sorry", 위급하면 "calm and steady, reassuring"처럼 조금만 바꾼다. 늘어지거나 간지럽게 하지 않는다.
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


#: Words the voice would get wrong as written. "Dially" is Dial + Diary: said 다이얼리, as it is meant to sound.
SAY = [("Dially", "다이얼리"), ("AI", "에이아이")]


def hour_word(h: int) -> str:
    """Hours as a person says them: 한 시, 열두 시, 여덟 시 (13:00 is 한 시, 20:00 is 여덟 시)."""
    return NATIVE_HOUR[h - 12 if h > 12 else h]


def spoken(text: str, speaker: str = "") -> str:
    """The line as it is read aloud: clock times and minutes written out, and the few names the voice would get
    wrong. ``speaker`` is kept for the callers that pass it; every voice reads the same words."""
    def clock(m):
        h, mi = int(m.group(1)), int(m.group(2))
        return hour_word(h) + " 시" + ("" if mi == 0 else " " + sino(mi) + " 분")

    text = re.sub(r"(\d{1,2}):(\d{2})", clock, text)
    # An hour already written 12시 (a range like 11시~13시 too) is read as a native number, not as 십이 시.
    text = re.sub(r"(\d{1,2})\s*시(?!간)", lambda m: hour_word(int(m.group(1))) + " 시", text)
    text = re.sub(r"(\d+)\s*분", lambda m: sino(int(m.group(1))) + " 분", text)
    text = re.sub(r"(\d+)\s*명", lambda m: NATIVE_HOUR[int(m.group(1))] + " 명" if int(m.group(1)) in NATIVE_HOUR else m.group(0), text)
    text = re.sub(r"\s*~\s*", "에서 ", text)  # 11시~13시 -> 열한 시에서 한 시
    for written, said in SAY:
        text = text.replace(written, said)
    return re.sub(r"\s{2,}", " ", text)


def planned():
    """Every spoken line, in scene order, with the file it is kept in.

    One line, one file: ``<scene>_<NN>_<speaker>.wav`` (E1.s1_03_P6.wav is the third line of scene E1.s1, spoken by
    P6). Nothing is bundled, so the code can pick any line by itself.
    """
    narration = {k: v for k, v in json.load(open(NARRATION, encoding="utf-8"))["scenes"].items() if k in NARRATION_PLAYED}
    scenes = {**json.load(open(DIALOGUE, encoding="utf-8"))["scenes"], **narration}
    voices = json.load(open(VOICES, encoding="utf-8")) if VOICES.exists() else {}
    notes = styles_of_record()
    for scene, body in scenes.items():
        for i, ln in enumerate(body["lines"], start=1):
            speaker, text = ln["speaker"], ln["text"]
            voice = voices.get(speaker)
            say, style = spoken(text, speaker), notes.get("%s|%s" % (speaker, text)) or STYLE.get(speaker, "")
            yield {"scene": scene, "index": i, "speaker": speaker, "text": text, "spoken": say, "style": style,
                   "voice": voice, "hash": key_of(voice or "", say, style), "file": "%s_%02d_%s.wav" % (scene, i, speaker)}


def styles_of_record():
    """The acting note written for each line, by 'speaker|text' (empty when none was written)."""
    return json.load(open(STYLES, encoding="utf-8")) if STYLES.exists() else {}


def write_styles():
    """One short acting note per dialogue line (the narration keeps its fixed style). Asks the model; writes the
    notes of the lines still without one, so a line already noted is never asked again."""
    sys.path.insert(0, str(ROOT / "scripts"))
    from model import Model

    client = Model()
    briefs = json.load(open(BRIEFS, encoding="utf-8"))
    situation = {}
    for ev in briefs["events"]:
        for k, sc in ev["scenes"].items():
            situation["%s.%s" % (ev["id"], k)] = sc["scene"]
        for k, r in ev["requests"].items():
            situation["%s.%s" % (ev["id"], k)] = r["scene"]["scene"]
    scenes = json.load(open(DIALOGUE, encoding="utf-8"))["scenes"]
    out = dict(styles_of_record())
    for key, scene in scenes.items():
        todo = [l for l in scene["lines"] if "%s|%s" % (l["speaker"], l["text"]) not in out]
        if not todo:
            continue
        payload = {"장면": situation[key], "인물": {c: briefs["voices"][c] for c in scene["cast"]},
                   "대사": ["%s: %s" % (l["speaker"], l["text"]) for l in scene["lines"]]}
        for _ in range(3):
            notes = client.ask(NOTES, payload, NOTE_SCHEMA, "scene_styles", 2000)["styles"]
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


def check(path: Path, text: str) -> str | None:
    """Why a clip must not be kept, or None. A clip is bad when it is silent or the wrong length."""
    import audioop

    with wave.open(str(path)) as w:
        raw, sr = w.readframes(w.getnframes()), w.getframerate()
    secs = len(raw) / 2 / sr
    chars = len(re.sub(r"\s", "", text))
    if secs < 0.6 or secs > 0.45 * chars + 3:
        return "length %.1fs for %d characters" % (secs, chars)
    if audioop.rms(raw, 2) < 500:
        return "silent"
    return None


def seconds(path: Path) -> float:
    with wave.open(str(path)) as w:
        return w.getnframes() / w.getframerate()


def check_ready(todo) -> list[str]:
    """What stands between this and a first call, as plain sentences. Reads no key and calls nothing."""
    out: list[str] = []
    speakers = sorted({it["speaker"] for it in todo})
    voices = json.load(open(VOICES, encoding="utf-8")) if VOICES.exists() else {}
    missing = [s for s in speakers if s not in voices]
    if missing:
        out.append("목소리가 없다: %s (python scripts/tts_voices.py make %s)" % (", ".join(missing), " ".join(missing)))
    sys.path.insert(0, str(ROOT / "scripts"))
    from tts_voices import stale_voices
    stale = [s for s in speakers if s in stale_voices() and s in voices]
    if stale:
        out.append("지금 명세와 다르게 만든 목소리라 쓸 수 없다: %s (python scripts/tts_voices.py make %s)"
                   % (", ".join(stale), " ".join(stale)))
    if voices and not missing:
        from tts_voices import usable
        unreachable = [sp for sp in speakers if not usable(sp, voices[sp])]
        if unreachable:
            out.append("지금 있는 키로는 볼 수 없는 목소리(다른 프로젝트에서 만든 것): %s (server/.env 에 그 프로젝트의 GEMINI_API_KEY_* 를 두세요)"
                       % ", ".join(unreachable))
    unstyled = [it for it in todo if it["speaker"] not in STYLE and not it["style"]]
    if unstyled:
        out.append("연기 지시가 없는 줄 %d개 (python scripts/tts_scenes.py styles)" % len(unstyled))
    digits = [it for it in todo if re.search(r"\d|[A-Za-z]", it["spoken"])]
    if digits:
        out.append("읽을 문장에 숫자·알파벳이 남은 줄 %d개: %s" % (len(digits), digits[0]["spoken"]))
    dup = [f for f in {it["file"] for it in todo} if sum(it["file"] == f for it in todo) > 1]
    if dup:
        out.append("같은 파일 이름이 겹친다: %s" % dup[:3])
    return out


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    sub.add_parser("check")
    sub.add_parser("styles")
    mk = sub.add_parser("make")
    mk.add_argument("--limit", type=int, default=90, help="calls per key (the daily quota is 100 per project)")
    mk.add_argument("--model", default=MODEL)
    args = ap.parse_args()
    if args.cmd == "styles":
        write_styles()
        return
    todo = list(planned())
    if args.cmd == "list":
        for it in todo:
            print("%-30s %-9s %s%s" % (it["file"], it["speaker"], it["text"],
                                       "" if it["spoken"] == it["text"] else "\n%s -> %s" % (" " * 41, it["spoken"])))
        print(len(todo), "lines")
        return
    problems = check_ready(todo)
    if args.cmd == "check":
        scenes = {it["scene"] for it in todo}
        print("%d lines in %d scenes; speakers: %s" % (len(todo), len(scenes), ", ".join(sorted({it["speaker"] for it in todo}))))
        for p in problems:
            print("막힘:", p)
        print("준비됨" if not problems else "준비 안 됨: %d가지" % len(problems))
        return
    if problems:
        raise SystemExit("만들 수 없다:\n- " + "\n- ".join(problems))
    AUDIO = AUDIO_ROOT / args.model
    AUDIO.mkdir(parents=True, exist_ok=True)
    index = AUDIO / "scenes.json"
    known = {row["file"]: row for rows in (json.load(open(index, encoding="utf-8")) if index.exists() else {}).values() for row in rows}
    from tts_voices import keys as key_pool, usable

    pool = key_pool()
    holders = {sp: usable(sp, v) for sp, v in {it["speaker"]: it["voice"] for it in todo}.items()}
    spent = {name: 0 for name in pool}      # calls made with each key this run (the quota is per project)
    full: set[str] = set()                  # keys that answered 429 and are left alone for the rest of the run
    made, failures, rejected, kept = 0, 0, [], {}
    for it in todo:
        path = AUDIO / it["file"]
        legacy = AUDIO / ("%s.wav" % it["hash"])  # the earlier, hash-named file of the same voice, text and style
        if path.exists() and known.get(it["file"], {}).get("hash") == it["hash"]:
            pass
        elif legacy.exists():
            legacy.replace(path)
        else:
            # Only a key whose project holds this voice may speak it: another project's key would answer 404, or
            # worse, nothing guarantees it is the same voice. Among those, the first with quota left (GEMINI_API_KEY
            # first, then GEMINI_API_KEY_SUB ...). A key that answers 429 is set aside and the *same line* goes on to
            # the next key that holds the voice; nothing is skipped.
            key_name, broken = None, False
            while True:
                usable_keys = [k for k in holders[it["speaker"]] if k not in full and spent[k] < args.limit]
                if not usable_keys:
                    break
                key_name = usable_keys[0]
                try:
                    for tries in range(3):  # a read timeout or a dropped connection is retried; a quota or a bad request is not
                        try:
                            path.write_bytes(speak(pool[key_name], it["voice"], it["spoken"], it["style"], args.model))
                            break
                        except (TimeoutError, ConnectionError, urllib.error.URLError) as e:
                            if isinstance(e, urllib.error.HTTPError) or tries == 2:
                                raise
                            print("retry %s: %s" % (it["file"], type(e).__name__))
                            time.sleep(3)
                    trim(path)
                    break
                except urllib.error.HTTPError as e:
                    print("HTTP", e.code, key_name, e.read()[:200].decode("utf-8", "ignore"))
                    if e.code == 429:
                        full.add(key_name)
                        print("%s is out of quota; %s" % (key_name, "trying the next key that holds this voice"
                                                         if any(k not in full for k in holders[it["speaker"]]) else "no other key holds this voice"))
                        key_name = None
                        continue
                    failures += 1
                    key_name, broken = None, True
                    break
            if key_name is None:
                if broken and failures < 3:
                    continue  # a broken request on this line: leave it, go on to the next
                print("stopped: no key with quota left holds %s's voice (%s); run again later or add that project's key"
                      % (it["speaker"], ", ".join("%s %d/%d" % (k, spent[k], args.limit) for k in holders[it["speaker"]]) or "no key"))
                break
            spent[key_name] += 1
            made += 1
            why = check(path, it["spoken"])
            if why:
                print("rejected %s: %s" % (it["file"], why))
                path.unlink()
                rejected.append(it["file"])
                continue
            time.sleep(0.3)
        if path.exists():
            kept.setdefault(it["scene"], []).append({
                "index": it["index"], "speaker": it["speaker"], "text": it["text"], "spoken": it["spoken"],
                "style": it["style"], "voice": it["voice"], "hash": it["hash"], "file": it["file"],
                "seconds": round(seconds(path), 2)})
    print("calls per key:", ", ".join("%s %d" % (k, n) for k, n in spent.items()))
    # scenes.json: the lines of each scene in order. manifest.json: the same by 'speaker|text', which is what the screen reads.
    index.write_text(json.dumps(kept, ensure_ascii=False, indent=1), encoding="utf-8")
    manifest = {"%s|%s" % (row["speaker"], row["text"]): {"file": row["file"], "seconds": row["seconds"]}
                for rows in kept.values() for row in rows}
    (AUDIO / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    if sum(len(rows) for rows in kept.values()) == len(todo):  # every line has its sound; the rest is from an older voice or text
        keep = {row["file"] for rows in kept.values() for row in rows}
        for old in AUDIO.glob("*.wav"):
            if old.name not in keep:
                old.unlink()
    print("made %d, have %d of %d lines%s" % (made, sum(len(r) for r in kept.values()), len(todo),
                                              "; rejected %d" % len(rejected) if rejected else ""))


if __name__ == "__main__":
    main()
