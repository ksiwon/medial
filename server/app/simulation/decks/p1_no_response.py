"""Scenario A from doc 04 section 6: the 09:30 check-in that P1 does not answer.

What the deck fixes is only the *exogenous* part - that a routine check-in goes
out at 09:30. Whether it is answered is computed from where P1 actually is, so a
policy that calls back at a different hour genuinely gets a different result.

What the deck does not contain: the original Q3 outcome (the head visiting at
14:00 and finding P1 in the field at 15:35). That was one policy's result, not a
fact of the day.
"""
from __future__ import annotations

from ..contracts import (
    MEDIAL,
    Channel,
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

CHECKIN_MS = 9 * HOUR_MS + 30 * MIN_MS   # 09:30
HORIZON_MS = 20 * HOUR_MS                # run to 20:00

DECK_ID = "deck-p1-no-response-v1"

DECK = ScenarioDeck(
    id=DECK_ID,
    label="P1 09:30 안부 확인 무응답",
    classification="source_adapted",
    horizonMs=HORIZON_MS,
    assumptions=[
        "09:30 정기 안부 문진이 발송된다는 것은 실험 가정이다. 실제 운영 시각이 아니다.",
        "무응답은 응급상황이 아니다. 상태 악화 신호는 이 deck에 들어 있지 않다.",
        "P1이 이 시각 밭에 있다는 것은 원본 일과에서 온 세계 사실이며, MEDial은 알 수 없다.",
        "기관 가용성(근무시간·검토시간·대기열)은 실험 가정이며 남해군 실제 인력 통계가 아니다.",
        "장소별 전화 응답 여부는 연구자 가정이다. 밭 미응답만 원본 사건에서 왔다.",
    ],
    events=[
        ScenarioEvent(
            id="exo-checkin-1",
            simTimeMs=CHECKIN_MS,
            type=EventType.contact_attempted,
            subjectId="P1",
            initiallyVisibleTo=[MEDIAL, "P1"],
            payload={
                "channel": Channel.home_device.value,
                "toActorId": "P1",
                "purpose": "daily_checkin",
                "disclosure": {"subjectId": "P1", "fields": [], "recipientClass": "subject"},
            },
            hiddenTruth="P1은 09:00에 밭으로 나가 12:00에 귀가한다. 아무 일도 일어나지 않았다.",
            prohibitedInferences=[
                "무응답을 의식 저하·낙상·응급으로 해석하지 말 것",
                "무응답을 비협조나 거절로 기록하지 말 것",
            ],
        ),
    ],
)

POLICY_A = PolicyRevision(
    id="policy-A-v1",
    parentId=None,
    coreItem="응답이 없는 안부 확인을 누구의 시간으로 해결할 것인가",
    label="A · 이장 우선 확인",
    changes=[],
    contactStrategy=ContactStrategy.head_first,
    params=PolicyParams(
        retryCount=0,
        helperContactCap=2,
        disclosure="named",
        allowHeadContact=True,
    ),
    assumptionRefs=["assumption-head-availability", "assumption-phone-reachability"],
)

POLICY_B = PolicyRevision(
    id="policy-B-v1",
    parentId="policy-A-v1",
    coreItem="응답이 없는 안부 확인을 누구의 시간으로 해결할 것인가",
    label="B · 재연락 후 보건소 인계",
    changes=["이웃 연락을 쓰지 않는다", "재연락 2회 후 보건소 담당자에게 인계"],
    contactStrategy=ContactStrategy.retry_then_clinic,
    params=PolicyParams(
        retryCount=2,
        retryIntervalMin=40,
        helperContactCap=2,
        disclosure="named",
        allowHeadContact=False,
    ),
    assumptionRefs=["assumption-clinic-capacity", "assumption-phone-reachability"],
)

POLICY_C = PolicyRevision(
    id="policy-C-v1",
    parentId="policy-A-v1",
    coreItem="응답이 없는 안부 확인을 누구의 시간으로 해결할 것인가",
    label="C · 가까운 이웃 우선",
    changes=["이장에게 먼저 묻지 않는다", "공개된 일과상 이 시각 자택에 있는 사람에게 먼저 부탁"],
    contactStrategy=ContactStrategy.neighbour_first,
    params=PolicyParams(
        retryCount=0,
        helperContactCap=2,
        disclosure="named",
        allowHeadContact=True,
    ),
    assumptionRefs=["assumption-head-availability", "assumption-phone-reachability"],
)

POLICY_D = PolicyRevision(
    id="policy-D-v1",
    parentId="policy-A-v1",
    coreItem="응답이 없는 안부 확인을 누구의 시간으로 해결할 것인가",
    label="D · 재연락 후 가까운 관계, 마지막에 이장",
    changes=["이웃·이장에게 묻기 전에 본인에게 한 번 더 전화한다",
             "기록된 가까운 관계(동행군·친척·도움을 주고받은 기록)에게 먼저 부탁",
             "이장은 마지막"],
    contactStrategy=ContactStrategy.relation_first,
    params=PolicyParams(
        retryCount=1,
        retryIntervalMin=40,
        helperContactCap=2,
        disclosure="named",
        allowHeadContact=True,
    ),
    assumptionRefs=["assumption-registered-contacts", "assumption-head-availability",
                    "assumption-phone-reachability"],
)

RESOURCES = ResourceRevision(
    id="assumed-resources-v1",
    label="연구용 보건소 자원 가정",
    staffCount=1,
    shiftStartMs=9 * HOUR_MS,
    shiftEndMs=18 * HOUR_MS,
    reviewMinutes=20,
    callMinutes=5,
    visitTravelMinutes=25,
    visitMinutes=20,
    initialQueueDepth=1,
    assumptions=[
        "담당자 1명, 09:00-18:00 근무는 연구용 가정이다.",
        "검토 20분·통화 5분·방문 왕복 25분은 연구용 가정이며 측정값이 아니다.",
        "대기열에 이미 1건이 있다고 가정한다. 실제 접수량이 아니다.",
        "보건소 좌표가 확인되지 않아 지도 밖 연계 기관 노드로 둔다.",
    ],
)

POLICIES = {POLICY_A.id: POLICY_A, POLICY_B.id: POLICY_B}
DECKS = {DECK.id: DECK}
RESOURCE_SETS = {RESOURCES.id: RESOURCES}
