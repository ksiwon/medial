"""Rule adapters: an explicit, inspectable baseline.

Every rule below is a stated assumption, not a finding. Where the source
material supports a rule the provenance says ``source-adapted``; everywhere else
it says ``researcher-assumption`` and the reason travels with the proposal so a
reviewer can disagree with it.

Deliberately absent: any probability of acceptance, any trust score, any
conversion of a decline into a relationship penalty.

Also deliberately absent: whether a phone is answered in a given place. That is
a fact about the world, not about this person, and it lives in
``EnvironmentRevision`` so that swapping this adapter for a model cannot make a
phone start ringing in a field. The same goes for who this person could hand
work to: that is ``RelationRevision``, and the adapter only ever chooses among
the neighbours the engine already put in the view.
"""
from __future__ import annotations

from typing import Any, Sequence

from ..contracts import ActionProposal, ProposalAction
from ..observations import ActorView
from .base import ProposalFactory


class RuleResidentAdapter:
    """A resident deciding what to do with a request addressed to them."""

    name = "rule-resident"

    def __init__(self, factory: ProposalFactory) -> None:
        self.factory = factory

    def propose(self, view: ActorView,
                allowed: Sequence[ProposalAction]) -> list[ActionProposal]:
        ride = view.latest("ride.offered")
        if ride is not None and (offer := view.latest("request.offered")) is not None \
                and offer.simTimeMs > ride.simTimeMs:
            ride = None
        if ride is not None:
            return self._on_ride_offer(view, ride, allowed)

        offer = view.latest("request.offered") or view.latest("request.relayed")
        if offer is None or ProposalAction.accept not in allowed:
            return []

        request_id = offer.payload.get("requestId")
        cap = int(view.policy.get("helperContactCap", 2))

        if view.contacts_received_today > cap:
            return [self.factory.make(
                view.actor_id, view.sim_time_ms, ProposalAction.decline,
                requestId=request_id,
                params={"reason": "contact_cap_reached",
                        "provenance": "researcher-assumption"},
                utterance="오늘은 이미 여러 번 불려서 어렵겠는데요.",
                observationIds=[offer.id],
                uncertainty="상한값은 연구자 설정이며 실제 수용 한계가 아니다",
            )]

        if not view.own_interruptible:
            # Being tied up is where the interviews show work moving sideways
            # rather than stopping: P3 was already on his own errand and took
            # the medicine along anyway. So before deferring, ask whether there
            # is somebody this person actually deals with.
            handed = self._hand_it_on(view, offer, request_id, allowed)
            if handed:
                return handed
            return [self.factory.make(
                view.actor_id, view.sim_time_ms, ProposalAction.defer,
                requestId=request_id,
                params={"reason": "activity_locked",
                        "activity": view.own_activity,
                        "provenance": "researcher-assumption"},
                utterance="지금은 일 중이라 바로는 못 갑니다.",
                observationIds=[offer.id],
            )]

        return [self.factory.make(
            view.actor_id, view.sim_time_ms, ProposalAction.accept,
            requestId=request_id,
            params={"basis": "interruptible_activity", "activity": view.own_activity},
            utterance="지금 순찰 중이니 들러 보겠습니다."
            if view.own_place == "PATROL" else "가 보겠습니다.",
            observationIds=[offer.id],
        )]

    def _hand_it_on(self, view: ActorView, offer, request_id: str | None,
                    allowed: Sequence[ProposalAction]) -> list[ActionProposal]:
        """Pass the request to a neighbour, preferring whoever is standing here.

        Two rules, and both are about not inventing anything. The candidate must
        be one of this person's recorded relations - the engine hands them over
        in the view and refuses anything else - and being in the same place wins,
        because that is how it happened in the source: the four of them were
        already at lunch together when the afternoon got arranged.

        Nothing here models willingness, closeness or obligation. There is no
        trust score in this simulator and this does not add one.
        """
        if ProposalAction.relay not in allowed:
            return []
        candidates = [r for r in view.relations if r.get("actorId")]
        if not candidates:
            return []
        here = [r for r in candidates if r["actorId"] in view.nearby]
        chosen = (here or candidates)[0]
        basis = "copresent" if here else "recorded_relation"
        return [self.factory.make(
            view.actor_id, view.sim_time_ms, ProposalAction.relay,
            requestId=request_id,
            targetActorId=chosen["actorId"],
            params={"targetActorId": chosen["actorId"], "basis": basis,
                    "relationKind": chosen.get("kind"),
                    "activity": view.own_activity,
                    "provenance": "researcher-assumption"},
            utterance=("지금 같이 있으니 내가 말해 두겠습니다."
                       if here else "내가 못 가니 아는 사람한테 부탁해 보겠습니다."),
            observationIds=[offer.id],
            uncertainty=("누구에게 넘길지 고르는 방식은 연구자 설정이다. "
                         "원자료는 이장이 한 번 넘긴 장면까지만 기록한다."),
        )]

    # -- T004: someone asks for a lift ------------------------------------
    def _on_ride_offer(self, view: ActorView, offer,
                       allowed: Sequence[ProposalAction]) -> list[ActionProposal]:
        """Answer a ride request out of this person's own compiled persona.

        Three things are deliberately *not* assumed: that an unknown driving
        status means "can drive", that a car has a free seat, and that a
        relative's request overrides a long detour. Each of those is either read
        from an evidence card or declined with the unknown named.
        """
        request_id = offer.payload.get("requestId")
        persona = view.persona or {}
        cards = persona.get("evidence") or []
        drives = persona.get("drivesSelf")
        refs = [c["id"] for c in cards if c.get("field") == "drivesSelf"]

        def make(action: ProposalAction, reason: str, utterance: str,
                 extra: dict[str, Any] | None = None,
                 evidence: list[str] | None = None) -> list[ActionProposal]:
            if action not in allowed:
                return []
            return [self.factory.make(
                view.actor_id, view.sim_time_ms, action, requestId=request_id,
                params={"reason": reason, **(extra or {})},
                utterance=utterance, observationIds=[offer.id],
                evidenceRefs=evidence or refs,
                uncertainty=persona.get("unknowns") and
                "; ".join(persona["unknowns"][:3]) or None)]

        if drives is False:
            return make(ProposalAction.decline, "does_not_drive",
                        "저는 운전을 안 합니다.")
        if drives is None:
            return make(ProposalAction.decline, "driving_status_unknown",
                        "제가 태워 드릴 형편인지 확실치 않습니다.",
                        extra={"provenance": "persona-unknown"})

        if not offer.payload.get("feasible", True):
            return make(ProposalAction.decline, "no_route",
                        "그 길로는 갈 수가 없습니다.")

        locked = [c for c in persona.get("declineConditions", [])]
        if locked and not view.own_interruptible:
            return make(ProposalAction.decline, "cannot_leave_post",
                        "가게를 비울 수가 없어서요.",
                        extra={"conditions": locked},
                        evidence=[c["id"] for c in cards
                                  if c.get("field") == "declineConditions"])

        detour = offer.payload.get("detourMin")
        cap = float(view.policy.get("maxRideDetourMin", 20))
        if detour is not None and float(detour) > cap:
            kin_rule = [c for c in persona.get("acceptanceConditions", [])
                        if "친척" in c]
            return make(
                ProposalAction.decline, "detour_too_long",
                "오늘은 그쪽까지 돌아갈 여유가 없습니다.",
                extra={"detourMin": detour, "capMin": cap,
                       "kinExceptionExists": bool(kin_rule),
                       "kinExceptionApplies": "unknown",
                       "note": ("이 사람에게는 '가까운 친척의 부탁이면 우회한다'는 조건이 "
                                "있으나 이 요청이 그 친척을 통해 온 것인지 확인되지 않았다."
                                if kin_rule else None)})

        return make(ProposalAction.accept, "detour_within_budget",
                    "가는 길이니 태워 드리겠습니다.",
                    extra={"detourMin": detour,
                           "conditions": ["출발 시각은 내 일정에 맞춘다"]})


