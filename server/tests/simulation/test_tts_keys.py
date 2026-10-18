"""Which key may speak which voice (scripts/tts_scenes.py make, scripts/tts_voices.py).

A stored voice belongs to the project of the key that made it; another project's key answers 404 for it. So a line is
only ever sent with a key whose project holds that voice, quota is counted per key, and when a key is out of quota
the line moves to another key *of the same project* - never to a key that cannot see the voice. Nothing here
touches the network: the voice lookup and the synthesis are replaced.
"""
import json
import sys
import urllib.error
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))

import tts_scenes as t  # noqa: E402
import tts_voices as v  # noqa: E402


def write_env(tmp_path, text):
    (tmp_path / "server").mkdir()
    (tmp_path / "server" / ".env").write_text(text, encoding="utf-8")


def test_keys_are_read_by_name_and_a_commented_line_is_not_read(tmp_path, monkeypatch):
    write_env(tmp_path, "GEMINI_API_KEY=aaa\n# GEMINI_API_KEY=bbb\nGEMINI_API_KEY_OLD=ccc\nOPENAI_API_KEY=zzz\n")
    monkeypatch.setattr(v, "ROOT", tmp_path)
    assert v.keys() == {"GEMINI_API_KEY": "aaa", "GEMINI_API_KEY_OLD": "ccc"}


def test_the_main_key_is_always_first_and_the_sub_key_follows(tmp_path, monkeypatch):
    write_env(tmp_path, "GEMINI_API_KEY_SUB=sub\nGEMINI_API_KEY=main\n")
    monkeypatch.setattr(v, "ROOT", tmp_path)
    assert list(v.keys()) == ["GEMINI_API_KEY", "GEMINI_API_KEY_SUB"]


def test_no_key_stops_the_run(tmp_path, monkeypatch):
    write_env(tmp_path, "OPENAI_API_KEY=zzz\n")
    monkeypatch.setattr(v, "ROOT", tmp_path)
    with pytest.raises(SystemExit):
        v.keys()


def test_a_voice_is_usable_only_with_the_keys_whose_project_holds_it(monkeypatch):
    holds = {("k1", "voice_a"), ("k2", "voice_b"), ("k3", "voice_a")}
    monkeypatch.setattr(v, "keys", lambda: {"k1": "1", "k2": "2", "k3": "3"})
    monkeypatch.setattr(v, "visible", lambda key_value, voice_id: ("k" + key_value, voice_id) in holds)
    assert v.usable("X", "voice_a") == ["k1", "k3"]
    assert v.usable("Y", "voice_b") == ["k2"]
    assert v.usable("Z", "voice_none") == []


def run_make(monkeypatch, tmp_path, items, holders, limit, quota_by_key, capsys):
    """Run the make loop over ``items`` with fake lookups and a fake voice that answers 429 once a key's quota is gone."""
    calls = []

    def fake_speak(key_value, voice, text, style, model=None):
        calls.append(key_value)
        if calls.count(key_value) > quota_by_key[key_value]:
            raise urllib.error.HTTPError("u", 429, "quota", {}, None)
        return b""

    monkeypatch.setattr(t, "planned", lambda: iter(items))
    monkeypatch.setattr(t, "check_ready", lambda todo: [])
    monkeypatch.setattr(t, "speak", fake_speak)
    monkeypatch.setattr(t, "trim", lambda path, raw_path=None: None)
    monkeypatch.setattr(t, "check", lambda path, text: None)
    monkeypatch.setattr(t, "seconds", lambda path: 1.0)
    monkeypatch.setattr(t.time, "sleep", lambda s: None)
    monkeypatch.setattr(t, "AUDIO_ROOT", tmp_path / "audio")
    monkeypatch.setattr(v, "keys", lambda: {k: k for k in quota_by_key})
    monkeypatch.setattr(v, "usable", lambda name, voice_id: holders[name])
    monkeypatch.setattr(sys, "argv", ["tts_scenes.py", "make", "--limit", str(limit)])
    # a file that "exists" once written, as the real write_bytes would leave it
    monkeypatch.setattr(Path, "write_bytes", lambda self, data: self.parent.mkdir(parents=True, exist_ok=True) or self.write_text("x"))
    t.main()
    return calls


def item(scene, i, speaker):
    return {"scene": scene, "index": i, "speaker": speaker, "text": "t%d" % i, "spoken": "t%d" % i, "style": "s",
            "voice": "voice_" + speaker, "hash": "h%s%d" % (scene, i), "file": "%s_%02d_%s.wav" % (scene, i, speaker)}


