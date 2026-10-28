"""Where each later sentence of the narrator's recording begins, read from the breaths in the audio."""
from __future__ import annotations

import json
import math
import struct
import wave

from app.simulation import assets

RATE = 24000


def _speech(seconds: float) -> list[int]:
    return [int(9000 * math.sin(2 * math.pi * 220 * i / RATE)) for i in range(int(RATE * seconds))]


def _silence(seconds: float) -> list[int]:
    return [0] * int(RATE * seconds)


def _record(folder, name, parts, text):
    samples = [s for part in parts for s in part]
    with wave.open(str(folder / name), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(struct.pack(f"<{len(samples)}h", *samples))
    manifest = folder / "manifest.json"
    rows = json.loads(manifest.read_text(encoding="utf-8")) if manifest.exists() else {}
    rows[f"NARRATOR|{text}"] = {"file": name, "seconds": len(samples) / RATE}
    manifest.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")


def test_the_second_sentence_begins_where_the_voice_comes_back_after_the_breath(monkeypatch, tmp_path):
    monkeypatch.setenv("MEDIAL_VOICE_DIR", str(tmp_path))
    _record(tmp_path, "a.wav", [_speech(2.0), _silence(0.7), _speech(2.0)], "가나다라마. 바사아자차.")
    row = assets.voice_index()["NARRATOR|가나다라마. 바사아자차."]
    assert len(row["marks"]) == 1
    assert 2.55 <= row["marks"][0] <= 2.7  # a hair before the voice returns at 2.7 s


def test_a_comma_is_not_a_sentence_and_a_single_sentence_has_no_marks(monkeypatch, tmp_path):
    monkeypatch.setenv("MEDIAL_VOICE_DIR", str(tmp_path))
    _record(tmp_path, "b.wav", [_speech(2.0), _silence(0.3), _speech(2.0), _silence(0.7), _speech(2.0)], "가나다라마, 바사아자차. 하하하하하.")
    _record(tmp_path, "c.wav", [_speech(2.0), _silence(0.3), _speech(2.0)], "가나다라마, 바사아자차.")
    rows = assets.voice_index()
    # the 0.7 s breath (4.3-5.0 s) is the sentence's, the 0.3 s one (2.0-2.3 s) is the comma's
    assert [round(m, 1) for m in rows["NARRATOR|가나다라마, 바사아자차. 하하하하하."]["marks"]] == [4.9]
    assert "marks" not in rows["NARRATOR|가나다라마, 바사아자차."]


def test_when_the_breaths_cannot_be_told_from_the_text_there_are_no_marks(monkeypatch, tmp_path):
    monkeypatch.setenv("MEDIAL_VOICE_DIR", str(tmp_path))
    _record(tmp_path, "d.wav", [_speech(4.0)], "가나다라마. 바사아자차.")  # no breath at all
    assert "marks" not in assets.voice_index()["NARRATOR|가나다라마. 바사아자차."]


def test_only_the_narrator_is_marked(monkeypatch, tmp_path):
    monkeypatch.setenv("MEDIAL_VOICE_DIR", str(tmp_path))
    _record(tmp_path, "e.wav", [_speech(2.0), _silence(0.7), _speech(2.0)], "가나다라마. 바사아자차.")
    manifest = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
    manifest["P1|가나다라마. 바사아자차."] = manifest.pop("NARRATOR|가나다라마. 바사아자차.")
    (tmp_path / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    assert "marks" not in assets.voice_index()["P1|가나다라마. 바사아자차."]
