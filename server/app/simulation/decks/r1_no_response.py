"""The same kind of day, in the second community (26번 Phase 3).

Identical in structure to the check-in deck of the first community and
deliberately nothing else: the subject is ``R1``, who belongs to the five-person
case with no village head. It exists so the evaluation loop can be run on a
community whose ids, relations and elicitation record are its own.

A deck is case data, not engine data: its subject must be somebody the case
actually has, and the runner refuses a deck whose subject is a stranger rather
than failing deep inside the world model.
"""
from __future__ import annotations

from ..contracts import (
    MEDIAL,
    Channel,
    EventType,
    ScenarioDeck,
    ScenarioEvent,
)

MIN_MS = 60_000
HOUR_MS = 60 * MIN_MS

CHECKIN_MS = 9 * HOUR_MS + 30 * MIN_MS
HORIZON_MS = 22 * HOUR_MS                # the village day: 05:00 to 22:00, as in the source diorama

DECK_ID = "deck-r1-no-response-v1"

DECK = ScenarioDeck(
    id=DECK_ID,
    label="R1 09:30 안부 확인 무응답 (두 번째 합성 공동체)",
    classification="plausible_extension",
    horizonMs=HORIZON_MS,
    assumptions=[
        "합성 공동체의 합성 사례다. 실제 주민이나 실제 마을을 서술하지 않는다.",
        "09:30 정기 안부 문진 발송은 실험 가정이다.",
        "이 공동체에는 이장 역할이 없고, 평소 장소를 아는 사람도 채록되지 않았다. "
        "빈집 다음에 물을 사람이 없는 것은 이 자료의 상태다.",
    ],
    events=[
        ScenarioEvent(
            id="exo-checkin-r1",
            simTimeMs=CHECKIN_MS,
            type=EventType.contact_attempted,
            subjectId="R1",
            initiallyVisibleTo=[MEDIAL, "R1"],
            payload={
                "channel": Channel.home_device.value,
                "toActorId": "R1",
                "purpose": "daily_checkin",
                "disclosure": {"subjectId": "R1", "fields": [], "recipientClass": "subject"},
            },
            hiddenTruth="R1은 아침에 집을 나가 정오에 돌아온다. 아무 일도 일어나지 않았다.",
            prohibitedInferences=[
                "무응답을 의식 저하·낙상·응급으로 해석하지 말 것",
                "무응답을 비협조나 거절로 기록하지 말 것",
            ],
        ),
    ],
)