class RuleVillageHeadAdapter(RuleResidentAdapter):
    """P6 is the same person as the resident P6, with one addition: local knowledge.

    He is not a subordinate executor. When a check turns up nobody, he offers
    where he thinks the person is - and that is *his* knowledge, which MEDial did
    not have and does not acquire except through this report.
    """

    name = "rule-village-head"

    def propose(self, view: ActorView,
                allowed: Sequence[ProposalAction]) -> list[ActionProposal]:
        absent = view.latest("task.check_performed")
        if absent is not None and absent.payload.get("outcome") == "subject_absent":
            guess = self._where_would_they_be(view, absent.subjectId)
            if guess is not None and ProposalAction.report_observation in allowed:
                return [self.factory.make(
                    view.actor_id, view.sim_time_ms, ProposalAction.report_observation,
                    requestId=absent.payload.get("requestId"),
                    params={"suggestedPlace": guess["place"],
                            "basis": guess["basis"],
                            "provenance": "actor-local-knowledge"},
                    utterance="이 시간이면 밭에 있을 겁니다. 가 보겠습니다.",
                    observationIds=[absent.id],
                    uncertainty="본인이 직접 본 것이 아니라 평소 일과에 근거한 추정",
                )]
        return super().propose(view, allowed)

    @staticmethod
    def _where_would_they_be(view: ActorView, subject_id: str | None) -> dict[str, Any] | None:
        for item in view.local_knowledge:
            if item.get("subjectId") == subject_id:
                return item
        return None


class RuleOrchestratorResidentAdapter(RuleResidentAdapter):
    """Residents who are the *subject* of a check simply answer or do not."""

    name = "rule-subject"


class RuleHealthStaffAdapter:
    """The health-centre worker: a queue, a shift, and a finite amount of time.

    Handing a case to the centre is a transfer of work, not a completion, so
    every step here consumes staff minutes that the metrics report separately.
    """

    name = "rule-health-staff"

    def __init__(self, factory: ProposalFactory) -> None:
        self.factory = factory

    def propose(self, view: ActorView,
                allowed: Sequence[ProposalAction]) -> list[ActionProposal]:
        handoff = view.latest("handoff.requested")
        if handoff is None:
            return []
        request_id = handoff.payload.get("requestId")
        shift_end = int(view.resources.get("shiftEndMs", 0))
        if view.sim_time_ms >= shift_end:
            return [self.factory.make(
                view.actor_id, view.sim_time_ms, ProposalAction.decline,
                requestId=request_id,
                params={"reason": "outside_shift", "provenance": "researcher-assumption"},
                observationIds=[handoff.id],
            )]
        return [self.factory.make(
            view.actor_id, view.sim_time_ms, ProposalAction.accept,
            requestId=request_id,
            params={"reason": "queued_for_review"},
            observationIds=[handoff.id],
        )]
