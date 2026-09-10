"""T004: P9 has to get to town, and nobody is driving him yet.

The source records P9 arriving in town by car and coming home in somebody
else's car later the same day. Both of those are *results* - somebody asked,
somebody agreed - so neither belongs in the deck. What the deck fixes is the
part that is true before any policy runs: P9 needs to be in town, and he does
not drive himself.

That distinction matters more here than anywhere else in the project. P9's
baseline day is "at home, all day", and reading that as "no need to go out"
would delete the entire coordination problem: he is at home in the baseline
*because* the ride is not in the baseline.

The second need is deliberately timed to land while the first driver is still
out. It is there to make double-booking, teleporting and leftover reservations
fail loudly rather than never come up.
"""
from __future__ import annotations

from ..contracts import (
    MEDIAL,
    ContactStrategy,
    EventType,
    PolicyParams,
    PolicyRevision,
    ResourceRevision,
    ScenarioDeck,
    ScenarioEvent,
)

MIN_MS = 60_000
HOUR_MS = 60 * MIN_MS

NEED_MS = 8 * HOUR_MS                     # 08:00 - P9 raises the need
SECOND_NEED_MS = 10 * HOUR_MS + 30 * MIN_MS   # 10:30 - while the first car is out
HORIZON_MS = 20 * HOUR_MS

DECK_ID = "deck-p9-transport-v1"

DECK = ScenarioDeck(
    id=DECK_ID,
    label="P9 읍내 이동 필요 · 두 번째 요청과 충돌",
    classification="source_adapted",
    horizonMs=HORIZON_MS,
    assumptions=[
        "P9의 읍내 진료 필요는 원본에 있다. 누가 태웠는지는 조율 결과이므로 deck에 넣지 않는다.",
        "P9가 baseline에서 하루 종일 집에 있는 것은 '외출이 필요 없다'는 뜻이 아니라 "
        "동승이 아직 배정되지 않았다는 뜻이다.",
        "08:00 요청 시각과 두 시간 체류는 실험 가정이다.",
        "두 번째 요청(10:30)은 자원 충돌을 검사하기 위해 연구자가 주입한 것이며 원본 사건이 아니다.",
        "차량 좌석 수는 원자료에 없다. ResourceRevision의 가정값을 쓴다.",
    ],
    events=[
        ScenarioEvent(
            id="exo-transport-p9",
            simTimeMs=NEED_MS,
            type=EventType.transport_need_raised,
            subjectId="P9",
            initiallyVisibleTo=[MEDIAL, "P9"],
            payload={
                "requestId": "req-P9-transport",
                "subjectId": "P9",
                "destination": "TOWN",
                "need": "transport",
                "departByMs": NEED_MS,
                "returnAfterMin": 120,
                "purpose": "읍내 진료",
            },
            hiddenTruth="원본에서는 이웃 차량 동승으로 해결되었다. 그 결과를 미리 넣지 않는다.",
            prohibitedInferences=[
                "baseline에 자택만 있다는 것을 '외출 필요 없음'으로 읽지 말 것",
                "원본의 동승 결과를 실험의 고정 사실로 쓰지 말 것",
                "운전 가능 여부·좌석 수를 확인된 사실로 만들지 말 것",
            ],
        ),
        ScenarioEvent(
            id="exo-transport-p11",
            simTimeMs=SECOND_NEED_MS,
            type=EventType.transport_need_raised,
            subjectId="P11",
            initiallyVisibleTo=[MEDIAL, "P11"],
            payload={
                "requestId": "req-P11-transport",
                "subjectId": "P11",
                "destination": "TOWN",
                "need": "transport",
                "departByMs": SECOND_NEED_MS,
                "returnAfterMin": 60,
                "purpose": "약 수령",
            },
            hiddenTruth="연구자가 주입한 충돌 검사용 요청이다.",
            prohibitedInferences=[
                "두 요청을 같은 차량에 자동으로 합치지 말 것",
                "취소된 예약이 좌석을 계속 차지하지 않게 할 것",
            ],
        ),
    ],
)

POLICY_T_A = PolicyRevision(
    id="policy-T-A-v1",
    parentId=None,
    coreItem="이동이 필요한 사람을 누구의 차로 옮길 것인가",
    label="T-A · 본인이 지목한 사람 우선 / 우회 20분까지",
    changes=[],
    contactStrategy=ContactStrategy.head_first,
    params=PolicyParams(
        rideCandidateOrder="kin_first",
        maxRideDetourMin=20,
        helperContactCap=4,
        disclosure="minimal",
    ),
    assumptionRefs=["assumption-seat-capacity", "assumption-detour-tolerance"],
)

POLICY_T_B = PolicyRevision(
    id="policy-T-B-v1",
    parentId="policy-T-A-v1",
    coreItem="이동이 필요한 사람을 누구의 차로 옮길 것인가",
    label="T-B · 동선 겹침 우선 / 우회 2분까지",
    changes=["후보 순서를 동선 우선으로", "허용 우회를 2분으로 줄임"],
    contactStrategy=ContactStrategy.head_first,
    params=PolicyParams(
        rideCandidateOrder="closest_first",
        maxRideDetourMin=2,
        helperContactCap=4,
        disclosure="minimal",
    ),
    assumptionRefs=["assumption-seat-capacity", "assumption-detour-tolerance"],
)

RESOURCES_T = ResourceRevision(
    id="assumed-resources-transport-v1",
    label="연구용 차량·기관 자원 가정",
    staffCount=1,
    shiftStartMs=9 * HOUR_MS,
    shiftEndMs=18 * HOUR_MS,
    reviewMinutes=20,
    callMinutes=5,
    visitTravelMinutes=25,
    visitMinutes=20,
    initialQueueDepth=0,
    assumedVehicleSeats=3,
    assumptions=[
        "승용차 좌석 3석은 실험 가정이다. 원자료에 좌석 수 기록이 없다.",
        "기관 자원은 P1 deck과 같은 가정을 쓴다.",
    ],
)
