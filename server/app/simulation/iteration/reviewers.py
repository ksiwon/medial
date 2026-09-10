"""Review adapters: rule, scripted and model-backed.

All three produce the same ``AgentReview`` and all three are validated by
:func:`experience.validate_review` before anything stores them. That is the
point of the boundary: the rule reviewer is not trusted more than the model, it
is simply cheaper.

The rule reviewer is written to be *capable of being negative*. It reads what
happened to one actor and grades it; a cycle that went badly for a helper
produces a negative item with the helper's own travel event attached. Nothing
here is keyed to the generation index, so a later generation cannot come out
better simply because it is later.

Where the persona source records an explicit unknown - "we do not know what this
person accepts" - the corresponding dimension stays ``unknown`` and cites that
card. Filling it in would be the exact failure the evidence cards exist to
prevent.
"""
from __future__ import annotations

from typing import Any, Protocol

from ..contracts import HEALTH_STAFF

#: The engine's machine-readable reason codes, said in Korean.
#:
#: The codes stay on the event, where a metric or a filter needs them. What must
#: not happen is a code arriving inside a sentence a resident is supposed to have
#: said: "부탁을 받았지만 이번에는 하지 못했다 (driving_status_unknown)" reads as if
#: they had spoken the identifier. Reasons the engine already writes in Korean
#: pass through, and an unmapped code is labelled as a code rather than dropped -
#: losing the reason would be worse than showing it.
_REASON_KO: dict[str, str] = {
    "does_not_drive": "운전을 하지 않는 사람이라서",
    "driving_status_unknown": "운전을 할 수 있는지 원자료에 없어서",
    "no_route": "그 길로는 갈 수 없어서",
    "cannot_leave_post": "자리를 비울 수 없어서",
    "detour_too_long": "우회 시간이 한도를 넘어서",
    "detour_within_budget": "우회 시간이 한도 안이라서",
    "contact_cap_reached": "연락 상한에 걸려서",
    "activity_locked": "하던 일을 멈출 수 없어서",
    "outside_shift": "근무 시간이 아니라서",
    "queued_for_review": "검토 대기로 넘겨서",
    "seats_exhausted": "남은 좌석이 없어서",
    "duplicate_reservation": "이미 같은 예약이 있어서",
    "driver_double_booked": "운전자가 이미 다른 예약에 묶여 있어서",
    "rider_already_riding": "이미 다른 차에 타고 있어서",
    "retry_scheduled": "다시 걸기로 예약해서",
    "awaiting_escalation_deadline": "인계 기한을 기다리는 중이라서",
    "proposal_rejected": "제안이 검증을 통과하지 못해서",
    "adapter_error": "어댑터 오류로",
    "unspecified": "사유가 지정되지 않아서",
}


def reason_ko(value: Any, fallback: str = "이유 기록 없음") -> str:
    """A payload ``reason`` as a phrase, for prose a person reads."""
    if not isinstance(value, str) or not value.strip():
        return fallback
    if any("가" <= ch <= "힣" for ch in value):
        return value
    return _REASON_KO.get(value, f"기록된 사유 코드 {value}")
from .contracts import (
    REVIEW_CONTRACT_VERSION,
    AgentReview,
    ReviewDimensionKey as D,
    ReviewItem,
    UsageStatus,
)
from .experience import ActorExperience

#: Researcher assumptions, not measurements. They set where "some of my time"
#: becomes "a lot of my time" in a rule-written review, and they are reported as
#: assumptions wherever a review built on them is shown.
HEAVY_TASK_MINUTES = 30
REPEATED_CONTACT_COUNT = 2

ASSUMPTION_NOTE = (
    "부담이 큰지의 기준(%d분 이상, 연락 %d회 이상)은 연구자 가정이며 본인이 정한 값이 아니다."
    % (HEAVY_TASK_MINUTES, REPEATED_CONTACT_COUNT)
)


class ReviewAdapterError(RuntimeError):
    """The adapter could not produce a usable review.

    A model outage lands here. It is never written down as an actor having no
    opinion: ``unknown`` means the actor had no grounds, and that is a different
    fact from "we could not ask".
    """


