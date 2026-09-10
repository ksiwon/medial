"""Turn a set of individual reviews into issues, without averaging them away.

Three properties are the whole reason this is a separate step:

* a minority is preserved. One person carrying a large burden is an issue group
  of its own with ``minority=True``, not a rounding error under "most residents
  were fine";
* disagreement is preserved. Whoever graded the same dimension the other way is
  listed as a dissenting actor on the issue, so the improvement step cannot read
  a one-sided summary;
* the researcher's objective metrics travel *beside* the reviews and are never
  merged into them. A wait time is not an opinion and an opinion is not a wait
  time.

The causal sentences ("this happened because…") are hypotheses. Each carries its
alternative explanations, and the screen labels them as assumptions.
"""
from __future__ import annotations

from typing import Any

from ..contracts import HEALTH_STAFF
from .contracts import (
    AgentReview,
    IssueGroup,
    ReviewConflict,
    ReviewDimensionKey as D,
    ReviewSynthesis,
    UsageStatus,
)

#: A hypothesis per dimension, plus the readings that would explain the same
#: reviews differently. Stated so a designer cannot mistake the first for a
#: finding.
MECHANISMS: dict[str, tuple[str, list[str]]] = {
    D.help_resolution.value: (
        "요청이 닫히지 못한 것은 다음 담당자로 넘어가는 조건이 없거나 늦기 때문이라는 가설.",
        ["필요 자체가 이 deck에서 해결 불가능하게 설정되어 있을 수 있다",
         "연락이 닿지 않은 것은 정책이 아니라 그 시각 세계 상태 때문일 수 있다"],
    ),
    D.time_labour.value: (
        "특정인에게 요청이 반복해서 배정되기 때문이라는 가설.",
        ["그 사람이 그 시각에 응답 가능한 유일한 후보였을 수 있다",
         "부담 기준(분)이 연구자 가정이라 실제 체감과 다를 수 있다"],
    ),
    D.choice_refusal.value: (
        "본인에게 묻는 절차 없이 배정이 진행되기 때문이라는 가설.",
        ["요청 사건이 그 사람에게 주소 지정되지 않았을 뿐 실제로는 물었을 수 있다"],
    ),
    D.disclosure.value: (
        "공개 범위 설정이 필요보다 넓기 때문이라는 가설.",
        ["받는 쪽이 판단하려면 그 정보가 실제로 필요했을 수 있다"],
    ),
    D.understandability.value: (
        "진행 상황이 당사자에게 되돌아가는 절차가 없기 때문이라는 가설.",
        ["설명이 갔지만 이 사람의 관측 범위 밖에서 이루어졌을 수 있다"],
    ),
    D.reuse_condition.value: (
        "재이용 조건이 원자료에 없어 확인되지 않았기 때문이라는 가설.",
        ["조건이 있으나 이번 Cycle에서 시험되지 않았을 수 있다"],
    ),
}

#: Which researcher metric belongs next to which dimension. Named, so the screen
#: can put the number beside the opinion instead of inside it.
METRIC_REFS: dict[str, list[str]] = {
    D.help_resolution.value: ["requests.unresolved", "waitMs.meanMinutesResolvedOnly"],
    D.time_labour.value: ["neighbourMinutes", "institutionBurden.staffMinutes",
                          "residentBurden"],
    D.choice_refusal.value: ["transport.peopleAsked", "transport.reservationsHeld"],
    D.disclosure.value: ["disclosure"],
    D.understandability.value: ["contacts.attempts"],
    D.reuse_condition.value: [],
}


