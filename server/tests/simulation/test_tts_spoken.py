"""What the voice is told to read (scripts/tts_scenes.py): the week's lines with their numbers and names written out.

Nothing here calls a voice or a model. A line the voice would misread - a bare 12시, a clock time, "Desimer" - is
fixed in the text it is sent, so the recording says what the screen shows.
"""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))

import tts_scenes as t  # noqa: E402


@pytest.mark.parametrize("written,said", [
    ("09:30과 09:40에 연락했어요", "아홉 시 삼십 분과 아홉 시 사십 분에 연락했어요"),
    ("구급대는 20:56에 왔다", "구급대는 여덟 시 오십육 분에 왔다"),
    ("12시 되믄 들어가마", "열두 시 되믄 들어가마"),
    ("11시~13시는 손님이 몰려", "열한 시에서 한 시는 손님이 몰려"),
    ("두 시간 걸려요", "두 시간 걸려요"),
    ("60분 뒤에 방송해요", "육십 분 뒤에 방송해요"),
    ("Desimer는 소규모 그룹 서비스 디자인 시뮬레이션 도구입니다", "디시머는 소규모 그룹 서비스 디자인 시뮬레이션 도구입니다"),
    ("Designer를 위한 Simulator, Desimer", "디자이너를 위한 시뮬레이터, 디시머"),
    ("AI가 알려 줬제", "에이아이가 알려 줬제"),
])
def test_what_the_voice_reads(written, said):
    assert t.spoken(written) == said


def test_no_line_of_the_week_reaches_the_voice_with_a_digit_or_a_latin_letter():
    for item in t.planned():
        assert item["spoken"] == item["spoken"].strip()
        assert not any(c.isdigit() or ("a" <= c.lower() <= "z") for c in item["spoken"]), item["spoken"]


def test_every_line_has_its_own_file_and_the_files_do_not_collide():
    files = [item["file"] for item in t.planned()]
    assert len(files) == len(set(files))


def test_every_line_of_the_week_is_planned():
    scenes = json.loads((ROOT / "fixtures" / "week" / "dialogue.json").read_text(encoding="utf-8"))["scenes"]
    planned = [item for item in t.planned() if item["speaker"] != "NARRATOR"]
    assert len(planned) == sum(len(s["lines"]) for s in scenes.values())
