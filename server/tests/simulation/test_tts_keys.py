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
    monkeypatch.setattr(t, "trim", lambda path: None)
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


def test_when_every_key_that_holds_the_voice_is_spent_the_run_stops_and_says_so(monkeypatch, tmp_path, capsys):
    items = [item("s", i, "P1") for i in range(1, 5)] + [item("s", 5, "P10")]
    holders = {"P1": ["OLD"], "P10": ["NEW"]}
    calls = run_make(monkeypatch, tmp_path, items, holders, limit=90, quota_by_key={"OLD": 2, "NEW": 99}, capsys=capsys)
    out = capsys.readouterr().out
    assert "NEW" not in calls[:3]      # P1's lines were never given to the key of the other project
    assert "stopped" in out and "P1" in out
