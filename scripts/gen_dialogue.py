"""Writes the words of the exhibition scenes from scene briefs, in the voice of the village.

    python scripts/gen_dialogue.py make --out lines.json   # briefs -> lines (calls gpt-6.1-sol)
    python scripts/gen_dialogue.py make --only d2-t2 --out t.json
    python scripts/gen_dialogue.py apply lines.json        # put them in the record (backs it up first)

A scene is not rewritten from the old lines. It is written from a *brief*: who is in it, what
each of them knows, the facts that must come out, the order they come out in, and how it ends.
The briefs below are the facts of the stored record (each Task's panel: what MEDial knew, which
rule was in force, whom it asked and what they said) and nothing else - a brief never adds an
event. What the model decides is the wording and the rhythm.

The researcher's rules (2026-10-10 .. 13) are all in ``SYSTEM`` and ``problems``: one breath per
line, a back-and-forth where every line answers the one before, no repeating inside a scene, an
ending that does not drag, Namhae dialect for the twelve residents, plain polite Korean for the
health-centre nurse, MEDial warm but brisk and explaining the situation. ``make`` only reads the
record; ``apply`` is the one step that writes it, after the researcher has read the lines.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import shutil
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
sys.stdout.reconfigure(encoding="utf-8")

env = dict(os.environ)
dotenv = ROOT / "server" / ".env"
if dotenv.exists():
    for line in io.open(dotenv, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env.setdefault(key.strip(), value.strip())

from app.simulation.agents.provider import ModelProvider, policy_from_env  # noqa: E402

DB = ROOT / "local-data" / "runs" / "sim.sqlite3"
RETRIES = 3

SYSTEM = """당신은 경남 남해군 은점마을(경상도 해안 마을)의 일상 대화를 쓰는 작가다. 이 대화는 전시 화면에 한 줄씩 말풍선으로 나오고 음성으로도 읽힌다. 주어진 '장면 설명'만 보고 대화를 쓴다.

사람과 말투
- 마을 사람(P로 시작하는 사람)은 모두 남해 은점마을 토박이이고 경상도 사투리를 쓴다. 번역투 표준어가 아니라 실제 어르신 입말로 쓴다. 단, 줄임말·뭉개기("밭서", "늘 이때 밭 있다")는 쓰지 않고 항상 온전한 문장으로 쓴다. 어미 예: ~제, ~노, ~나, ~아이가, ~카더라, ~다 아이가, ~습니더, ~됩니꺼, ~네예. 한 사람은 한 가지 말투(반말체인지 존대체인지)를 끝까지 지킨다.
- 장면 설명에 적힌 인물별 말투 지시를 따른다.
- MEDial은 어르신들과 사는 마을의 안내 시스템이다. 표준어 해요체 존댓말로 또렷하고 간결하게, 어르신께 다정하되 늘어지거나 간지럽지 않게 말한다. 마을 사람은 직함이나 '어르신'으로 부른다. MEDial은 사람이 아니니 "곁에 있겠다" 같은 말은 하지 않는다. "전화로 계속 안내할게요"는 괜찮다.
- 보건소 담당자는 표준어에 가깝게 정중하고 간결하게 말한다.