class ReviewAdapter(Protocol):
    name: str

    def review(self, experience: ActorExperience, *, session_id: str | None,
               generation_index: int | None, created_at: str,
               review_id: str) -> AgentReview: ...


def _evidence_for(experience: ActorExperience, field_name: str,
                  kinds: tuple[str, ...] = ("unknown",)) -> list[str]:
    """Ids of this actor's own cards about one persona field."""
    return [c["id"] for c in experience.evidence
            if c.get("field") == field_name and c.get("kind") in kinds]


def _first_ids(events: list[dict[str, Any]], limit: int = 4) -> list[str]:
    return [e["id"] for e in events[:limit]]


class RuleReviewAdapter:
    """Deterministic, event-grounded, and allowed to say the cycle went badly."""

    name = "rule"

    def review(self, experience: ActorExperience, *, session_id: str | None,
               generation_index: int | None, created_at: str,
               review_id: str) -> AgentReview:
        if experience.actor_id == HEALTH_STAFF:
            items, narrative, unknowns = self._institution(experience)
        else:
            items, narrative, unknowns = self._resident(experience)

        used_events = sorted({ref for item in items for ref in item.eventRefs})
        used_evidence = sorted({ref for item in items for ref in item.evidenceRefs})
        return AgentReview(
            id=review_id,
            sessionId=session_id,
            generationIndex=generation_index,
            attemptId=experience.attempt_id,
            actorId=experience.actor_id,
            actorRole=experience.role,  # type: ignore[arg-type]
            policyRevisionId=experience.policy_revision_id,
            adapter="rule",
            usageStatus=experience.usage_status,
            experiencedEventIds=used_events,
            evidenceRefs=used_evidence,
            items=items,
            overallNarrative=narrative,
            unknowns=unknowns,
            promptVersion=REVIEW_CONTRACT_VERSION,
            createdAt=created_at,
        )

    # -- residents ---------------------------------------------------------
    def _resident(self, x: ActorExperience) -> tuple[list[ReviewItem], str, list[str]]:
        unknowns = ["실제 본인 평가", "실제 감정 반응"]
        if x.usage_status is UsageStatus.no_experience:
            return ([
                ReviewItem(dimension=d, assessment="unknown",
                           reason="이번 Cycle에서 이 서비스와 관련된 일이 나에게 일어나지 않았다.")
                for d in D
            ], "이번 Cycle에서 겪은 일이 없다. 평가할 근거가 없다.",
                unknowns + ["미경험"])

        items = [
            self._help(x),
            self._time(x),
            self._choice(x),
            self._disclosure(x),
            self._understandability(x),
            self._reuse(x),
        ]
        graded = [i for i in items if i.assessment != "unknown"]
        if not graded:
            narrative = "관련된 일이 있었지만 평가를 뒷받침할 내 경험이 부족하다."
        else:
            negative = [i for i in graded if i.assessment == "negative"]
            positive = [i for i in graded if i.assessment == "positive"]
            if negative and positive:
                narrative = ("도움이 된 부분과 부담이 된 부분이 같이 있었다: %s"
                             % "; ".join(i.reason for i in (positive[:1] + negative[:1])))
            elif negative:
                narrative = "이번에는 부담 쪽이 컸다: %s" % negative[0].reason
            else:
                narrative = "이번에는 도움이 되었다: %s" % positive[0].reason
        return items, narrative, unknowns

    def _help(self, x: ActorExperience) -> ReviewItem:
        me = x.actor_id
        resolved = [e for e in x.of_type("need.resolved")
                    if e["payload"].get("subjectId") == me]
        unresolved = [e for e in x.of_type("need.unresolved")
                      if e["payload"].get("subjectId") == me]
        helped = [e for e in x.of_type("task.completed", "transport.dropoff")
                  if e["actorId"] == me or e["payload"].get("driverId") == me]
        declined = [e for e in x.of_type("request.declined") if e["actorId"] == me]
        handoff = [e for e in x.of_type("handoff.requested")]

        if resolved:
            return ReviewItem(
                dimension=D.help_resolution, assessment="positive",
                reason="내가 필요했던 일이 마무리되는 것을 확인했다.",
                eventRefs=_first_ids(resolved))
        if unresolved:
            return ReviewItem(
                dimension=D.help_resolution, assessment="negative",
                reason="내 일이 끝나지 않은 채로 남았다: %s"
                       % reason_ko(unresolved[0]["payload"].get("reason"),
                                   "이유가 기록되지 않았다"),
                eventRefs=_first_ids(unresolved),
                requestedChange="끝나지 않을 때 누가 이어받는지 정해져 있으면 좋겠다.")
        if helped:
            return ReviewItem(
                dimension=D.help_resolution, assessment="positive",
                reason="부탁받은 일을 실제로 해 줄 수 있었다.",
                eventRefs=_first_ids(helped))
        if declined:
            return ReviewItem(
                dimension=D.help_resolution, assessment="mixed",
                reason="부탁을 받았지만 이번에는 하지 못했다 (%s)."
                       % reason_ko(declined[0]["payload"].get("reason")),
                eventRefs=_first_ids(declined))
        if handoff:
            return ReviewItem(
                dimension=D.help_resolution, assessment="mixed",
                reason="다음에 볼 사람은 정해졌지만 이 시점에서 끝나지는 않았다.",
                eventRefs=_first_ids(handoff))
        return ReviewItem(
            dimension=D.help_resolution, assessment="unknown",
            reason="내가 겪은 일만으로는 결말을 알 수 없다.")

    def _time(self, x: ActorExperience) -> ReviewItem:
        minutes = float(x.burden.get("addedTaskMinutes") or 0)
        contacts = int(x.burden.get("contactsReceived") or 0)
        my_task_events = [e for e in x.of_type(
            "task.travel_started", "task.started", "task.travel_arrived",
            "plan.modified") if e["actorId"] == x.actor_id]
        contact_events = [e for e in x.of_type("contact.attempted")
                          if e["payload"].get("toActorId") == x.actor_id]

        if minutes > 0 and my_task_events:
            heavy = minutes >= HEAVY_TASK_MINUTES
            return ReviewItem(
                dimension=D.time_labour,
                assessment="negative" if heavy else "mixed",
                reason=("하던 일을 멈추고 %.0f분을 썼다. %s"
                        % (minutes,
                           "짧지 않은 시간이다." if heavy else "감당은 했지만 시간이 들었다.")),
                eventRefs=_first_ids(my_task_events),
                requestedChange=("한 사람에게 몰리지 않게 다른 사람과 번갈아 갔으면 한다."
                                 if heavy else None))
        if contacts >= REPEATED_CONTACT_COUNT and contact_events:
            return ReviewItem(
                dimension=D.time_labour, assessment="mixed",
                reason="하루에 %d번 연락을 받았다." % contacts,
                eventRefs=_first_ids(contact_events),
                requestedChange="연락 사이 간격이 더 길었으면 한다.")
        if contact_events:
            return ReviewItem(
                dimension=D.time_labour, assessment="positive",
                reason="연락 한 번으로 끝났고 내 일과를 크게 방해하지 않았다.",
                eventRefs=_first_ids(contact_events))
        return ReviewItem(
            dimension=D.time_labour, assessment="unknown",
            reason="이번에 내 시간을 쓴 기록이 없다.")

    def _choice(self, x: ActorExperience) -> ReviewItem:
        me = x.actor_id
        offers = [e for e in x.of_type("request.offered")
                  if e["payload"].get("toActorId") == me]
        declined = [e for e in x.of_type("request.declined", "request.deferred")
                    if e["actorId"] == me]
        booked_for_me = [e for e in x.of_type("transport.reservation_made")
                         if e["payload"].get("riderId") == me]

        if declined:
            return ReviewItem(
                dimension=D.choice_refusal, assessment="positive",
                reason="거절하거나 미룰 수 있었고 그대로 받아들여졌다.",
                eventRefs=_first_ids(declined + offers))
        if offers:
            return ReviewItem(
                dimension=D.choice_refusal, assessment="positive",
                reason="할지 말지 물어보고 나서 정해졌다.",
                eventRefs=_first_ids(offers))
        if booked_for_me and not offers:
            # The seat was arranged around this person without an offer event
            # addressed to them. That is a fact about the log, not an inference
            # about how they felt about it.
            return ReviewItem(
                dimension=D.choice_refusal, assessment="mixed",
                reason="내 자리가 잡히는 과정에서 나에게 물어본 기록이 없다.",
                eventRefs=_first_ids(booked_for_me),
                requestedChange="누구 차를 타는지는 내가 정하고 싶다.")
        return ReviewItem(
            dimension=D.choice_refusal, assessment="unknown",
            reason="고르거나 거절할 상황 자체가 없었다.")

    def _disclosure(self, x: ActorExperience) -> ReviewItem:
        me = x.actor_id
        about_me = [row for row in x.policy_information_received
                    if (row["disclosure"] or {}).get("subjectId") == me
                    and (row["disclosure"] or {}).get("fields")]
        to_me_about_others = [row for row in x.policy_information_received
                              if (row["disclosure"] or {}).get("subjectId") != me]
        cards = _evidence_for(x, "acceptanceConditions") + _evidence_for(x, "declineConditions")

        if about_me:
            fields = sorted({f for row in about_me
                             for f in (row["disclosure"] or {}).get("fields", [])})
            recipients = sorted({(row["disclosure"] or {}).get("recipientClass") or "unknown"
                                 for row in about_me})
            third_party = [r for r in recipients if r != "subject"]
            # That it *happened* is an observed fact and the consent behind it is
            # recorded as assumed, never verified. So this is an open question for
            # the design - graded ``mixed`` - while whether the person minded stays
            # unanswerable. No preference is invented on their behalf.
            return ReviewItem(
                dimension=D.disclosure,
                assessment="mixed" if third_party else "unknown",
                reason=("내 이야기로 %s이(가) %s에 전달됐다. 그렇게 하기로 동의한 기록은 "
                        "없고 연구자 가정으로 두었다. 내가 이것을 원했는지는 내가 직접 "
                        "답해야 알 수 있다."
                        % (", ".join(fields), ", ".join(third_party))
                        if third_party else
                        "내 이야기가 나에게만 전달됐다. 더 판단할 근거가 없다."),
                eventRefs=[row["eventId"] for row in about_me][:4],
                evidenceRefs=cards[:2])
        if to_me_about_others:
            return ReviewItem(
                dimension=D.disclosure, assessment="unknown",
                reason="다른 사람 사정을 %d건 전해 들었다. 알고 싶었는지는 답할 근거가 없다."
                       % len(to_me_about_others),
                eventRefs=[row["eventId"] for row in to_me_about_others][:4])
        return ReviewItem(
            dimension=D.disclosure, assessment="unknown",
            reason="내 정보가 어디로 갔는지 알 수 있는 일이 없었다.")

    def _understandability(self, x: ActorExperience) -> ReviewItem:
        me = x.actor_id
        told = [e for e in x.of_type("contact.attempted", "request.offered")
                if e["payload"].get("toActorId") == me]
        happened_to_me = [e for e in x.of_type(
            "task.check_performed", "transport.pickup", "transport.reservation_made")
            if e["payload"].get("subjectId") == me or e["payload"].get("riderId") == me]

        if told and happened_to_me:
            return ReviewItem(
                dimension=D.understandability, assessment="positive",
                reason="먼저 연락을 받고 나서 일이 진행돼 무슨 일인지 알 수 있었다.",
                eventRefs=_first_ids(told + happened_to_me))
        if happened_to_me and not told:
            return ReviewItem(
                dimension=D.understandability, assessment="negative",
                reason="나에게 설명이 온 기록 없이 일이 진행됐다.",
                eventRefs=_first_ids(happened_to_me),
                requestedChange="시작하기 전에 무엇을 왜 하는지 알려 줬으면 한다.")
        if told:
            return ReviewItem(
                dimension=D.understandability, assessment="mixed",
                reason="연락은 받았지만 그 뒤에 어떻게 됐는지는 나에게 오지 않았다.",
                eventRefs=_first_ids(told),
                requestedChange="어떻게 마무리됐는지 한 번만 알려 줬으면 한다.")
        return ReviewItem(
            dimension=D.understandability, assessment="unknown",
            reason="설명이 필요한 상황이 없었다.")

    def _reuse(self, x: ActorExperience) -> ReviewItem:
        cards = _evidence_for(x, "acceptanceConditions") or _evidence_for(x, "declineConditions")
        conditions = list(x.persona.get("acceptanceConditions") or [])
        me = x.actor_id
        my_events = [e for e in x.events
                     if e["actorId"] == me or e["payload"].get("toActorId") == me
                     or e["payload"].get("subjectId") == me]

        if conditions and my_events:
            return ReviewItem(
                dimension=D.reuse_condition, assessment="mixed",
                reason="다음에도 이용하려면 내가 말했던 조건이 지켜져야 한다: %s"
                       % "; ".join(conditions[:2]),
                eventRefs=_first_ids(my_events),
                evidenceRefs=cards[:2],
                requestedChange=conditions[0])
        if cards:
            return ReviewItem(
                dimension=D.reuse_condition, assessment="unknown",
                reason="다음에 어떤 조건이면 이용할지는 원자료에 없어 답할 근거가 없다.",
                evidenceRefs=cards[:2])
        return ReviewItem(
            dimension=D.reuse_condition, assessment="unknown",
            reason="다시 이용할지에 대해 말할 근거가 없다.")

    # -- institution -------------------------------------------------------
    def _institution(self, x: ActorExperience) -> tuple[list[ReviewItem], str, list[str]]:
        """The desk reviews its own queue.

        The staff minutes are the desk's *own* book, not an aggregate over the
        residents, so using them here does not import a researcher metric into
        somebody's personal review.
        """
        unknowns = ["실제 담당자 평가", "실제 인력 상황"]
        handoffs = x.of_type("handoff.requested", "handoff.accepted")
        queued = x.of_type("institution.queued")
        completed = x.of_type("institution.review_completed")
        visits = [e for e in x.of_type("task.check_performed")
                  if e["actorId"] == HEALTH_STAFF]

        if not x.events:
            return ([ReviewItem(dimension=d, assessment="unknown",
                                reason="이번 Cycle에 우리 쪽으로 넘어온 건이 없다.")
                     for d in D],
                    "접수된 건이 없다.", unknowns + ["미경험"])

        items: list[ReviewItem] = []
        if completed:
            outcomes = sorted({e["payload"].get("outcome") or "unknown" for e in completed})
            items.append(ReviewItem(
                dimension=D.help_resolution, assessment="mixed",
                reason="접수된 건을 처리했다 (%s). 처리했다는 것이 건강 문제가 없다는 뜻은 아니다."
                       % ", ".join(outcomes),
                eventRefs=_first_ids(completed)))
        elif queued:
            items.append(ReviewItem(
                dimension=D.help_resolution, assessment="negative",
                reason="대기열에만 올라가고 이번 근무 안에 처리되지 않았다.",
                eventRefs=_first_ids(queued),
                requestedChange="근무시간 안에 못 볼 건은 넘기기 전에 알려 줬으면 한다."))
        else:
            items.append(ReviewItem(
                dimension=D.help_resolution, assessment="unknown",
                reason="처리 결과를 판단할 우리 쪽 기록이 없다."))

        depth = max((int(e["payload"].get("queueDepth") or 0) for e in queued), default=0)
        if visits:
            items.append(ReviewItem(
                dimension=D.time_labour, assessment="negative",
                reason="방문이 발생해 왕복 이동과 체류 시간이 그대로 우리 인력에서 나갔다.",
                eventRefs=_first_ids(visits),
                requestedChange="방문 전에 전화로 확인할 수 있으면 이동을 줄일 수 있다."))
        elif depth >= 2:
            items.append(ReviewItem(
                dimension=D.time_labour, assessment="mixed",
                reason="대기 %d건을 안고 처리했다." % depth,
                eventRefs=_first_ids(queued)))
        elif handoffs:
            items.append(ReviewItem(
                dimension=D.time_labour, assessment="mixed",
                reason="인계받은 건만큼 우리 시간이 들어갔다.",
                eventRefs=_first_ids(handoffs)))
        else:
            items.append(ReviewItem(
                dimension=D.time_labour, assessment="unknown",
                reason="이번에 우리 시간을 쓴 기록이 없다."))

        items.append(ReviewItem(
            dimension=D.choice_refusal,
            assessment="mixed" if handoffs else "unknown",
            reason=("인계를 받을지 말지는 근무시간과 대기열로만 정해졌다."
                    if handoffs else "받을지 고를 상황이 없었다."),
            eventRefs=_first_ids(handoffs)))

        disclosed = [e for e in handoffs if e["payload"].get("disclosure")]
        if disclosed:
            fields = sorted({f for e in disclosed
                             for f in (e["payload"].get("disclosure") or {}).get("fields", [])})
            items.append(ReviewItem(
                dimension=D.disclosure,
                assessment="mixed" if fields else "negative",
                reason=("넘겨받은 정보는 %s였다." % ", ".join(fields)) if fields
                       else "응답이 없었다는 사실만 넘어와 판단할 근거가 부족했다.",
                eventRefs=_first_ids(disclosed),
                requestedChange=None if fields else "판단에 필요한 최소 정보는 함께 왔으면 한다."))
        else:
            items.append(ReviewItem(
                dimension=D.disclosure, assessment="unknown",
                reason="이번에 넘어온 정보가 없다."))

        items.append(ReviewItem(
            dimension=D.understandability,
            assessment="mixed" if handoffs else "unknown",
            reason=("무엇을 요청받았는지는 왔지만 그 전에 무슨 일이 있었는지는 오지 않았다."
                    if handoffs else "설명이 필요한 건이 없었다."),
            eventRefs=_first_ids(handoffs)))
        items.append(ReviewItem(
            dimension=D.reuse_condition,
            assessment="mixed" if handoffs else "unknown",
            reason=("근무시간 안에 처리 가능한 양으로 들어오면 계속 받을 수 있다."
                    if handoffs else "다음 조건을 말할 근거가 없다."),
            eventRefs=_first_ids(handoffs),
            requestedChange="근무 종료 직전 인계는 피했으면 한다." if handoffs else None))

        graded = [i for i in items if i.assessment != "unknown"]
        narrative = ("이번 Cycle에 우리 쪽으로 온 일: %s"
                     % "; ".join(i.reason for i in graded[:2])) if graded else \
                    "판단할 우리 쪽 기록이 부족하다."
        return items, narrative, unknowns