def test_a_line_goes_to_a_key_that_holds_its_voice_and_quota_is_counted_per_key(monkeypatch, tmp_path, capsys):
    # P1's voice is in the old project (key OLD); P10's is in the new one (key NEW).
    items = [item("s", 1, "P1"), item("s", 2, "P10"), item("s", 3, "P1"), item("s", 4, "P10")]
    holders = {"P1": ["OLD"], "P10": ["NEW"]}
    calls = run_make(monkeypatch, tmp_path, items, holders, limit=90, quota_by_key={"OLD": 99, "NEW": 99}, capsys=capsys)
    assert calls == ["OLD", "NEW", "OLD", "NEW"]


def test_a_spent_key_hands_over_only_to_a_key_of_the_same_project(monkeypatch, tmp_path, capsys):
    # OLD and OLD2 are two keys of the old project; NEW is another project and must never speak P1.
    items = [item("s", i, "P1") for i in range(1, 6)]
    holders = {"P1": ["OLD", "OLD2"]}
    calls = run_make(monkeypatch, tmp_path, items, holders, limit=90,
                     quota_by_key={"OLD": 2, "OLD2": 99, "NEW": 99}, capsys=capsys)
    assert "NEW" not in calls
    # OLD answered 429 on its third try; that same line went to OLD2, and nothing was skipped
    assert calls.count("OLD") == 3 and calls.count("OLD2") == 3
    assert len(calls) == 6


def test_a_speaker_whose_keys_are_all_spent_waits_while_the_other_speakers_go_on(monkeypatch, tmp_path, capsys):
    items = [item("s", 1, "P1"), item("s", 2, "P1"), item("s", 3, "P1"), item("s", 4, "P10"), item("s", 5, "P10")]
    holders = {"P1": ["OLD"], "P10": ["NEW"]}
    calls = run_make(monkeypatch, tmp_path, items, holders, limit=90, quota_by_key={"OLD": 1, "NEW": 99}, capsys=capsys)
    out = capsys.readouterr().out
    assert calls.count("NEW") == 2          # P10's lines were made although P1's key ran out first
    assert "NEW" not in calls[:2]           # and P1's lines were never given to the other project's key
    assert "left for the next run: P1" in out


def wav_of(seconds: float) -> bytes:
    import io
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00\x00" * int(24000 * seconds))
    return buf.getvalue()


def test_cost_is_counted_from_the_audio_returned():
    # 100 s of audio = 2500 tokens at $9 per million = $0.0225, plus a little for the text; at 1400 won per dollar
    assert t.cost_won(100, 0) == pytest.approx(0.0225 * 1400)
    assert t.wav_seconds(wav_of(2.0)) == pytest.approx(2.0)
    assert t.wav_seconds(b"not a wav") == 0.0


def test_the_run_stops_before_it_would_pass_the_budget(monkeypatch, tmp_path, capsys):
    items = [item("s", i, "P1") for i in range(1, 11)]
    monkeypatch.setattr(t, "planned", lambda: iter(items))
    monkeypatch.setattr(t, "check_ready", lambda todo: [])
    monkeypatch.setattr(t, "speak", lambda *a, **k: wav_of(40.0))   # each call returns 40 s of audio: about 0.18 won
    monkeypatch.setattr(t, "trim", lambda path, raw_path=None: None)
    monkeypatch.setattr(t, "check", lambda path, text: None)
    monkeypatch.setattr(t, "seconds", lambda path: 1.0)
    monkeypatch.setattr(t.time, "sleep", lambda s: None)
    monkeypatch.setattr(t, "AUDIO_ROOT", tmp_path / "audio")
    monkeypatch.setattr(v, "keys", lambda: {"K": "k"})
    monkeypatch.setattr(v, "usable", lambda name, voice_id: ["K"])
    monkeypatch.setattr(Path, "write_bytes", lambda self, data: self.parent.mkdir(parents=True, exist_ok=True) or self.write_text("x"))
    monkeypatch.setattr(sys, "argv", ["tts_scenes.py", "make", "--budget-won", "0.5"])
    t.main()
    out = capsys.readouterr().out
    assert "past 0 won" in out or "past 0.5 won" in out or "stopped: the next line would take the run past" in out
    made = [l for l in out.splitlines() if l.startswith("made ")]
    assert made and int(made[0].split()[1].rstrip(",")) < 10      # it did not make all ten
