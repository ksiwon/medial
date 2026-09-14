"""MEDial as a policy over observations.

MEDial is not the experiment runner. It reasons only from ``ActorView`` plus the
routine projection residents are assumed to have shared, and it emits *intents*
that the engine still has to validate. It cannot read positions, cannot force an
acceptance, and cannot mark a case closed because it sent a message.

What a missed check-in means
----------------------------
It means the check-in was not answered. It does not mean the resident is out, and
it does not mean they are in trouble. Both the location and the clinical state
stay ``unconfirmed`` until something establishes them. The engine separately
knows this deck contains no deterioration signal - that is a fact about the
*world*, not evidence MEDial holds - so MEDial reports "no emergency evidence was
observed", never "emergency ruled out".

Every field of ``PolicyParams`` is read here. A condition the screen offers but
the policy ignores would make a researcher conclude it did not matter.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..contracts import (
    HEALTH_STAFF,
    Candidate,
    Channel,
    ContactStrategy,
    DecisionRecord,
    PolicyRevision,
)
from ..observations import routine_says_home

MIN_MS = 60_000

#: Attached to every classification event so the boundary is visible in the log.
UNCONFIRMED_RATIONALE = (
    "문진에 응답이 없었다는 것만 확인되었다. 이것으로는 어디에 있는지도, 몸 상태가 어떤지도 "
    "알 수 없다. 둘 다 미확인으로 두고 확인 절차를 시작한다."
)

#: Said out loud in the log because the absence of emergency evidence is not the
#: same claim as an emergency having been ruled out.
NO_EMERGENCY_EVIDENCE_NOTE = (
    "응급을 시사하는 관측이 들어온 것이 없다. 이는 '응급이 아니라고 판정했다'는 뜻이 아니라 "
    "'판정할 근거가 없다'는 뜻이다."
)

CLASSIFICATION = "unconfirmed_wellbeing"

#: The places local knowledge can name (engine ``_local_knowledge``), in the
#: words a decision's rationale is read in. The key stays on the event payload.
PLACE_WORDS = {"FARM": "밭", "PORT": "항구", "SEA": "바다"}


@dataclass
class Intent:
    kind: str
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class PolicyContext:
    sim_time_ms: int
    subject_id: str
    request_id: str
    attempt_number: int
    #: Per-subject routine projection MEDial holds. ``home_or_away`` granularity.
    routines: dict[str, dict[str, Any]]
    village_head_id: str
    horizon_ms: int
    raised_ms: int = 0
    last_contact_ms: int = 0
    observation_ids: list[str] = field(default_factory=list)
    known_facts: list[str] = field(default_factory=list)
    #: The subject's recorded relations, as MEDial holds them: who they have a
    #: recorded tie with and what the record says. Assumed registered as the
    #: subject's close contacts (``assumption-registered-contacts``).
    relations: list[dict[str, Any]] = field(default_factory=list)


class MedialPolicy:
    def __init__(self, revision: PolicyRevision, village_head_id: str = "P6") -> None:
        self.revision = revision
        self.village_head_id = village_head_id
        self._decisions = 0

    # -- classification ------------------------------------------------
    def classify(self, ctx: PolicyContext) -> dict[str, Any]:
        return {
            "classification": CLASSIFICATION,
            "rationale": UNCONFIRMED_RATIONALE,
            # Both of these stay unconfirmed. Neither is a clinical judgement.
            "clinicalStatus": "unconfirmed",
            "locationStatus": "unconfirmed",
            # An empty list is the honest answer: no emergency-suggesting
            # observation arrived. It is not a rule-out.
            "emergencyEvidence": [],
            "emergencyEvidenceNote": NO_EMERGENCY_EVIDENCE_NOTE,
            "subjectId": ctx.subject_id,
            "knownFacts": ctx.known_facts,
        }

    # -- candidate filtering -------------------------------------------
    def candidates(self, ctx: PolicyContext) -> list[Candidate]:
        """Filter on the shared routine only.

        The routine MEDial holds answers one question - is this person usually at
        home right now - and deliberately not "where are they instead". So a
        person who is out is excluded without MEDial learning the place, and
        everything MEDial has not been told (who drives, who can climb the hill)
        stays ``확인 필요`` instead of being invented.
        """
        rows: list[Candidate] = []
        for actor_id, routine in sorted(ctx.routines.items()):
            if actor_id == ctx.subject_id:
                rows.append(Candidate(actorId=actor_id, included=False,
                                      reason="확인 대상 본인"))
                continue
            at_home = routine_says_home(routine, ctx.sim_time_ms)
            if actor_id == self.village_head_id:
                rows.append(Candidate(
                    actorId=actor_id, included=True,
                    reason=("이장 역할로 등록되어 있어 일과와 무관하게 후보로 남긴다. "
                            "실제로 갈 수 있는지는 본인 응답으로만 알 수 있다")))
            elif at_home is True:
                rows.append(Candidate(
                    actorId=actor_id, included=True,
                    reason=("공개된 평소 일과상 이 시각 자택에 있다고 되어 있다. "
                            "이동 수단·접근 가능 여부는 확인 필요(unknown)")))
            elif at_home is False:
                rows.append(Candidate(
                    actorId=actor_id, included=False,
                    reason="공개된 평소 일과상 이 시각 외출 중이다. 어디인지는 MEDial에 공개되지 않는다"))
            else:
                rows.append(Candidate(
                    actorId=actor_id, included=False,
                    reason="이 시각에 대한 공개 일과가 없다(unknown)"))
        return rows

    # -- the decision at the missed check-in ----------------------------
    def on_unanswered_checkin(self, ctx: PolicyContext) -> tuple[DecisionRecord, list[Intent]]:
        params = self.revision.params
        candidates = self.candidates(ctx)

        escalate = self._escalation_due(ctx)
        if escalate is not None:
            return (self._decision(
                ctx,
                question="응답이 없는 상태를 누가 어떻게 확인할 것인가",
                candidates=candidates + [Candidate(
                    actorId=HEALTH_STAFF, included=True,
                    reason="escalateToInstitutionAfterMin 경과")],
                chosen=HEALTH_STAFF,
                rationale=escalate,
            ), [self._handoff_intent(ctx)])

        retry = self._retry_due(ctx)
        if retry is not None:
            return retry

        if self.revision.contactStrategy == ContactStrategy.neighbour_first:
            available = [c for c in candidates
                         if c.included and c.actorId != self.village_head_id]
            if not available:
                # Everybody the shared routine places at home is already spoken
                # for, or there is nobody. Falling back to the head is not a
                # workaround: it is what this village does when no one else is in.
                available = [c for c in candidates if c.included]
            if not available:
                return (self._decision(
                    ctx,
                    question="응답이 없는 상태를 누가 어떻게 확인할 것인가",
                    candidates=candidates, chosen=None,
                    rationale="공개된 일과상 지금 부탁할 수 있는 사람이 없다.",
                ), [])
            order = [c.actorId for c in available][:params.neighbourAskLimit]
            chosen = order[0]
            rationale = ("이장 한 사람에게 몰지 않고, 공개된 일과상 이 시각 자택에 있는 "
                         "사람에게 먼저 부탁한다. 거절하면 다음 사람에게 묻되 %d명까지만 "
                         "묻는다. 실제로 갈 수 있는지는 본인 응답으로만 알 수 있다."
                         % params.neighbourAskLimit)
            intents = [Intent("offer_request", {
                "toActorId": chosen,
                # The rest of the order travels with the intent so that a refusal
                # moves on instead of ending the day. Asking four people is not a
                # free fallback: it is four people's afternoons, and the metrics
                # count it.
                "fallbackOrder": order[1:],
                "requestId": ctx.request_id,
                "purpose": "welfare_check",
                "disclosure": self.disclosure_to("neighbour", ctx),
            })]
        elif self.revision.contactStrategy == ContactStrategy.head_first:
            if not params.allowHeadContact:
                raise ValueError("head_first policy with allowHeadContact disabled")
            chosen = self.village_head_id
            rationale = ("이장은 이 마을에서 안부 확인을 실제로 해 온 사람이고, 확인만 요청하고 "
                         "판단은 넘기지 않는다. 공개 일과로는 지금 갈 수 있는지 알 수 없으므로 "
                         "요청을 보내고 본인의 응답을 기다린다.")
            intents = [Intent("offer_request", {
                "toActorId": chosen,
                "requestId": ctx.request_id,
                "purpose": "welfare_check",
                "disclosure": self.disclosure_to("neighbour", ctx),
            })]
        elif self.revision.contactStrategy == ContactStrategy.relation_first:
            candidates = self._mark_relations(ctx, candidates)
            order = self._relation_order(ctx, candidates)
            if not order:
                return (self._decision(
                    ctx,
                    question="응답이 없는 상태를 누가 어떻게 확인할 것인가",
                    candidates=candidates, chosen=None,
                    rationale=("기록된 가까운 관계 중 지금 부탁할 수 있는 사람이 없고, "
                               "이장에게도 부탁할 수 없다."),
                ), [])
            chosen = order[0]
            rationale = self._relation_rationale(ctx, candidates, order)
            intents = [Intent("offer_request", {
                "toActorId": chosen,
                "fallbackOrder": order[1:],
                "requestId": ctx.request_id,
                "purpose": "welfare_check",
                "disclosure": self.disclosure_to("neighbour", ctx),
            })]
        else:
            # retry_then_clinic with the retries spent. The engine routes that
            # to ``on_retry_exhausted`` before asking here; reaching this line
            # means the routing and the policy disagree, which is a bug.
            raise ValueError("retry_then_clinic reached on_unanswered_checkin "
                             "with no retries left")

        return (self._decision(
            ctx,
            question="응답이 없는 상태를 누가 어떻게 확인할 것인가",
            candidates=candidates,
            chosen=chosen,
            rationale=rationale,
        ), intents)

    # -- after a retry also went unanswered ------------------------------
    def on_retry_exhausted(self, ctx: PolicyContext) -> tuple[DecisionRecord, list[Intent]]:
        params = self.revision.params
        candidates = [
            Candidate(actorId=ctx.subject_id, included=False,
                      reason="%d회 연락했으나 응답 없음. 위치와 상태는 여전히 미확인"
                             % ctx.attempt_number),
            Candidate(actorId=self.village_head_id, included=False,
                      reason="이 정책은 이웃 연락을 사용하지 않는다"),
            Candidate(actorId=HEALTH_STAFF, included=True,
                      reason="보건소 담당자에게 확인을 인계. 인계는 종결이 아니다"),
        ]
        return (self._decision(
            ctx,
            question="연락이 계속 닿지 않을 때 다음 담당자는 누구인가",
            candidates=candidates,
            chosen=HEALTH_STAFF,
            rationale=("재연락 예산(%d회)을 소진했다. 여기서 멈추면 미확인으로 남으므로 "
                       "기관에 넘기되, 넘겼다는 사실을 완료로 세지 않는다."
                       % params.retryCount),
        ), [self._handoff_intent(ctx)])

    # -- nobody home, and the person who went has no lead -------------------
    def on_absent_no_lead(self, ctx: PolicyContext, checker: str,
                          already_asked: list[str]) -> tuple[DecisionRecord, list[Intent]]:
        """Ask the person who knows this village's days where they would be.

        Until 2026-09-15 a neighbour finding the house empty ended the request,
        with the village head - who knows the subject's usual places - never
        asked. That is not a result of the neighbour-first order; it was a gap.
        The head is asked by phone, and only if this policy allows asking him
        and he has not already been asked on this request.
        """
        params = self.revision.params
        head = self.village_head_id
        question = "자택에 없고 짐작 가는 곳도 없을 때 누구에게 물을 것인가"
        if not params.allowHeadContact:
            reason = "이 정책은 이장에게 묻지 않는다"
        elif head == checker or head in already_asked:
            reason = "이장에게는 이미 이 건을 물었다"
        else:
            return (self._decision(
                ctx, question=question,
                candidates=[Candidate(
                    actorId=head, included=True,
                    reason=("마을 사람들의 평소 일과를 장소 단위로 아는 사람으로 등록되어 있다. "
                            "MEDial은 그 지식을 갖고 있지 않다"))],
                chosen=head,
                rationale=("%s는 자택에 없다는 것만 확인했고 어디 있을지 짐작할 근거가 없다. "
                           "없다는 것도 위치나 상태를 확정하지 않으므로, 평소 일과를 아는 이장에게 "
                           "어디 있을지 전화로 묻는다." % checker),
            ), [Intent("ask_whereabouts", {
                "toActorId": head,
                "requestId": ctx.request_id,
                "disclosure": self.disclosure_to("neighbour", ctx),
            })])
        return (self._decision(
            ctx, question=question,
            candidates=[Candidate(actorId=head, included=False, reason=reason)],
            chosen=None,
            rationale="자택에 없었고 어디 있을지 물을 사람이 없다: %s." % reason,
        ), [])

    # -- the head reports the subject was not at home ---------------------
    def on_absent_report(self, ctx: PolicyContext,
                         suggested_place: str, basis: str) -> tuple[DecisionRecord, list[Intent]]:
        candidates = [
            Candidate(actorId=self.village_head_id, included=True,
                      reason="이미 현장에 있고 본인이 확인처를 제안했다"),
        ]
        return (self._decision(
            ctx,
            question="자택에 없을 때 확인을 계속할 것인가",
            candidates=candidates,
            chosen=self.village_head_id,
            rationale=("자택에서 확인되지 않았다는 것도 위치와 상태 어느 쪽도 확정하지 않는다. "
                       "이장이 제안한 확인처(%s)는 MEDial이 갖고 있지 않던 지역 지식이며 "
                       "근거는 %s이다." % (PLACE_WORDS.get(suggested_place, suggested_place),
                                          basis)),
        ), [Intent("continue_check", {
            "requestId": ctx.request_id,
            "toActorId": self.village_head_id,
            "place": suggested_place,
        })])

    # -- T004: who is asked for a ride ------------------------------------
    def on_transport_need(self, ctx: PolicyContext, need: dict[str, Any],
                          already_asked: list[str],
                          known: dict[str, str] | None = None
                          ) -> tuple[DecisionRecord, list[Intent]]:
        """Order the people MEDial may ask for a ride, and ask the first one.

        What MEDial knows here is deliberately thin. It does **not** hold a
        register of who drives - the persona source does not establish that for
        most people and inventing it would decide the experiment. It holds two
        things: the names the person themself offered when raising the need, and
        the consented ``home_or_away`` routine, which says who is already out
        around that hour without saying where they are going.

        So every candidate carries ``운전 가능 여부 unknown`` and the only way to
        find out is to ask, which is what the coordination problem actually is.
        """
        order = self.revision.params.rideCandidateOrder
        preferred = [p for p in need.get("preferredHelpers", [])
                     if p != ctx.subject_id]
        known = known or {}
        rows: list[Candidate] = []
        ranked: list[tuple[tuple[int, int, int], str]] = []

        for actor_id, routine in sorted(ctx.routines.items()):
            if actor_id == ctx.subject_id:
                rows.append(Candidate(actorId=actor_id, included=False,
                                      reason="이동이 필요한 본인"))
                continue
            if actor_id in already_asked:
                rows.append(Candidate(actorId=actor_id, included=False,
                                      reason="이미 물어봤고 좌석을 얻지 못했다"))
                continue
            if known.get(actor_id) == "not_driving":
                # Told to MEDial by that person, in an earlier request. Asking
                # again would be the system not listening.
                rows.append(Candidate(
                    actorId=actor_id, included=False,
                    reason="앞선 요청에서 본인이 태워 줄 수 없다고 답했다"))
                continue
            out_already = routine_says_home(routine, int(need["departByMs"])) is False
            is_kin = actor_id in preferred
            told_us_they_drive = known.get(actor_id) == "drives"
            if order == "kin_first":
                rank = (0 if is_kin else 1, 0 if told_us_they_drive else 1,
                        0 if out_already else 1)
                why = ("본인이 먼저 이름을 댄 가까운 사람" if is_kin
                       else "본인이 이름을 대지는 않았다")
            else:
                rank = (0 if told_us_they_drive else 1, 0 if out_already else 1,
                        0 if is_kin else 1)
                why = ("공개된 평소 일과상 이 시각 이미 외출 중이라 경로가 겹칠 수 있다"
                       if out_already else "이 시각 자택에 있다고 되어 있다")
            if told_us_they_drive:
                why += ". 앞선 요청에서 본인이 태워 줄 수 있다고 답했다"
            rows.append(Candidate(
                actorId=actor_id, included=True,
                reason=why + (". 운전 가능 여부와 좌석은 MEDial이 알지 못한다(unknown)"
                              if not told_us_they_drive else
                              ". 지금 태울 수 있는지는 여전히 본인만 안다")))
            ranked.append((rank, actor_id))

        ranked.sort()
        chosen = ranked[0][1] if ranked else None
        rationale = (
            "%s 순서로 후보를 정렬했다. MEDial은 누가 운전하는지 원래 모르고 좌석 수는 "
            "원자료에 없다. 앞선 요청에서 본인이 직접 답해 준 것만 앞세우고, 나머지는 "
            "물어봐서 본인의 응답으로만 확정한다."
            % ("본인이 지목한 사람 우선" if order == "kin_first" else "동선이 겹칠 가능성 우선"))
        if chosen is None:
            return (self._decision(
                ctx, question="%s까지의 이동을 누구에게 부탁할 것인가" % need["destination"],
                candidates=rows, chosen=None,
                rationale=rationale + " 남은 후보가 없다."), [])
        return (self._decision(
            ctx, question="%s까지의 이동을 누구에게 부탁할 것인가" % need["destination"],
            candidates=rows, chosen=chosen, rationale=rationale,
        ), [Intent("offer_ride", {
            "toActorId": chosen,
            "requestId": ctx.request_id,
            "disclosure": self.disclosure_to("neighbour", ctx),
        })])

    # -- policy conditions the engine must honour --------------------------
    def _retry_due(self, ctx: PolicyContext) -> tuple[DecisionRecord, list[Intent]] | None:
        """Call the person again before asking anyone else, ``retryCount`` times.

        The first step of every contact order, not a feature of one strategy.
        Until 2026-09-15 only ``retry_then_clinic`` retried, so a Change Set
        setting ``retryCount`` on a head-first policy validated, was confirmed,
        and changed nothing - and the comparison read as "retrying made no
        difference". Done here, in code, for the model head too: a count the
        designer set is a procedure, not an option the head may skip.

        The retry goes by phone. The first check-in is the home device, and a
        second try on a device that only works at home tells nothing new.
        """
        params = self.revision.params
        if ctx.attempt_number > params.retryCount:
            return None
        at = self._next_contact_ms(ctx)
        return (self._decision(
            ctx,
            question="응답이 없는 상태를 누가 어떻게 확인할 것인가",
            candidates=[Candidate(actorId=ctx.subject_id, included=True,
                                  reason="다른 사람에게 부탁하기 전에 본인에게 다시 연락한다")],
            chosen=ctx.subject_id,
            rationale=("재연락 %d/%d회: 다른 사람의 시간을 쓰기 전에 %d분 뒤 본인에게 전화한다."
                       % (ctx.attempt_number, params.retryCount,
                          (at - ctx.sim_time_ms) // MIN_MS)),
        ), [Intent("schedule_contact", {
            "toActorId": ctx.subject_id,
            "atMs": at,
            "channel": Channel.phone.value,
            "purpose": "welfare_retry",
            "attemptNumber": ctx.attempt_number + 1,
            "disclosure": self.disclosure_to("subject", ctx),
        })])

    def _mark_relations(self, ctx: PolicyContext,
                        candidates: list[Candidate]) -> list[Candidate]:
        """Say on each candidate row whether a recorded relation ties them to
        the subject, so the decision log shows why the order is what it is."""
        ties = {r["actorId"]: r for r in ctx.relations}
        out = []
        for c in candidates:
            tie = ties.get(c.actorId)
            if tie is None or c.actorId == self.village_head_id:
                out.append(c)
                continue
            out.append(c.model_copy(update={
                "reason": "%s · 기록된 관계: %s" % (c.reason, tie.get("reason") or tie.get("kind"))}))
        return out

    def _relation_rationale(self, ctx: PolicyContext, candidates: list[Candidate],
                            order: list[str]) -> str:
        """Why the order is what it is, keeping two cases apart that read alike:
        nobody recorded besides the head, and recorded people who cannot be
        asked right now. The first is a fact about the record; the second is a
        fact about this hour."""
        head = self.village_head_id
        related = [a for a in order if a != head]
        others = [r["actorId"] for r in ctx.relations if r["actorId"] != head]
        tail = "마지막에 이장에게 간다." if head in order else "이장에게는 묻지 않는다."
        if related:
            return "기록된 가까운 관계(%s)에게 먼저 부탁하고, %s" % (", ".join(related), tail)
        if not others:
            recorded = ("기록된 가까운 관계는 이장 한 사람뿐" if any(
                r["actorId"] == head for r in ctx.relations) else "기록된 가까운 관계가 없음")
            return ("%s: %s이라 %s 이장에게 부담이 몰리는 것은 관계 기록의 결과이지 정책이 "
                    "이장을 고른 것이 아니다." % (ctx.subject_id, recorded, tail))
        why = {c.actorId: c.reason for c in candidates}
        return ("기록된 가까운 관계(%s)가 있지만 지금은 부탁할 수 없다 (%s). %s" % (
            ", ".join(others), "; ".join("%s: %s" % (a, why.get(a, "후보 아님")) for a in others),
            tail))

    def _relation_order(self, ctx: PolicyContext, candidates: list[Candidate]) -> list[str]:
        """Recorded relations who may be asked, then the head, within the limit."""
        params = self.revision.params
        ties = {r["actorId"] for r in ctx.relations}
        related = [c.actorId for c in candidates
                   if c.included and c.actorId in ties and c.actorId != self.village_head_id]
        if params.allowHeadContact:
            return related[:max(0, params.neighbourAskLimit - 1)] + [self.village_head_id]
        return related[:params.neighbourAskLimit]

    def _next_contact_ms(self, ctx: PolicyContext) -> int:
        """Retry interval, but never inside the quiet window after the last call.

        ``quietWindowMin`` is a floor on the gap between two contacts to the same
        person. Without it a short retry interval produces three calls in ten
        minutes and the burden metric quietly stops meaning anything.
        """
        params = self.revision.params
        by_interval = ctx.sim_time_ms + params.retryIntervalMin * MIN_MS
        by_quiet = ctx.last_contact_ms + params.quietWindowMin * MIN_MS
        return int(max(by_interval, by_quiet))

    def _escalation_due(self, ctx: PolicyContext) -> str | None:
        limit = self.revision.params.escalateToInstitutionAfterMin
        if limit is None:
            return None
        elapsed = ctx.sim_time_ms - ctx.raised_ms
        if elapsed < limit * MIN_MS:
            return None
        return ("접수 후 %d분이 지나 escalateToInstitutionAfterMin(%d분)을 넘겼다. "
                "전략과 무관하게 기관으로 넘긴다." % (elapsed // MIN_MS, limit))

    def disclosure_to(self, recipient_class: str, ctx: PolicyContext) -> dict[str, Any]:
        """What is actually shared, under this revision's ``disclosure`` setting.

        ``minimal`` shares that a check-in went unanswered and nothing else.
        ``named`` adds the attempt times, and for an institution the consented
        routine as well - which is exactly the cost the comparison should show.
        """
        named = self.revision.params.disclosure == "named"
        if recipient_class == "subject":
            fields: list[str] = []
        elif recipient_class == "neighbour":
            fields = ["응답 없음"] + (["연락 시도 시각"] if named else [])
        elif recipient_class == "institution":
            fields = ["응답 없음"]
            if named:
                fields += ["연락 시도 시각", "공개 동의된 평소 일과"]
        else:
            fields = ["응답 없음"]
        return {
            "subjectId": ctx.subject_id,
            "fields": fields,
            "recipientClass": recipient_class,
            "disclosureSetting": self.revision.params.disclosure,
            "note": "공개 항목 수와 수신자 구분을 따로 센다. 인원 합계를 프라이버시 점수로 쓰지 않는다.",
        }

    def _handoff_intent(self, ctx: PolicyContext) -> Intent:
        return Intent("handoff", {
            "toActorId": HEALTH_STAFF,
            "requestId": ctx.request_id,
            "disclosure": self.disclosure_to("institution", ctx),
        })

    # -- helpers -----------------------------------------------------------
    def _decision(self, ctx: PolicyContext, question: str,
                  candidates: list[Candidate], chosen: str | None,
                  rationale: str) -> DecisionRecord:
        self._decisions += 1
        return DecisionRecord(
            id="dec-%d" % self._decisions,
            attemptId="",  # filled by the engine
            simTimeMs=ctx.sim_time_ms,
            policyId=self.revision.id,
            question=question,
            candidates=candidates,
            chosen=chosen,
            rationale=rationale,
            knownFacts=ctx.known_facts,
            observationIds=ctx.observation_ids,
        )
