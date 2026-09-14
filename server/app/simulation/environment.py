"""Environment revisions: the world's rules as data.

``env-v1`` reproduces exactly what used to be three sets of module constants -
``PRIORITY`` in the engine and ``PHONE_REACHABILITY`` / ``device_rule`` in the
resident adapter. Nothing about behaviour changes here; what changes is that the
rules now travel with the attempt, hash into its inputs, and survive an adapter
swap.

Two rules of the house:

* this is fixed case input. ``EDITABLE_BY_CHANGE_SET`` is False and the Change
  Set validator refuses to touch it. MEDial improving by making the world stop
  producing the problem is not an improvement;
* reachability keeps the one source-adapted rule (P1 did not answer from the
  field) separate from the assumptions built around it, because only the first
  is evidence.
"""
from __future__ import annotations

from .contracts import Channel, EnvironmentRevision, ReachabilityRule, RoutineVariation

#: Order in which same-timestamp work is drained. Previously ``engine.PRIORITY``.
SCHEDULING = {
    "scenario": 10,
    "contact": 20,
    "reaction": 30,
    "arrival": 40,
    "institution": 50,
    "transport": 60,
    "finalize": 90,
}

_PHONE = [
    ReachabilityRule(
        place="FARM", channel=Channel.phone, reachable=False,
        provenance="source-adapted",
        reason="원본 사건에서 밭에 있는 동안 문진에 응답하지 않았다"),
    ReachabilityRule(
        place="SEA", channel=Channel.phone, reachable=False,
        provenance="researcher-assumption",
        reason="조업 중에는 받지 못한다고 가정"),
    ReachabilityRule(
        place="PORT", channel=Channel.phone, reachable=False,
        provenance="researcher-assumption",
        reason="그물 작업 중에는 받지 못한다고 가정"),
    ReachabilityRule(
        place="FOOD", channel=Channel.phone, reachable=False,
        provenance="researcher-assumption",
        reason="근무 중에는 받지 못한다고 가정"),
    ReachabilityRule(
        place="EN_ROUTE", channel=Channel.phone, reachable=False,
        provenance="researcher-assumption",
        reason="이동 중 응답 여부를 알 수 없어 미응답으로 가정"),
    # The old table reached this through ``PHONE_DEFAULT`` plus an explicit
    # ``startswith("HOME:")`` branch. Both said "answered", so one default rule
    # covers them; the prefix entry stays because a home is where the source
    # evidence is strongest and a later revision may want to split them.
    ReachabilityRule(
        place="HOME:*", channel=Channel.phone, reachable=True,
        provenance="researcher-assumption",
        reason="자택에서는 받는다고 가정"),
    ReachabilityRule(
        place="*", channel=Channel.phone, reachable=True,
        provenance="researcher-assumption",
        reason="그 밖의 장소에서는 받는다고 가정"),
]

#: The clock-radio is fixed in the house. ``device_rule`` used to compute this
#: per actor; as data it is one rule plus its negation, resolved by the caller
#: substituting the listener's own home id for ``HOME:self``.
_DEVICE = [
    ReachabilityRule(
        place="HOME:self", channel=Channel.home_device, reachable=True,
        provenance="source-adapted",
        reason="안내 시계는 집에 설치된 기기이므로 집에 있을 때만 닿는다"),
    ReachabilityRule(
        place="*", channel=Channel.home_device, reachable=False,
        provenance="source-adapted",
        reason="안내 시계는 집에 설치된 기기이므로 집 밖에서는 닿지 않는다"),
]

ENV_V1 = EnvironmentRevision(
    id="env-v1",
    label="원본 도입 조건 (v1)",
    scheduling=dict(SCHEDULING),
    reachability=[*_PHONE, *_DEVICE],
    variation=RoutineVariation(
        enabled=True,
        departJitterMin=15,
        skipOutingProbability=0.15,
        repeatOutingProbability=0.0,
        excludeSingleStepResidents=True,
        assumptions=[
            "원본의 출발 시각은 하루치 기록이므로 정확한 법칙으로 다루지 않는다. "
            "±15분 지터는 그 기록의 정확도에 대한 불확실성이지 주민이 변덕스럽다는 주장이 아니다.",
            "외출을 건너뛰는 빈도는 원자료에 없다. 0.15는 연구자 설정이며 "
            "그 결과로 만들어진 하루는 plausible_extension으로 표시한다.",
            "새 목적지는 생성하지 않는다. 반복 외출은 본인 baseline에 이미 있는 장소로만 간다.",
            "baseline이 한 단계뿐인 주민(P9·P10·P11)은 변이 대상에서 제외한다. "
            "원자료에 일과 기록이 없어 흔들면 창작이 된다.",
        ],
    ),
    assumptions=[
        "전화 도달 여부 중 실제 사건에서 온 것은 밭 미응답 하나뿐이고 나머지는 연구자 가정이다.",
        "동시각 사건의 처리 순서는 엔진 구현의 결정이며 관측된 사실이 아니다.",
    ],
)

#: The same world with the day-to-day draw switched off, so that every run lands
#: on exactly the recorded day. Used where the question is "does this mechanism
#: work", not "what happens on a given day": a scenario test that asserts P1 is
#: out in the field at 09:30 is asking about the engine, and a drawn day that
#: happens to leave him at home would fail it for the wrong reason.
ENV_V1_FIXED = ENV_V1.model_copy(deep=True, update={
    "id": "env-v1-fixed",
    "label": "원본 도입 조건 (v1) · 일과 변이 없음",
})
ENV_V1_FIXED.variation.enabled = False

ENVIRONMENTS: dict[str, EnvironmentRevision] = {
    ENV_V1.id: ENV_V1,
    ENV_V1_FIXED.id: ENV_V1_FIXED,
}
DEFAULT_ENVIRONMENT_ID = ENV_V1.id
#: What a deterministic scenario test should ask for by name.
FIXED_ENVIRONMENT_ID = ENV_V1_FIXED.id


def get_environment(environment_id: str | None = None) -> EnvironmentRevision:
    return ENVIRONMENTS[environment_id or DEFAULT_ENVIRONMENT_ID]


def resolve_place(place: str, actor_id: str) -> str:
    """``HOME:self`` is written per listener, so the caller's own home matches it."""
    return "HOME:self" if place == "HOME:" + actor_id else place