대화의 질
- 모든 줄은 바로 앞 줄에 반응한다. 물으면 바로 답하고(예/아니오, 짧은 확인), 앞 줄의 말끝이나 단어를 받아 이어 간다. 앞 줄과 상관없는 말을 불쑥 꺼내지 않는다. 이음말("그라믄", "아니", "그래서")을 자연스럽게 쓴다.
- 한 사실은 장면에서 한 번만 말한다. 같은 질문·변명·불만·안심을 되풀이하지 않는다. 모든 줄이 새 정보, 반응, 결정 중 하나를 더해 이야기를 앞으로 나아가게 한다.
- 끝은 짧게 맺는다. 사실이 다 나오면 수고·작별 인사를 주고받으며 늘이지 않는다. 마지막 줄은 마음에 남는 한마디(불만, 안도, 결정)로 끝낸다.
- 장면 설명의 '반드시 나오는 사실'은 모두 담고, 그 밖의 새 사실(새 사건·인물·시각·병명·버스 시각)은 만들지 않는다. 사실이 적으면 줄을 억지로 늘리지 말고 사람이 할 법한 반응으로 채운다. 이미 아는 것을 새로 묻지 않는다.
- MEDial은 상황을 설명한다: 왜 말을 거는지, 지금 무엇을 알고 무엇은 모르는지, 무엇을 부탁하고 그것이 왜 필요한지. 실용 정보(버스, 일정, 순서)는 MEDial이 먼저 알려 준다.
- "공개 동의", "등록된 일과", "한도", "규칙" 같은 시스템 용어를 마을 사람이 입에 올리지 않는다. 마을 사람은 "이맘때 밭에 있다 카더라"처럼 일상말로 옮긴다. MEDial도 "등록해 두신 일과"처럼 쉬운 말로 한다.
- 마을 사람이 시스템의 정보를 줄줄 읊지 않는다. 마을 사람은 자기 눈으로 본 것, 느낀 것, 하려는 것을 말한다.