class ScriptedReviewAdapter:
    """Fixed reviews supplied by a test or a demo.

    Explicitly labelled ``scripted`` everywhere it appears, and validated exactly
    like the others so a script cannot smuggle in a citation the actor never had.
    It exists to exercise the loop, never to stand in for a model that failed.
    """

    name = "scripted"

    def __init__(self, script: dict[str, dict[str, Any]]) -> None:
        self.script = script

    def review(self, experience: ActorExperience, *, session_id: str | None,
               generation_index: int | None, created_at: str,
               review_id: str) -> AgentReview:
        body = self.script.get(experience.actor_id)
        if body is None:
            return RuleReviewAdapter().review(
                experience, session_id=session_id, generation_index=generation_index,
                created_at=created_at, review_id=review_id).model_copy(
                    update={"adapter": "scripted"})
        payload = dict(body)
        payload.update({
            "id": review_id, "sessionId": session_id,
            "generationIndex": generation_index,
            "attemptId": experience.attempt_id, "actorId": experience.actor_id,
            "actorRole": experience.role,
            "policyRevisionId": experience.policy_revision_id,
            "adapter": "scripted", "createdAt": created_at,
        })
        payload.setdefault("usageStatus", experience.usage_status.value)
        return AgentReview.model_validate(payload)