class RuleSynthesisAdapter:
    """Deterministic grouping. Does not decide anything; it only preserves."""

    name = "rule"

    def synthesise(self, *, reviews: list[AgentReview], objective_metrics: dict[str, Any],
                   session_id: str, generation_index: int, attempt_ids: list[str],
                   created_at: str, synthesis_id: str) -> ReviewSynthesis:
        graded_actors = {r.actorId for r in reviews
                         if any(i.assessment != "unknown" for i in r.items)}
        groups: list[IssueGroup] = []

        for dimension in D:
            negatives: list[tuple[AgentReview, int, Any]] = []
            positives: list[str] = []
            unknown_actors: list[str] = []
            for review in reviews:
                for index, item in enumerate(review.items):
                    if item.dimension is not dimension:
                        continue
                    if item.assessment in ("negative", "mixed"):
                        negatives.append((review, index, item))
                    elif item.assessment == "positive":
                        positives.append(review.actorId)
                    else:
                        unknown_actors.append(review.actorId)

            if not negatives:
                continue

            affected = sorted({r.actorId for r, _, _ in negatives})
            hard = [t for t in negatives if t[2].assessment == "negative"]
            institution_hit = any(r.actorId == HEALTH_STAFF for r, _, _ in negatives)
            mechanism, alternatives = MECHANISMS[dimension.value]

            # "Fewer people raised it than were fine with it" is exactly the
            # shape a majority reading deletes, so it is flagged and shown
            # separately. The institution counts as a minority on its own: one
            # desk absorbing the cost of everybody else's improvement is the
            # case doc 12 asks not to lose.
            dissent_count = len(set(positives))
            minority = (
                len(affected) < dissent_count
                or (bool(graded_actors)
                    and len(affected) <= max(1, len(graded_actors) // 3))
                or affected == [HEALTH_STAFF])

            groups.append(IssueGroup(
                id="iss-%s-%d-%s" % (session_id[-6:], generation_index, dimension.value),
                title=_title(dimension, affected, bool(hard)),
                dimension=dimension,
                reviewItemRefs=["%s#%d" % (r.id, i) for r, i, _ in negatives],
                eventRefs=sorted({ref for _, _, item in negatives
                                  for ref in item.eventRefs})[:12],
                affectedActors=affected,
                dissentingActors=sorted(set(positives)),
                severity=("blocking" if (hard and institution_hit) or len(hard) >= 3
                          else "significant" if hard else "minor"),
                minority=minority,
                assumedMechanism=mechanism,
                alternativeExplanations=alternatives,
                objectiveMetricRefs=METRIC_REFS[dimension.value],
                unknowns=(["%s은(는) 이 항목에 답할 근거가 없다고 했다"
                           % ", ".join(sorted(set(unknown_actors))[:4])]
                          if unknown_actors else []),
            ))

        conflicts = _conflicts(reviews, groups)
        requested = [item.requestedChange for r in reviews for item in r.items
                     if item.requestedChange]
        return ReviewSynthesis(
            id=synthesis_id, sessionId=session_id, generationIndex=generation_index,
            attemptIds=attempt_ids, reviewIds=[r.id for r in reviews], adapter="rule",
            issueGroups=groups,
            minorityConcernIds=[g.id for g in groups if g.minority],
            conflicts=conflicts,
            objectiveMetrics=objective_metrics,
            noExperienceActors=sorted({r.actorId for r in reviews
                                       if r.usageStatus is UsageStatus.no_experience}),
            ungroundedClaims=_ungrounded(reviews),
            nextQuestions=sorted(set(requested))[:8],
            createdAt=created_at)


def _title(dimension: D, affected: list[str], hard: bool) -> str:
    labels = {
        D.help_resolution: "해결되지 않거나 넘겨진 채로 끝난 건",
        D.time_labour: "특정인에게 몰린 시간과 이동",
        D.choice_refusal: "묻지 않고 진행된 배정",
        D.disclosure: "필요보다 넓게 전달된 정보",
        D.understandability: "당사자에게 돌아가지 않은 설명",
        D.reuse_condition: "다음 이용 조건이 확인되지 않음",
    }
    return "%s (%s%d명)" % (labels[dimension], "강한 불만 포함 " if hard else "",
                            len(affected))


def _conflicts(reviews: list[AgentReview],
               groups: list[IssueGroup]) -> list[ReviewConflict]:
    """Where one party's gain is visibly another's cost.

    This is the case doc 12 asks to be kept in front of the designer: residents
    reporting that the thing got done while the desk reports that it got done out
    of their hours.
    """
    out: list[ReviewConflict] = []

    residents_helped = sorted({
        r.actorId for r in reviews if r.actorRole in ("resident", "village_head")
        and any(i.dimension is D.help_resolution and i.assessment == "positive"
                for i in r.items)})
    desk_burdened = sorted({
        r.actorId for r in reviews if r.actorRole in ("health_staff", "health_director")
        and any(i.dimension is D.time_labour and i.assessment in ("negative", "mixed")
                for i in r.items)})
    if residents_helped and desk_burdened:
        out.append(ReviewConflict(
            id="conf-resolution-vs-desk",
            description=("주민 쪽에서는 일이 해결됐다고 나오는 동시에 기관 쪽에서는 "
                         "업무 시간이 늘었다고 나온다."),
            issueRefs=[g.id for g in groups if g.dimension is D.time_labour],
            sideA=residents_helped, sideB=desk_burdened,
            note="한쪽의 개선을 전체 개선으로 읽지 않는다."))

    helpers_burdened = sorted({
        r.actorId for r in reviews if r.actorRole in ("resident", "village_head")
        and any(i.dimension is D.time_labour and i.assessment == "negative"
                for i in r.items)})
    subjects_served = sorted({
        r.actorId for r in reviews
        if r.usageStatus is UsageStatus.used and r.actorId not in helpers_burdened
        and any(i.dimension is D.help_resolution and i.assessment == "positive"
                for i in r.items)})
    if helpers_burdened and subjects_served:
        out.append(ReviewConflict(
            id="conf-served-vs-helper",
            description="도움을 받은 사람과 그 시간을 낸 이웃이 서로 다른 방향으로 평가한다.",
            issueRefs=[g.id for g in groups if g.dimension is D.time_labour],
            sideA=subjects_served, sideB=helpers_burdened,
            note="이웃 부담은 이 도구가 자동으로 줄일 수 있는 값이 아니다."))
    return out


def _ungrounded(reviews: list[AgentReview]) -> list[str]:
    """Graded items with no event behind them.

    Validation refuses these before they are stored, so in a healthy run this is
    empty. It exists so that a loosened validator would show up here instead of
    disappearing.
    """
    out = []
    for review in reviews:
        for index, item in enumerate(review.items):
            if item.assessment != "unknown" and not item.eventRefs:
                out.append("%s#%d (%s) 근거 사건 없음"
                           % (review.id, index, item.dimension.value))
    return out