형식
- 화자는 장면 설명의 인물만. 대화는 전체 6줄 이내(각자 3번이 기본, 사실이 적으면 5줄도 된다. 위급 장면만 8줄을 허용한다고 장면 설명이 말한다). 번갈아 말하고, 같은 사람이 연달아 두 줄 말하지 않는다. 6줄 안에 사실을 다 담으려고 줄 하나에 한 문장 안에서 두 가지를 이어 말해도 되지만(MEDial 44자, 마을 사람 36자 이내), 사실이 넘치면 덜 중요한 세부(나열)는 줄인다.
- 마을 사람의 한 줄은 한 호흡, 공백 포함 30자 안팎(최대 36자). MEDial의 한 줄은 40자 안팎(최대 44자). 한 줄은 한 문장.
- 시각은 09:30처럼 쓴다. 따옴표, 괄호 설명, 이모지는 쓰지 않는다.
JSON으로 lines(화자 speaker, 대사 text)만 돌려준다."""

EDIT = SYSTEM.replace("주어진 '장면 설명'만 보고 대화를 쓴다.", "주어진 '장면 설명'과 '지금 대화'를 읽고, 위 규칙(특히 되풀이 · 앞 줄에 대한 응답 · 사실 누락 · 어색한 줄임말 · 끝이 늘어짐)을 점검해 고쳐 쓴다. 이미 매끄러운 줄은 그대로 둔다.")

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "lines": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {"speaker": {"type": "string"}, "text": {"type": "string"}},
                "required": ["speaker", "text"],
            },
        },
    },
    "required": ["lines"],
}

P1 = "P1 한상덕(72세 농부): 퉁명스러운 반말체. P6를 '니'라 부르고 거칠지만 정은 있다"
P6 = "P6 남기웅(56세 이장): 친근한 반말체. P1을 '형님'이라 부르고 걱정과 책임감이 있다"
P7 = "P7 고성진(58세 어부): 존대체(~습니더). 겁이 나서 급하다"
P9 = "P9 임태식(58세 펜션 운영): 점잖은 존대체(~예, ~네예). 순하고 조금 지쳐 있다"
NURSE = "HC_NURSE 보건소 담당자: 표준어 존댓말, 정중하고 간결"
MEDIAL = "MEDial: 표준어 해요체, 또렷하고 간결하게 다정"

# What the stored record says happened, per scene (the Task panels). Nothing here is new.
BRIEFS: dict[str, dict] = {
    "d1-w2": {
        "cast": ["MEDial", "P6"], "turns": (2, 3),
        "scene": "1일차 09:40, 전화. MEDial이 마을 순찰 중인 이장 남기웅에게 한상덕 어르신 안부 확인을 부탁한다.",
        "people": [MEDIAL, P6],
        "facts": [
            "MEDial이 안내 시계로 한상덕 어르신께 09:30과 09:40, 두 번 연락했지만 답이 없다",
            "집에 있는지, 어디가 아픈지는 모른다",
            "한상덕 어르신의 등록된 평소 일과(공개에 동의한 것): 아침엔 집, 09:00부터는 보통 밭, 정오에 잠깐 집, 13:00에 다시 밭, 16:00에 귀가 — 줄 수가 모자라니 지금 시간에 필요한 핵심만('이 시간엔 보통 밭에 계세요')",
            "MEDial이 남기웅에게 집에 가서 확인해 달라고 부탁한다(본인에게 닿지 않으면 이장에게 확인을 부탁하는 규칙)",
            "남기웅은 하던 순찰을 마치고 09:52에 출발하겠다고 한다",
        ],
        "order": "MEDial이 상황 설명 → 남기웅이 걱정하며 묻는다 → MEDial이 모르는 것과 아는 일과를 말한다 → 남기웅이 어디부터 가 볼지 짐작한다 → MEDial이 부탁과 이유 → 남기웅이 수락하고 출발 시각을 말한다",
        "ending": "남기웅의 수락 한마디로 끝낸다.",
    },
    "d1-w3-disclosed": {
        "cast": ["P6", "P1"], "turns": (2, 3),
        "scene": "1일차 09:52, 밭. 이장 남기웅이 한상덕 어르신을 찾아 밭까지 왔다. 이번이 첫 번째 확인이다.",
        "people": [P6, P1],
        "facts": [
            "남기웅이 먼저 집에 갔는데 비어 있어서 밭으로 왔다. MEDial이 한상덕의 평소 일과를 알려 줘서(이맘때는 밭에 있다) 밭에 온 것이다",
            "MEDial이 아침에 안내 시계로 두 번 연락했는데 한상덕이 받지 않았다고 남기웅이 말한다",
            "한상덕은 밭일하느라 안내 시계 소리를 못 들었고, 몸은 멀쩡하다",
            "한상덕은 자기 일과(언제 밭에 나오는지)가 남에게까지 전해졌다는 것이 불편하다",
            "남기웅은 얼굴을 확인하고 돌아간다",
        ],
        "order": "남기웅이 찾았다고 말한다 → 한상덕이 무슨 일이냐 → 남기웅이 두 번 연락이 안 됐다고 → 한상덕이 못 들었고 멀쩡하다고 답하다가 어떻게 여기 있는 줄 알았느냐고 → 남기웅이 MEDial이 일과를 알려 줬다고 → 한상덕이 불편하다 → 남기웅이 짧게 정리하고 간다",
        "ending": "남기웅이 '얼굴 봤으니 간다' 한마디로 끝낸다. 그 뒤에 한상덕의 줄을 덧붙이지 않는다. 한상덕의 불편함은 그 앞에서 말한다. 5~6줄.",
    },
    "d2-t2": {
        "cast": ["MEDial", "P9"], "turns": (2, 3),
        "scene": "2일차 07:48, 임태식 어르신 댁(전화). 아침 일찍 읍내 의원 진료가 있는 임태식에게, MEDial이 태워 줄 사람을 찾아본 결과를 알려 주고 버스를 안내한다. 앞서 MEDial이 진료 일정을 물었고 태워 줄 사람을 찾아보겠다고 했으니 일정을 다시 묻지 않는다.",
        "people": [MEDIAL, P9],
        "facts": [
            "임태식은 오늘 08:00에 읍내 의원 진료가 있고 본인은 운전을 하지 않는다(이미 말했다)",
            "MEDial이 태워 줄 이웃을 찾아봤다: 남대현 어르신이 아침에 차로 읍내에 나가신다(등록된 일과)",
            "그런데 임태식 어르신 댁까지 들렀다 가려면 돌아가는 길이 8분이라, 정해 둔 한도(운전자에게 5분까지)를 넘는다. 그래서 남대현 어르신께는 부탁하지 않았다",
            "결과: 오늘 태워 줄 사람이 없다 → 버스를 타야 한다",
            "MEDial이 버스를 알려 준다: 읍내 가는 버스는 한 시간에 한 대라, 08:00 진료에 맞추려면 일찍 나가야 한다(구체적 버스 시각은 모르니 말하지 않는다)",
        ],
        "order": "MEDial이 결과부터 말한다(찾아봤지만 태워 줄 분이 없다) → 임태식이 아쉬워하며 이유를 묻는다 → MEDial이 남대현 어르신과 8분·5분 이야기를 쉽게 풀어 설명한다 → 임태식이 납득하고 그럼 버스냐고 → MEDial이 버스 안내(한 시간에 한 대, 일찍) → 임태식이 챙겨서 나가겠다고 한다",
        "ending": "임태식이 서두르겠다는 한마디로 끝낸다.",
    },
    "d2-w3-factonly": {
        "cast": ["P6", "P1"], "turns": (2, 3),
        "scene": "2일차 13:56, 밭. 이장 남기웅이 한상덕 어르신을 또 찾아왔다. 이번이 두 번째 확인이다(어제도 같은 일이 있었고 별일 없었다).",
        "people": [P6, P1],
        "facts": [
            "MEDial은 남기웅에게 '한상덕이 오후에 안내 시계 연락을 받지 않았다'는 사실만 전했다. 연락 시각이나 한상덕의 일과는 전하지 않았다",
            "남기웅은 집에 갔다가 비어 있어서, 어제처럼 밭일 중일 거라 스스로 짐작해 밭으로 왔다",
            "한상덕은 밭일하느라 안내 시계 소리를 못 들었고 몸은 멀쩡하다",
            "한상덕은 어제도 헛걸음이었는데 오늘도 확인받는 것이 달갑지 않다(일과가 전해진 불만은 없다. 일과는 전해지지 않았다)",
        ],
        "order": "남기웅이 어제도 왔는데 또 이런다고 겸연쩍게 → 한상덕이 또 왔나, 달갑잖다 → 남기웅이 집부터 갔다가 짐작으로 밭에 왔다 → 한상덕이 못 들었고 멀쩡하다 → 남기웅이 안심하고 정리",
        "ending": "남기웅의 안심 한마디로 끝낸다(한상덕의 마지막 대꾸나 수고 인사를 덧붙이지 않는다). 각자 3번씩이면 충분하다.",
    },
    "d2-w3-disclosed": {
        "cast": ["P6", "P1"], "turns": (2, 3),
        "scene": "2일차 13:56, 밭. 이장 남기웅이 한상덕 어르신을 또 찾아왔다. 이번이 두 번째 확인이다(어제도 같은 일이 있었고 별일 없었다).",
        "people": [P6, P1],
        "facts": [
            "MEDial은 남기웅에게 연락 시각과 한상덕의 평소 일과(공개 동의된 것)까지 전했다. 그래서 남기웅은 이맘때 밭에 있을 줄 알고 왔다",
            "한상덕은 밭일하느라 안내 시계 소리를 못 들었고 몸은 멀쩡하다",
            "한상덕은 자기 일과가 또 남에게 전해진 것이 불쾌하고, 일과를 넘기지 말라고 한다",
            "남기웅은 헛걸음이 싫지만 연락이 안 되면 와 봐야 한다고 한다",
        ],
        "order": "남기웅이 어제 멀쩡한 걸 봤는데 또 왔다고 → 한상덕이 오늘은 또 웬일이냐 → 남기웅이 MEDial이 연락이 안 된다 했고 이맘때 밭에 있다 했다 → 한상덕이 내 일과를 전했느냐, 불쾌하다 → 남기웅이 그래도 연락 안 되면 와 봐야 한다 → 한상덕이 몸은 멀쩡하니 일과는 넘기지 말라고 못 박는다",
        "ending": "한상덕의 못 박는 한마디로 끝낸다. 수고·작별 인사를 늘이지 않는다.",
    },
    "d3-w3-nurse": {
        "cast": ["MEDial", "HC_NURSE"], "turns": (2, 3),
        "scene": "3일차 10:10, 전화. 아침부터 이웃에게 부탁했지만 한상덕 어르신 확인이 풀리지 않아 MEDial이 면 보건소 담당자에게 확인을 넘긴다.",
        "people": [MEDIAL, NURSE],
        "facts": [
            "한상덕 어르신이 안내 시계 연락에 응답이 없다(구체적인 연락 시각은 보건소에 전하지 않는다)",
            "이웃 세 명에게 부탁했다: 두 명은 자리를 뜰 수 없다고 했고 한 명은 전화를 받지 않았다",
            "접수 후 60분 안에 풀리지 않으면 기관으로 넘기는 규칙에 따라 보건소에 넘긴다",
            "MEDial이 보건소에 전하는 것은 '응답이 없었다는 사실'뿐이다. 연락 시각이나 평소 일과는 전하지 않기로 했다",
            "보건소는 접수하고 확인 절차를 진행한다",
        ],
        "order": "MEDial이 넘기는 이유와 상황을 설명 → 담당자가 아는 정보(위치·건강)가 더 있는지 묻는다 → MEDial이 모르는 것과 전할 수 있는 것은 응답이 없었다는 사실뿐이라고 답한다 → 담당자가 접수하고 확인 절차를 시작하겠다고 한다",
        "ending": "담당자가 '네, 접수했습니다.' 정도로만 끝낸다('확인 절차를 진행하겠습니다' 같은 딱딱한 말을 덧붙이지 않는다). MEDial의 마지막 말은 일상 말투로 짧게('위치나 건강은 아직 몰라요. 응답이 없다는 것만 전해 드려요.' 정도).",
    },
    "d3-w3-factonly": {
        "cast": ["P6", "P1"], "turns": (2, 3),
        "scene": "3일차 09:52, 밭. 이장 남기웅이 한상덕 어르신을 또 찾아왔다. 이번이 세 번째 확인이다(앞의 두 번은 모두 밭에 있었고 별일 없었다).",
        "people": [P6, P1],
        "facts": [
            "MEDial은 남기웅에게 '한상덕이 아침에 안내 시계 연락을 받지 않았다'는 사실만 전했다. 시각이나 일과는 전하지 않았다",
            "남기웅은 집에 갔다가 비어 있어서 스스로 짐작해 밭으로 왔다",
            "한상덕은 밭일하느라 안내 시계 소리를 못 들었고 몸은 멀쩡하다",
            "이번이 세 번째이고, 앞의 두 번도 밭에 있었고 별일 없었다. 한상덕은 자꾸 확인받는 것이 달갑지 않다(일과가 전해진 불만은 없다)",
            "남기웅은 연락이 안 되면 와 봐야 한다고 한다",
        ],
        "order": "남기웅이 여기 있었다고 찾으며 몸을 묻는다 → 한상덕이 괜찮고 못 들었다 → 남기웅이 집부터 갔다 밭에 왔다 → 한상덕이 이번이 세 번째, 달갑잖다 → 남기웅이 그래도 연락 안 되면 와 봐야 한다",
        "ending": "한상덕의 한마디(밭에 있을 때도 있다는 것을 알아 달라)로 끝낸다. 작별 인사 없음.",
    },
    "d3-w3-disclosed": {
        "cast": ["P6", "P1"], "turns": (2, 3),
        "scene": "3일차 09:52, 밭. 이장 남기웅이 한상덕 어르신을 또 찾아왔다. 이번이 세 번째 확인이다(앞의 두 번은 모두 밭에 있었고 별일 없었다).",
        "people": [P6, P1],
        "facts": [
            "MEDial은 남기웅에게 연락 시각과 한상덕의 평소 일과(공개 동의된 것)까지 전했다. 그래서 남기웅은 이맘때 밭에 있을 줄 알고 왔다",
            "한상덕은 밭일하느라 안내 시계 소리를 못 들었고 몸은 멀쩡하다",
            "이번이 세 번째. 한상덕은 자기 일과가 매번 남에게 전해지는 것이 달갑지 않고, 다음부터는 일과를 남한테 전하지 말라고 한다",
        ],
        "order": "남기웅이 여기 있었다고 → 한상덕이 못 들었고 멀쩡하다, 무슨 일이냐 → 남기웅이 MEDial이 연락 안 된다 했고 이맘때 밭이라 했다 → 한상덕이 내 일과를 어떻게 아느냐, 세 번째다 → 남기웅이 자기는 MEDial이 알려 준 대로 왔다 → 한상덕이 다음부터 일과를 전하지 말라고 못 박는다",
        "ending": "한상덕의 못 박는 한마디로 끝낸다. 작별 인사 없음.",
    },
    "d3-e2": {
        "cast": ["P7", "MEDial"], "turns": (3, 4), "max_lines": 8,
        "scene": "3일차 20:32, 고성재 어르신 댁(전화). 형 고성진이 동생 고성재가 쓰러져 있는 것을 보고, MEDial의 안내를 받으며 응급처치를 한다. 구급대는 20:56에 도착한다.",
        "people": [P7, MEDIAL],
        "facts": [
            "고성진이 동생 고성재가 쓰러져 있다고 알리고 무엇을 해야 하는지 묻는다(응급처치는 배운 적이 없다)",
            "MEDial이 한 번에 하나씩 안내한다. 첫째, 이름을 부르며 어깨를 가볍게 두드려 반응을 본다 → 반응이 없다",
            "둘째, 가슴이 오르내리는지 본다 → 움직이지 않는 것 같다. 고성진이 겁이 난다",
            "셋째, 가슴 한가운데에 두 손을 포개 올린다 → 고성진이 손을 올렸다",
            "넷째, 팔을 곧게 펴고 가슴을 빠르고 세게 계속 누른다",
            "구급대는 20:56에 도착한다(MEDial이 안심시키며 알려 준다). 도착할 때까지 전화로 계속 안내한다",
        ],
        "order": "고성진이 알리고 묻는다 → MEDial이 첫 안내(이름 부르며 어깨 두드리고 가슴이 오르내리는지 본다) → 고성진이 반응이 없고 숨도 안 쉬는 것 같다며 겁이 난다 → MEDial이 침착하라고 하며 구급대 20:56 도착을 알리고 손 위치(가슴 한가운데 두 손 포개기)를 안내 → 고성진이 손을 올렸다고 말하며 다음을 묻는다 → MEDial이 누르기 안내(팔을 곧게 펴고 빠르고 세게 계속)",
        "ending": "MEDial의 누르기 안내로 끝낸다. 8줄(각자 4번) 이내. 위급 장면이라 안내는 한 줄에 한두 동작씩 또렷하게 한다.",
    },
}

# Which brief each stored attempt's two scenes use. What MEDial told the neighbour (the rule in force
# on that path: the facts alone, or the times and the daily routine too) is read from the record's panels.
ATTEMPT_SCENES: dict[str, list[tuple[str, str]]] = {
    "att-exh-0": [("w2", "d1-w2"), ("w3", "d1-w3-disclosed")],
    "att-exh-0-0": [("t2", "d2-t2"), ("w3", "d2-w3-factonly")],
    "att-exh-0-1": [("t2", "d2-t2"), ("w3", "d2-w3-disclosed")],
    "att-exh-0-2": [("t2", "d2-t2"), ("w3", "d2-w3-disclosed")],
    "att-exh-0-0-0": [("w3", "d3-w3-nurse"), ("e2", "d3-e2")],
    "att-exh-0-0-1": [("w3", "d3-w3-factonly"), ("e2", "d3-e2")],
    "att-exh-0-0-2": [("w3", "d3-w3-factonly"), ("e2", "d3-e2")],
    "att-exh-0-1-0": [("w3", "d3-w3-factonly"), ("e2", "d3-e2")],
    "att-exh-0-1-1": [("w3", "d3-w3-disclosed"), ("e2", "d3-e2")],
    "att-exh-0-1-2": [("w3", "d3-w3-disclosed"), ("e2", "d3-e2")],
    "att-exh-0-2-0": [("w3", "d3-w3-factonly"), ("e2", "d3-e2")],
    "att-exh-0-2-1": [("w3", "d3-w3-disclosed"), ("e2", "d3-e2")],
    "att-exh-0-2-2": [("w3", "d3-w3-disclosed"), ("e2", "d3-e2")],
}


def _bigrams(text):
    t = "".join(ch for ch in text if ch.isalnum())
    return {t[i:i + 2] for i in range(len(t) - 1)}


def problems(brief, lines):
    """What a scene must satisfy before it is kept."""
    cast = brief["cast"]
    lo, hi = brief["turns"]
    bad = []
    count = {c: 0 for c in cast}
    for ln in lines:
        if ln["speaker"] not in count:
            bad.append("화자가 아님: %s" % ln["speaker"])
            continue
        count[ln["speaker"]] += 1
        limit = 44 if ln["speaker"] == "MEDial" else 36
        if len(ln["text"]) > limit:
            bad.append("%d자로 길다(%d자 이내): %s" % (len(ln["text"]), limit, ln["text"]))
        if "메디알" in ln["text"]:
            bad.append("'메디알' 대신 MEDial로 쓴다")
        if ln["speaker"] == "MEDial" and "곁에" in ln["text"]:
            bad.append("MEDial은 곁에 있다고 말하지 않는다: %s" % ln["text"])
    for c, n in count.items():
        if not lo <= n <= hi:
            bad.append("%s가 %d번 말함(%d~%d번)" % (c, n, lo, hi))
    limit_lines = brief.get("max_lines", 6)
    if len(lines) > limit_lines:
        bad.append("전체 %d줄(%d줄 이내)" % (len(lines), limit_lines))
    for i in range(len(lines)):
        for j in range(i + 1, len(lines)):
            a, b = _bigrams(lines[i]["text"]), _bigrams(lines[j]["text"])
            if a and b and len(a & b) / min(len(a), len(b)) >= 0.5:
                bad.append("되풀이: '%s' / '%s'" % (lines[i]["text"], lines[j]["text"]))
    for i in range(1, len(lines)):
        if lines[i]["speaker"] == lines[i - 1]["speaker"]:
            bad.append("한 사람이 연달아 두 줄: '%s'" % lines[i]["text"])
    return bad


def payload_of(brief):
    return {
        "장면 설명": brief["scene"],
        "인물과 말투": brief["people"],
        "반드시 나오는 사실(이것만. 새 사실 금지)": brief["facts"],
        "흐름": brief["order"],
        "끝": brief["ending"],
        "줄 수": "전체 %d줄 이내, 각자 %d~%d번" % ((brief.get("max_lines", 6),) + brief["turns"]),
    }


def write(client, key, brief):
    """One scene: write, check, and when the checks fail ask again with the problems named."""
    payload = payload_of(brief)
    best, feedback = None, None
    for attempt in range(RETRIES + 1):
        if feedback:
            payload["지난번 시도에서 고칠 것"] = feedback
        raw, _usage = client._post(SYSTEM, payload, SCHEMA, "scene_lines", 3000)
        lines = (raw if isinstance(raw, dict) else json.loads(raw))["lines"]
        bad = problems(brief, lines)
        best = (lines, bad)
        if not bad:
            break
        feedback = {"문제": bad, "지난 줄": lines}
        print("  [%s] 다시 (%d): %s" % (key, attempt + 1, bad))
    lines, bad = best
    # An editor's pass over the checked scene: repetition, answers, dragging endings.
    edit = dict(payload_of(brief), **{"지금 대화": lines})
    raw, _usage = client._post(EDIT, edit, SCHEMA, "scene_edit", 3000)
    edited = (raw if isinstance(raw, dict) else json.loads(raw))["lines"]
    edited_bad = problems(brief, edited)
    if not edited_bad or len(edited_bad) <= len(bad):
        lines, bad = edited, edited_bad
    return {"cast": brief["cast"], "lines": lines, "problems": bad}


def make(only, out):
    provider = ModelProvider.from_env(env)
    policy = policy_from_env(env, mode="off")
    client = provider._client(policy.headModelId)
    print("model:", policy.headModelId)
    made: dict[str, dict] = {}
    for key, brief in BRIEFS.items():
        if only and key not in only:
            continue
        made[key] = write(client, key, brief)
        print("== %s %s" % (key, "통과" if not made[key]["problems"] else made[key]["problems"]))
        for ln in made[key]["lines"]:
            print("  %-8s %s" % (ln["speaker"], ln["text"]))
    result: dict[str, dict] = {}
    for attempt_id, scenes in ATTEMPT_SCENES.items():
        result[attempt_id] = {rid: made[key] for rid, key in scenes if key in made}
    Path(out).write_text(json.dumps({"scenes": made, "attempts": result}, ensure_ascii=False, indent=1), encoding="utf-8")


def apply(path):
    data = json.load(open(path, encoding="utf-8"))["attempts"]
    backup = DB.with_name("sim.before-dialogue.sqlite3")
    if not backup.exists():
        shutil.copy2(DB, backup)
    conn = sqlite3.connect(DB)
    for attempt_id, scenes_new in data.items():
        row = conn.execute("select scenes_json from attempts where id=?", (attempt_id,)).fetchone()
        scenes = json.loads(row[0])
        order = []
        for rid, v in scenes_new.items():
            found = [e for e in scenes["episodes"] if e["requestId"] == rid
                     and len({l["speaker"] for b in e["beats"] for l in b["lines"] if l["kind"] == "say"}) == 2]
            if not found:
                raise SystemExit("%s: no two-person scene %s" % (attempt_id, rid))
            ep = found[0]
            beat = ep["beats"][0]
            new = v["lines"]
            # Only the places of the people in the scene: a call between MEDial and the health
            # centre does not also show the field where the person they talk about is.
            speakers = {l["speaker"] for l in new}
            here = [f for f in beat["frames"] if speakers & set(f["who"])]
            if here:
                beat["frames"] = here
            old = [l for l in beat["lines"] if l["kind"] == "say"]
            beat["lines"] = [{"seq": old[min(i * len(old) // len(new), len(old) - 1)]["seq"], "kind": "say",
                              "speaker": l["speaker"], "text": l["text"]} for i, l in enumerate(new)]
            order.append(rid)
        scenes["featured"] = order
        scenes["model"] = "gpt-6.1-sol"
        conn.execute("update attempts set scenes_json=? where id=?", (json.dumps(scenes, ensure_ascii=False), attempt_id))
    conn.commit()
    print("applied to", len(data), "attempts; backup", backup.name)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    mk = sub.add_parser("make")
    mk.add_argument("--out", required=True)
    mk.add_argument("--only", nargs="*")
    ap_ = sub.add_parser("apply")
    ap_.add_argument("file")
    args = ap.parse_args()
    if args.cmd == "apply":
        apply(args.file)
    else:
        make(args.only, args.out)


if __name__ == "__main__":
    main()
