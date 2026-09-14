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

from .contracts import (
    AvailabilityRule,
    Channel,
    EnvironmentRevision,
    InteractionRules,
    ReachabilityRule,
    RoutineVariation,
)

#: Order in which same-timestamp work is drained. Previously ``engine.PRIORITY``.
SCHEDULING = {
    "scenario": 10,
    "contact": 20,
    "reaction": 30,
    # Between a reaction and an arrival: a hand-off is settled before anyone
    # gets anywhere, but after the reaction that caused it.
    "relay": 35,
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

#: Whether somebody staying in a place could break off and go. Sibling of the
#: phone table, and like it, mostly assumption: the interviews say the restaurant
#: couple cannot leave the shop, but that is a *persona* condition and is checked
#: there, not here.
_AVAILABLE_V1 = [
    AvailabilityRule(
        place="PATROL", available=True, provenance="researcher-assumption",
        reason="순찰은 도는 일이라 가는 길에 들를 수 있다고 가정"),
    AvailabilityRule(
        place="HALL", available=True, provenance="researcher-assumption",
        reason="마을회관에 있는 동안에는 자리를 뜰 수 있다고 가정"),
    AvailabilityRule(
        place="FARM", available=True, provenance="researcher-assumption",
        reason="밭일은 잠시 놓고 다녀올 수 있다고 가정"),
    # v1 kept homes unavailable. Not on purpose: the rule was a set containing
    # "HOME" while a stay at home carries the place "HOME:P1", so the entry never
    # matched. Every stored attempt ran under this, so v1 states it plainly
    # instead of quietly acquiring the fix and changing what those runs meant.
    AvailabilityRule(
        place="HOME:*", available=False, provenance="researcher-assumption",
        reason=("v1은 자택 체류를 '자리를 뜰 수 없음'으로 다룬다. 의도한 규칙이 아니라 "
                "구현상 결과이며, 저장된 실행은 모두 이 조건에서 돌았다. env-v2가 고친다."),
    ),
    AvailabilityRule(
        place="*", available=False, provenance="researcher-assumption",
        reason="일터·조업·이동 중에는 자리를 뜰 수 없다고 가정"),
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
    availability=list(_AVAILABLE_V1),
    interaction=InteractionRules(
        relayEnabled=True,
        maxRelayHops=1,
        relayDelayMin=10,
        copresenceEnabled=True,
        assumptions=[
            "주민은 기록된 관계를 따라 일을 넘길 수 있을 뿐 자유롭게 대화하지 않는다. "
            "doc 19가 '자유 주민 채팅'과 '완전 자율 행동 LLM'을 배제한 경계를 그대로 지킨다.",
            "홉 상한 1은 연구자 설정이다. 원자료에는 이장이 한 번 넘긴 장면까지만 있고 "
            "그 이상의 연쇄를 뒷받침하는 기록이 없다.",
            "이웃에게 말을 전하는 데 걸리는 10분도 연구자 설정이다. 원자료에는 "
            "전가에 걸린 시간이 기록되어 있지 않다.",
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

#: v2 differs from v1 in exactly one rule: somebody at home can be asked.
#:
#: Under v1 nobody at home could ever be interrupted, which left two of twelve
#: people available at nine in the morning and *nobody at all* at lunch or in the
#: evening. That is not what the interviews describe. Whether a particular person
#: can actually leave - the restaurant couple cannot - is a persona condition and
#: is still checked there.
#:
#: v1 is kept rather than edited. Every stored attempt ran on it, and a stored
#: run whose meaning changes underneath it is worse than one that is simply old.
#: Two attempts on different revisions are reported as an uncontrolled pair.
ENV_V2 = ENV_V1.model_copy(deep=True, update={
    "id": "env-v2",
    "label": "원본 도입 조건 (v2) · 자택에서도 부탁을 받을 수 있음",
})
for _rule in ENV_V2.availability:
    if _rule.place == "HOME:*":
        _rule.available = True
        _rule.reason = "자택에 있는 동안에는 부탁을 받고 나설 수 있다고 가정"
ENV_V2.assumptions = [
    *ENV_V1.assumptions,
    "자택 체류를 '자리를 뜰 수 있음'으로 바꾼 것은 v1 대비 유일한 차이다. "
    "이 때문에 결과가 좋아졌다면 그것은 MEDial이 나아진 것이 아니라 세계 조건을 바꾼 것이며, "
    "비교 화면은 두 실행을 통제된 쌍으로 부르지 않는다.",
]

ENV_V2_FIXED = ENV_V2.model_copy(deep=True, update={
    "id": "env-v2-fixed",
    "label": "원본 도입 조건 (v2) · 일과 변이 없음",
})
ENV_V2_FIXED.variation.enabled = False

#: v3 differs from v2 in the variation only: a village day is the same day
#: again, give or take a few minutes.
#:
#: v2 dropped an outing with probability 0.15 per outing, and on the real
#: village that produced a "plausible_extension" day on almost every run - the
#: exception became the default. The premise the researcher stated is the other
#: way round: the routine repeats, and what varies is when people leave, not
#: whether. So the drop and repeat probabilities are zero here and the jitter is
#: ten minutes. A run that wants a day with an outing missing asks for v2 by
#: name and is reported as a different input.
ENV_V3 = ENV_V2.model_copy(deep=True, update={
    "id": "env-v3",
    "label": "원본 도입 조건 (v3) · 같은 일과, 시각만 조금 다름",
})
ENV_V3.variation = RoutineVariation(
    enabled=True,
    departJitterMin=10,
    skipOutingProbability=0.0,
    repeatOutingProbability=0.0,
    excludeSingleStepResidents=True,
    assumptions=[
        "시골 마을의 하루는 매일 같은 일과의 반복이라고 본다. 바뀌는 것은 나가는 시각뿐이며 "
        "±10분 안에서만 흔든다. 외출을 거르거나 더하는 일은 기본 하루에 넣지 않는다.",
        "외출이 빠진 하루를 보려면 env-v2를 이름으로 골라야 하고, 그 실행은 다른 입력으로 표시된다.",
    ],
)
ENV_V3.assumptions = [
    *ENV_V2.assumptions,
    "v2 대비 유일한 차이는 일과 변이다. 외출 생략 확률 0.15가 실제 마을에서 거의 매번 "
    "'외출 하나가 다른 하루'를 만들어, 예외가 기본이 되어 있었다.",
]

ENV_V3_FIXED = ENV_V3.model_copy(deep=True, update={
    "id": "env-v3-fixed",
    "label": "원본 도입 조건 (v3) · 일과 변이 없음",
})
ENV_V3_FIXED.variation.enabled = False

ENVIRONMENTS: dict[str, EnvironmentRevision] = {
    ENV_V1.id: ENV_V1,
    ENV_V1_FIXED.id: ENV_V1_FIXED,
    ENV_V2.id: ENV_V2,
    ENV_V2_FIXED.id: ENV_V2_FIXED,
    ENV_V3.id: ENV_V3,
    ENV_V3_FIXED.id: ENV_V3_FIXED,
}
DEFAULT_ENVIRONMENT_ID = ENV_V3.id
#: What a deterministic scenario test should ask for by name.
FIXED_ENVIRONMENT_ID = ENV_V3_FIXED.id
#: The revision every attempt stored before availability became data ran on.
LEGACY_ENVIRONMENT_ID = ENV_V1.id
LEGACY_FIXED_ENVIRONMENT_ID = ENV_V1_FIXED.id


def get_environment(environment_id: str | None = None) -> EnvironmentRevision:
    return ENVIRONMENTS[environment_id or DEFAULT_ENVIRONMENT_ID]


def resolve_place(place: str, actor_id: str) -> str:
    """``HOME:self`` is written per listener, so the caller's own home matches it."""
    return "HOME:self" if place == "HOME:" + actor_id else place
