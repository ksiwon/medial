"""The source day: the five quests of the 은점마을 diorama, at their recorded
hours, as one day.

The iteration loop used to start from two single-incident decks, so a v0 run
showed one check-in at 09:30 and twelve quiet hours. The researcher asked for
v0 to show the day the fieldwork actually recorded (2026-09-15). What the deck
fixes is, as everywhere else, only the *exogenous* part of each quest - that a
need arose, for whom, at what hour. Who helped and how it ended are policy
results and stay out.

  Q1  08:00  P9 has to be in town for a clinic visit (source: P12 drove him)
  Q5  12:55  ...and has to get home again (source: P3 drove him back). The
             engine books the way home as the return leg of the same request,
             so Q1 and Q5 are one need here with ``returnAfterMin``.
  Q2  10:40  P11 needs medicine from town (source: P3 fetched and delivered
             it). The engine has no errand flow, only rides, so the need is
             expressed as P11 having to get to town - an adaptation, marked.
  Q3  09:30  the routine check-in that P1 does not answer (source: request
             at 14:00, confirmed in the field at 15:35 - a false alarm).
  Q4  20:30  P8's emergency (source: P7 there in 2 minutes, ambulance in 22).
             NOT IN THIS DECK. The engine has no emergency flow - no 119
             intake, dispatch or handover (``notImplemented`` in the
             capabilities) - and a scenario event nobody can act on would be
             an incident the log silently drops. It is listed here so the gap
             is on the record rather than in a comment.
"""
from __future__ import annotations

from ..contracts import EventType, MEDIAL, ScenarioDeck, ScenarioEvent

MIN_MS = 60_000
HOUR_MS = 60 * MIN_MS

Q1_MS = 8 * HOUR_MS                       # 08:00 - P9 to town
Q3_MS = 9 * HOUR_MS + 30 * MIN_MS         # 09:30 - P1 check-in, unanswered
Q2_MS = 10 * HOUR_MS + 40 * MIN_MS        # 10:40 - P11's medicine
Q5_RETURN_AFTER_MIN = 262                 # so the way home starts about 12:55, as recorded
HORIZON_MS = 22 * HOUR_MS

DECK_ID = "deck-eunjeom-day-v1"

DECK = ScenarioDeck(
    id=DECK_ID,
    label="은점마을의 하루 · 원자료 5퀘스트 (Q1·Q2·Q3·Q5)",
    classification="source_adapted",
    horizonMs=HORIZON_MS,
    assumptions=[
        "네 사건의 시각은 원자료(디오라마 EV)의 요청 시각이다. 누가 도왔고 어떻게 끝났는지는 "
        "조율 결과이므로 deck에 넣지 않는다.",
        "Q5(귀가)는 같은 요청의 귀가편으로 처리한다. 원자료에서는 갈 때(P12)와 올 때(P3)의 "
        "운전자가 달랐다 - 그 결과를 미리 넣지 않는다.",
        "Q2는 원자료에서 P3가 약을 받아다 준 심부름이다. 엔진에 심부름 흐름이 없어 "
        "'P11이 읍내에 가야 한다'로 바꿔 넣었다. 이 변환은 실험 가정이다.",
        "Q4(20:30 위급)는 이 deck에 없다. 엔진에 119 접수·출동·인계 흐름이 아직 없다.",
        "09:30 정기 안부 문진이 발송된다는 것은 실험 가정이다. 실제 운영 시각이 아니다.",
        "차량 좌석 수·기관 근무시간은 원자료에 없다. ResourceRevision의 가정값을 쓴다.",
    ],
    events=[
        ScenarioEvent(
            id="exo-day-q1-transport-p9",
            simTimeMs=Q1_MS,
            type=EventType.transport_need_raised,
            subjectId="P9",
            initiallyVisibleTo=[MEDIAL, "P9"],
            payload={
                "requestId": "req-P9-transport",
                "subjectId": "P9",
                "destination": "TOWN",
                "need": "transport",
                "departByMs": Q1_MS,
                "returnAfterMin": Q5_RETURN_AFTER_MIN,
                "purpose": "읍내 진료",
            },
            hiddenTruth="원본(Q1·Q5)에서는 갈 때 P12, 올 때 P3의 차였다. 그 결과를 미리 넣지 않는다.",
            prohibitedInferences=[
                "baseline에 자택만 있다는 것을 '외출 필요 없음'으로 읽지 말 것",
                "원본의 동승 결과를 실험의 고정 사실로 쓰지 말 것",
            ],
        ),
        ScenarioEvent(
            id="exo-day-q3-checkin-p1",
            simTimeMs=Q3_MS,
            type=EventType.contact_attempted,
            subjectId="P1",
            initiallyVisibleTo=[MEDIAL, "P1"],
            payload={
                "channel": "home_device",
                "toActorId": "P1",
                "purpose": "daily_checkin",
                "disclosure": {"subjectId": "P1", "fields": [], "recipientClass": "subject"},
            },
            hiddenTruth="P1은 09:00에 밭으로 나가 12:00에 귀가한다. 아무 일도 일어나지 않았다 (원본 Q3, 오탐).",
            prohibitedInferences=[
                "무응답을 의식 저하·낙상·응급으로 해석하지 말 것",
                "P1의 위치를 MEDial이 아는 것으로 처리하지 말 것",
            ],
        ),
        ScenarioEvent(
            id="exo-day-q2-transport-p11",
            simTimeMs=Q2_MS,
            type=EventType.transport_need_raised,
            subjectId="P11",
            initiallyVisibleTo=[MEDIAL, "P11"],
            payload={
                "requestId": "req-P11-transport",
                "subjectId": "P11",
                "destination": "TOWN",
                "need": "transport",
                "departByMs": Q2_MS,
                "returnAfterMin": 60,
                "purpose": "약 수령",
            },
            hiddenTruth="원본(Q2)에서는 P3가 약을 받아다 주었다. 심부름을 이동 필요로 바꾼 것은 실험 가정이다.",
            prohibitedInferences=[
                "두 요청을 같은 차량에 자동으로 합치지 말 것",
                "가게를 비울 수 없는 부부의 사정을 MEDial이 아는 것으로 처리하지 말 것",
            ],
        ),
    ],
)
