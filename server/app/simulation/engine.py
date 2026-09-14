"""The simulation kernel.

Ordering is fixed by ``(simTimeMs, priority, stableSeq)`` so that two runs of the
same rules produce identical logs. Nothing else changes world state: adapters
return proposals, the engine validates them, and only a committed
``DomainEvent`` reaches the world.

Ground truth lives in ``WorldState``. It is consulted to decide whether a call is
answered or whether somebody is actually at a place, and it is published only to
the researcher view.

Three boundaries are enforced here rather than described in a comment:

* **why a call was missed is a fact about the world.** It is emitted as
  ``world.reachability_resolved`` addressed to the researcher alone. The caller
  learns "no answer" and nothing else - previously the reason ("he is in the
  field") rode along inside the MEDial-visible event;
* **what MEDial holds about somebody's day** is a ``home_or_away`` projection of
  the consented routine. The village head holds the place-level version as his
  own memory, and MEDial acquires a place only when he reports one;
* **a proposal is checked before it becomes an event** - the actor it claims to
  be, the attempt it belongs to, the request it answers and the observations it
  cites (:func:`contracts.validate_proposal`).
"""
from __future__ import annotations

import heapq
import itertools
from dataclasses import dataclass, field
from typing import Any

from .agents.base import AdapterError, ProposalFactory
from .agents.llm import LlmAdapter
from .agents.model_calls import ModelCallLog
from .agents.rule_agents import (
    RuleHealthStaffAdapter,
    RuleResidentAdapter,
    RuleVillageHeadAdapter,
)
from .agents.scripted import ScriptedAdapter
from .contracts import (
    ENGINE,
    HEALTH_STAFF,
    MEDIAL,
    RESEARCHER,
    Attempt,
    Channel,
    ContactStrategy,
    DecisionRecord,
    DomainEvent,
    EventType,
    ExperienceReview,
    PolicyRevision,
    ProposalAction,
    ProposalRejection,
    ResourceRevision,
    ScenarioDeck,
    validate_proposal,
)
from .environment import get_environment, resolve_place
from .relations import get_relations
from .institution import Desk, ShiftExhausted
from .observations import ActorView, ObservationLog, home_window, shared_routine
from .agents.provider import CallSpec
from .policies.llm_policy import LlmMedialPolicy, parse_head_reply
from .policies.rule_policies import Intent, MedialPolicy, PolicyContext
from .transport import TransportBook
from .village import Village
from .world import MIN_MS, Segment, WorldState

CHECK_ON_SITE_MS = 5 * MIN_MS
CALL_BUFFER_MS = 15 * MIN_MS
VILLAGE_HEAD_ID = "P6"

#: What the institution is told when the disclosure setting is ``named``. The
#: string is matched, not guessed: the routine only reaches the centre when the
#: policy actually disclosed it.
ROUTINE_DISCLOSURE_FIELD = "공개 동의된 평소 일과"

# Lower runs first when two things land on the same millisecond.
@dataclass(order=True)
class _Pending:
    at_ms: int
    priority: int
    seq: int
    kind: str = field(compare=False)
    payload: dict[str, Any] = field(compare=False, default_factory=dict)


@dataclass
class RunResult:
    attempt: Attempt
    events: list[DomainEvent]
    decisions: list[DecisionRecord]
    reviews: list[ExperienceReview]
    observations: list[Any]
    metrics: dict[str, Any]
    trace: list[dict[str, Any]]
    timeline: dict[str, Any]
    #: Every model call this attempt used, live or replayed from a parent. Empty
    #: for the rule and scripted adapters, which call nothing.
    model_calls: list[Any] = field(default_factory=list)


class ForkPrefixMismatch(RuntimeError):
    """A checkpoint fork did not reproduce its parent's log up to the checkpoint.

    Raised instead of storing the run: a fork whose prefix differs from the
    parent is not a branch of that attempt, and calling it one would corrupt the
    lineage the whole tool rests on.
    """


class Engine:
    def __init__(self, attempt: Attempt, policy: PolicyRevision, deck: ScenarioDeck,
                 resources: ResourceRevision, village: Village,
                 script: list[dict[str, Any]] | None = None,
                 personas: dict[str, Any] | None = None,
                 policy_switch: dict[str, Any] | None = None,
                 environment: Any | None = None,
                 model_calls: Any | None = None,
                 provider: Any | None = None,
                 relations: Any | None = None) -> None:
        self.attempt = attempt
        #: World rules as data. The attempt records which revision it ran on so
        #: that changing an assumption shows up as a different input rather than
        #: as a policy effect.
        self.environment = environment or get_environment(attempt.environmentRevisionId)
        self.policy_revision = policy
        self.deck = deck
        self.resources = resources
        self.village = village
        self.world = WorldState(village, deck.horizonMs)
        self.obs = ObservationLog()
        self.factory = ProposalFactory(attempt.id)
        self.personas = personas or {}

        self.events: list[DomainEvent] = []
        self.decisions: list[DecisionRecord] = []
        self.trace: list[dict[str, Any]] = []
        self.adapter_failures: list[dict[str, Any]] = []
        self.rejected_proposals: list[dict[str, Any]] = []
        #: What people have told MEDial about their own ability to drive, in
        #: reply to an earlier request. It is second-hand only in the sense that
        #: they said it; MEDial never infers it from the persona source.
        self.ride_replies: dict[str, str] = {}
        self.contacts: list[dict[str, Any]] = []
        self.disclosures: list[dict[str, Any]] = []
        self.requests: dict[str, dict[str, Any]] = {}
        self.desk = Desk(resources)
        self.book = TransportBook(
            seat_assumption=("좌석 수는 원자료에 없다. ResourceRevision의 실험 가정값(%d)이다."
                             % resources.assumedVehicleSeats),
            seats_per_vehicle=resources.assumedVehicleSeats)

        #: ``{holderId: {subjectId: routine}}``. Split per holder on purpose -
        #: see the module docstring.
        self.routines = self._build_routines()

        self._seq = itertools.count(1)
        self._tick = itertools.count(1)
        self._queue: list[_Pending] = []
        self._switch = policy_switch
        self._switched = False
        #: Records or replays every model call. Built here rather than inside the
        #: adapters because the recording belongs to the attempt, not to one
        #: actor - a fork replays the parent's calls across all of them.
        #: Who may hand work to whom. Fixed case input like the environment: an
        #: edge that is not in the source is not created, so a resident with no
        #: recorded relation simply has nobody to pass a request to.
        self.relations = relations or get_relations(attempt.relationRevisionId)
        #: ``{requestId: [actorId, ...]}`` - everyone a request has passed
        #: through, so it cannot loop back to someone who already had it.
        self.relay_chains: dict[str, list[str]] = {}
        self.model_calls = model_calls or ModelCallLog(attempt.id, attempt.modelPolicy)
        self._provider = provider
        self._adapters = self._build_adapters(script)
        self.policy = self._make_policy(policy)

    def _make_policy(self, revision: PolicyRevision) -> MedialPolicy:
        """MEDial's head: rules, or the model, under the same policy revision.

        One switch for the whole village (``attempt.adapter``): when residents
        are models, so is the head. The designer sees one choice, not two.
        """
        if self.attempt.adapter != "llm":
            return MedialPolicy(revision, VILLAGE_HEAD_ID)
        return LlmMedialPolicy(
            revision, VILLAGE_HEAD_ID, ask=self._ask_head,
            events_for=self._medial_events,
            resident_ids=[r["id"] for r in self.village.residents],
            max_tokens=self.attempt.modelPolicy.maxOutputTokens)

    def _ask_head(self, prompt: dict[str, Any], spec: CallSpec) -> dict[str, Any]:
        """One head call through the same log every resident call goes through."""
        record = self.model_calls.resolve(MEDIAL, int(prompt.get("simTimeMs", 0)), prompt,
                                          provider=self._provider, role="head", spec=spec)
        return parse_head_reply(record.response)

    def _medial_events(self, request_id: str) -> list[dict[str, Any]]:
        """What MEDial was addressed on for this request, as the head reads it.

        The visibility list is the only gate. A hand-off between neighbours,
        a refusal further down one, the world's reason for an unanswered phone:
        none of it is here, because MEDial was not on the list.
        """
        keep = ("toActorId", "fromActorId", "utterance", "reason", "rule", "outcome",
                "place", "channel", "untilMs", "message", "resolutionPath",
                "suggestedPlace", "attemptNumber", "chosen", "summary")
        rows = []
        for event in self.events:
            if event.correlationId != request_id or MEDIAL not in event.visibility:
                continue
            row: dict[str, Any] = {"id": event.id, "seq": event.seq,
                                   "clock": _clock(event.simTimeMs),
                                   "type": event.type.value, "actorId": event.actorId}
            for key in keep:
                if key in event.payload and event.payload[key] is not None:
                    row[key] = event.payload[key]
            rows.append(row)
        return rows

    def _decide(self, at_ms: int, request: dict[str, Any], question: str,
                call: Any) -> tuple[DecisionRecord | None, list[Intent]]:
        """Run one head decision, and treat a head failure as a failure.

        A model that would not answer within the designer's conditions has
        not decided anything; MEDial does nothing this turn and the log says
        why. It is never replaced by the rule policy's answer.
        """
        try:
            return call()
        except AdapterError as exc:
            self.adapter_failures.append({"actorId": MEDIAL, "atMs": at_ms,
                                          "error": str(exc)})
            self._emit(at_ms, EventType.medial_waiting, MEDIAL, request["id"],
                       [MEDIAL, RESEARCHER],
                       {"reason": "adapter_error", "untilMs": at_ms, "actorId": MEDIAL,
                        "detail": str(exc), "question": question,
                        "note": "MEDial 머리(모델)의 실패이며 규칙 결과로 갈아치우지 않는다."})
            return None, []

    # -- setup -----------------------------------------------------------
    def _build_routines(self) -> dict[str, dict[str, dict[str, Any]]]:
        horizon = self.deck.horizonMs
        medial: dict[str, dict[str, Any]] = {}
        head: dict[str, dict[str, Any]] = {}
        for resident in self.village.residents:
            medial[resident["id"]] = shared_routine(
                resident, MEDIAL, horizon, "home_or_away").model_dump(mode="json")
            if resident["id"] != VILLAGE_HEAD_ID:
                head[resident["id"]] = shared_routine(
                    resident, VILLAGE_HEAD_ID, horizon,
                    "place_level").model_dump(mode="json")
        # The centre starts with nothing. It receives a routine only if a policy
        # actually discloses one at handoff.
        return {MEDIAL: medial, VILLAGE_HEAD_ID: head, HEALTH_STAFF: {}}

    def _build_adapters(self, script: list[dict[str, Any]] | None) -> dict[str, Any]:
        """One instance per actor, always.

        Adapters used to be one shared object handed to everybody. That is fine
        while an adapter is stateless and silently wrong the moment it is not:
        a per-actor call counter, a retrieval cache or a conversation history on
        a shared instance belongs to whoever spoke last. The engine already
        isolates what each actor may *see* - see ``observations`` - and this is
        the same isolation on the side that does the talking.
        """
        actor_ids = [r["id"] for r in self.village.residents] + [HEALTH_STAFF]
        if self.attempt.adapter == "llm":
            # The health centre stays a rule adapter: doc 19 keeps the
            # institution's procedure fixed, and step 5 is where it grows.
            adapters = {actor_id: LlmAdapter(self.factory, actor_id, self.model_calls,
                                             provider=self._provider,
                                             interaction=self.environment.interaction)
                        for actor_id in actor_ids if actor_id != HEALTH_STAFF}
            adapters[HEALTH_STAFF] = RuleHealthStaffAdapter(self.factory)
            return adapters
        if self.attempt.adapter == "scripted":
            # A copy each: the script is matched by actorId anyway, so splitting
            # changes no behaviour, and it stops one actor's consumed entries
            # from being bookkeeping the others share.
            return {actor_id: ScriptedAdapter(self.factory, list(script or []))
                    for actor_id in actor_ids}
        rules = self.environment.interaction
        adapters: dict[str, Any] = {}
        for resident in self.village.residents:
            adapters[resident["id"]] = (
                RuleVillageHeadAdapter(self.factory, rules) if resident["isVillageHead"]
                else RuleResidentAdapter(self.factory, rules)
            )
        adapters[HEALTH_STAFF] = RuleHealthStaffAdapter(self.factory)
        return adapters

    # -- event plumbing --------------------------------------------------
    def _emit(self, at_ms: int, etype: EventType, actor_id: str, correlation: str,
              visibility: list[str], payload: dict[str, Any],
              causation: str | None = None) -> DomainEvent:
        seq = next(self._seq)
        event = DomainEvent(
            id="ev-%d" % seq,
            attemptId=self.attempt.id,
            seq=seq,
            simTimeMs=at_ms,
            type=etype,
            actorId=actor_id,
            causationId=causation,
            correlationId=correlation,
            visibility=sorted(set(visibility)),
            committed=True,
            payload=payload,
        )
        self.events.append(event)
        return event

    def _schedule(self, at_ms: int, kind: str, payload: dict[str, Any]) -> None:
        base = kind.partition(":")[0]
        if at_ms > self.deck.horizonMs and base != "finalize":
            return
        heapq.heappush(
            self._queue,
            _Pending(int(at_ms), self.environment.priority(base), next(self._tick), kind,
                     payload))

    # -- run -------------------------------------------------------------
    def run(self) -> RunResult:
        self._emit(0, EventType.world_day_started, ENGINE, "world", [RESEARCHER],
                   {"dayStartMs": 0, "dataSource": self.village.data_source})
        for scenario_event in self.deck.events:
            self._schedule(scenario_event.simTimeMs, "scenario", {"event": scenario_event})
        self._schedule(self.deck.horizonMs, "finalize", {})

        while self._queue:
            pending = heapq.heappop(self._queue)
            self._maybe_switch_policy(pending.at_ms)
            self._dispatch(pending.kind, pending.at_ms, pending.payload)

        from .metrics import build_metrics, build_reviews

        return RunResult(
            attempt=self.attempt,
            events=self.events,
            decisions=self.decisions,
            reviews=build_reviews(self),
            observations=self.obs.all(),
            metrics=build_metrics(self),
            trace=self.trace,
            timeline=self.timeline(),
            model_calls=list(self.model_calls.records),
        )

    def _maybe_switch_policy(self, at_ms: int) -> None:
        """Checkpoint fork: run the parent's rules up to ``afterSeq``, then swap.

        The prefix is not asserted to be identical - it *is* identical, because
        the same rules ran over the same inputs, and the service verifies that
        against the stored parent log before it saves anything.
        """
        if self._switch is None or self._switched:
            return
        if len(self.events) < int(self._switch["afterSeq"]):
            return
        new_policy: PolicyRevision = self._switch["policy"]
        old_id = self.policy_revision.id
        self.policy_revision = new_policy
        self.policy = self._make_policy(new_policy)
        self._switched = True
        self._emit(at_ms, EventType.policy_switched, ENGINE, "fork", [RESEARCHER],
                   {"fromPolicyId": old_id, "toPolicyId": new_policy.id,
                    "atSeq": int(self._switch["afterSeq"]),
                    "note": "체크포인트 이전 사건은 부모와 동일하며 이후만 새 정책을 따른다."})
        # The new revision may carry a deadline the old one did not.
        for request in self.requests.values():
            self._arm_escalation(request)

    def timeline(self) -> dict[str, Any]:
        """Baseline and realized day per actor, for the map and the plan diff.

        Derived from the finished run, so the map, the trace and the metrics all
        describe the same log. Nothing here re-invokes an adapter.
        """
        head = VILLAGE_HEAD_ID

        def dump(segments: list[Segment], actor_id: str) -> list[dict[str, Any]]:
            out = []
            for seg in segments:
                row = seg.as_dict(with_polyline=True, environment=self.environment)
                if seg.kind == "stay" and seg.place:
                    x, y = self.village.position_of_place(seg.place, actor_id)
                    row["xy"] = [round(x, 1), round(y, 1)]
                out.append(row)
            return out

        actors = {}
        for resident in self.village.residents:
            actor_id = resident["id"]
            runtime = self.world.actors[actor_id]
            actors[actor_id] = {
                "id": actor_id,
                "displayName": resident["displayName"],
                "isVillageHead": actor_id == head,
                "group": resident["group"],
                "homeXY": [resident["home"]["x"], resident["home"]["y"]],
                "baseline": dump(runtime.baseline, actor_id),
                "realized": dump(runtime.realized, actor_id),
                "planChanged": bool(runtime.plan_changes),
                "addedTaskMs": runtime.task_ms,
                "contactsReceived": runtime.contacts_received,
            }
        return {"horizonMs": self.deck.horizonMs, "actors": actors,
                "reservations": self.book.report()}

    def _dispatch(self, kind: str, at_ms: int, payload: dict[str, Any]) -> None:
        base, _, sub = kind.partition(":")
        table = {
            ("scenario", ""): self._on_scenario,
            ("contact", ""): self._on_contact,
            ("reaction", "missed"): self._on_missed,
            ("reaction", "answered"): self._on_answered,
            ("arrival", ""): self._on_arrival,
            ("relay", ""): self._on_relay,
            ("institution", "escalate"): self._on_escalation_due,
            ("institution", "review_start"): self._on_review_start,
            ("institution", "review_done"): self._on_review_done,
            ("institution", "call"): self._on_institution_call,
            ("institution", "visit_arrival"): self._on_visit_arrival,
            ("transport", "pickup"): self._on_pickup,
            ("transport", "dropoff"): self._on_dropoff,
            ("transport", "return"): self._on_return_trip,
            ("transport", "home"): self._on_ride_home,
            ("finalize", ""): self._on_finalize,
        }
        handler = table.get((base, sub))
        if handler is None:
            raise ValueError("no handler for pending kind %r" % kind)
        handler(at_ms, payload)

    # -- scenario ----------------------------------------------------------
    def _on_scenario(self, at_ms: int, payload: dict[str, Any]) -> None:
        scenario_event = payload["event"]
        if scenario_event.type is EventType.contact_attempted:
            self._contact(at_ms, dict(scenario_event.payload), attempt_number=1,
                          correlation="checkin-" + scenario_event.subjectId,
                          scenario_event_id=scenario_event.id)
            return
        if scenario_event.type is EventType.transport_need_raised:
            self._raise_transport_need(at_ms, scenario_event)
            return
        raise ValueError("deck event type %s is not supported in this slice"
                         % scenario_event.type.value)

    # -- contact ----------------------------------------------------------
    def _on_contact(self, at_ms: int, payload: dict[str, Any]) -> None:
        self._contact(at_ms, payload["contact"], payload["attemptNumber"],
                      payload["correlation"])

    def _contact(self, at_ms: int, contact: dict[str, Any], attempt_number: int,
                 correlation: str, scenario_event_id: str | None = None) -> None:
        to_actor = contact["toActorId"]
        channel = Channel(contact["channel"])
        purpose = contact["purpose"]
        from_actor = contact.get("fromActorId", MEDIAL)

        attempted = self._emit(
            at_ms, EventType.contact_attempted, from_actor, correlation,
            [from_actor, to_actor],
            {"channel": channel.value, "toActorId": to_actor, "purpose": purpose,
             "disclosure": contact.get("disclosure", {}),
             "attemptNumber": attempt_number,
             "scenarioEventId": scenario_event_id},
        )
        self.contacts.append({"atMs": at_ms, "channel": channel.value, "to": to_actor,
                              "purpose": purpose, "from": from_actor})
        self._record_disclosure(contact.get("disclosure"), to_actor)

        place = self.world.place_of(to_actor, at_ms)
        rule = self.environment.reaches(resolve_place(place, to_actor), channel)

        # Why the phone was or was not answered is a fact about the world. It is
        # written down for the researcher and never handed to the caller.
        self._emit(at_ms, EventType.world_reachability_resolved, ENGINE, correlation,
                   [RESEARCHER],
                   {"toActorId": to_actor, "channel": channel.value,
                    "answered": rule.reachable, "worldReason": rule.reason,
                    "provenance": rule.provenance, "place": place,
                    "note": "연구자 전용. 연락한 쪽은 '응답 없음'만 알 수 있다."},
                   causation=attempted.id)

        if rule.reachable:
            answered = self._emit(
                at_ms, EventType.contact_answered, to_actor, correlation,
                [from_actor, to_actor],
                {"channel": channel.value, "toActorId": to_actor, "reply": "ok"},
                causation=attempted.id)
            self.obs.record(self.attempt.id, from_actor, answered, "contact.answered",
                            subject_id=to_actor,
                            payload={"purpose": purpose, "attemptNumber": attempt_number})
            self._schedule(at_ms, "reaction:answered",
                           {"subject": to_actor, "correlation": correlation,
                            "purpose": purpose, "from": from_actor})
            return

        missed = self._emit(
            at_ms, EventType.contact_no_response, to_actor, correlation,
            [from_actor, to_actor],
            {"channel": channel.value, "toActorId": to_actor,
             "attemptNumber": attempt_number,
             "note": ("무응답은 거절이 아니다. 응답이 없었다는 것만 말해 준다. "
                      "왜 응답이 없었는지는 연락한 쪽이 알 수 없다.")},
            causation=attempted.id)
        self.obs.record(self.attempt.id, from_actor, missed, "contact.no_response",
                        subject_id=to_actor,
                        payload={"purpose": purpose, "attemptNumber": attempt_number,
                                 "channel": channel.value})
        self._schedule(at_ms, "reaction:missed",
                       {"subject": to_actor, "correlation": correlation,
                        "attemptNumber": attempt_number, "purpose": purpose,
                        "from": from_actor})

    # -- reactions ---------------------------------------------------------
    def _on_missed(self, at_ms: int, payload: dict[str, Any]) -> None:
        subject = payload["subject"]
        attempt_number = payload["attemptNumber"]
        request = self._ensure_request(at_ms, subject)
        if request.get("closed"):
            return
        request["contactAttempts"] = attempt_number
        request["lastContactMs"] = at_ms

        if payload.get("from") == HEALTH_STAFF:
            self._institution_after_failed_call(at_ms, request)
            return

        ctx = self._context(at_ms, subject, request, attempt_number)
        retries_left = attempt_number <= self.policy_revision.params.retryCount
        if (self.policy_revision.contactStrategy is ContactStrategy.retry_then_clinic
                and not retries_left):
            decision, intents = self._decide(
                at_ms, request, "연락이 계속 닿지 않을 때 다음 담당자는 누구인가",
                lambda: self.policy.on_retry_exhausted(ctx))
        else:
            decision, intents = self._decide(
                at_ms, request, "응답이 없는 상태를 누가 어떻게 확인할 것인가",
                lambda: self.policy.on_unanswered_checkin(ctx))
        if decision is None:
            return
        self._commit_decision(at_ms, decision, request)
        for intent in intents:
            self._apply_intent(at_ms, intent, request)

    def _on_answered(self, at_ms: int, payload: dict[str, Any]) -> None:
        request = next((r for r in self.requests.values()
                        if r["subjectId"] == payload["subject"] and not r.get("closed")
                        and r["need"] == "welfare_check"), None)
        if request is None:
            return
        path = ("institution_followup_call" if payload.get("from") == HEALTH_STAFF
                else "subject_answered_retry")
        self._resolve(at_ms, request, outcome="answered_by_subject", path=path,
                      by=payload.get("from"))

    # -- intents -----------------------------------------------------------
    def _apply_intent(self, at_ms: int, intent: Intent, request: dict[str, Any]) -> None:
        data = intent.payload
        if intent.kind == "schedule_contact":
            self._schedule(int(data["atMs"]), "contact", {
                "contact": {"toActorId": data["toActorId"], "channel": data["channel"],
                            "purpose": data["purpose"], "disclosure": data["disclosure"],
                            "fromActorId": MEDIAL},
                "attemptNumber": data["attemptNumber"],
                "correlation": request["id"]})
            self._emit(at_ms, EventType.medial_waiting, MEDIAL, request["id"], [MEDIAL],
                       {"reason": "retry_scheduled", "untilMs": int(data["atMs"])})
        elif intent.kind == "wait":
            # The head chose to do nothing for now. That is a decision with a
            # clock on it, not an end: the same question comes back at ``atMs``
            # with everything that happened in between on the record.
            until = int(data["atMs"])
            self._emit(at_ms, EventType.medial_waiting, MEDIAL, request["id"],
                       [MEDIAL, RESEARCHER],
                       {"reason": "head_wait", "untilMs": until,
                        "note": "MEDial 머리가 지금은 아무에게도 부탁하지 않고 기다리기로 했다."})
            self._schedule(until, "reaction:missed",
                           {"subject": request["subjectId"], "correlation": request["id"],
                            "attemptNumber": int(data.get("attemptNumber", 1)),
                            "purpose": "welfare_check", "from": MEDIAL})
        elif intent.kind == "offer_request":
            request["fallbackOrder"] = list(data.get("fallbackOrder") or [])
            request["message"] = data.get("message")
            self._offer(at_ms, request, data["toActorId"], data["disclosure"])
        elif intent.kind == "offer_ride":
            self._offer_ride(at_ms, request, data["toActorId"], data["disclosure"])
        elif intent.kind == "handoff":
            self._handoff(at_ms, request, data["toActorId"], data["disclosure"])
        elif intent.kind == "continue_check":
            self._start_check(at_ms, request, data["toActorId"], data["place"])
        else:
            raise ValueError("unknown intent %s" % intent.kind)

    def _offer(self, at_ms: int, request: dict[str, Any], to_actor: str,
               disclosure: dict[str, Any]) -> None:
        self.world.actors[to_actor].asked_by_medial += 1
        self.relay_chains.setdefault(request["id"], []).append(to_actor)
        # What MEDial actually says. A rule head says nothing beyond the
        # disclosure fields; a model head writes the ask, and the person asked
        # reads those words and no others.
        message = request.get("message")
        offered = self._emit(at_ms, EventType.request_offered, MEDIAL, request["id"],
                             [MEDIAL, to_actor],
                             {"requestId": request["id"], "toActorId": to_actor,
                              "need": request["need"], "subjectId": request["subjectId"],
                              "disclosure": disclosure,
                              **({"message": message} if message else {})})
        self._record_disclosure(disclosure, to_actor)
        self.world.actors[to_actor].contacts_received += 1
        self.obs.record(self.attempt.id, to_actor, offered, "request.offered",
                        subject_id=request["subjectId"],
                        payload={"requestId": request["id"], "need": request["need"],
                                 "fromActorId": MEDIAL,
                                 "message": message,
                                 "disclosedFields": disclosure.get("fields", []),
                                 "travelMinutes": self._errand_minutes(
                                     to_actor, at_ms, "HOME:" + request["subjectId"])})

        allowed = [ProposalAction.accept, ProposalAction.decline, ProposalAction.defer]
        if self._can_relay(request, to_actor):
            allowed.append(ProposalAction.relay)
        proposals = self._ask(to_actor, at_ms, allowed)
        if not proposals:
            self._unresolved(at_ms, request, "요청을 받은 사람이 응답을 만들지 못했다")
            return
        proposal = proposals[0]
        if proposal.action is ProposalAction.relay:
            self._relay(at_ms, request, to_actor, proposal)
            return
        if proposal.action is ProposalAction.accept:
            self._emit(at_ms, EventType.request_accepted, to_actor, request["id"],
                       [MEDIAL, to_actor],
                       {"requestId": request["id"], "params": proposal.params,
                        "utterance": proposal.utterance,
                        "evidenceRefs": proposal.evidenceRefs})
            self._start_check(at_ms, request, to_actor, "HOME:" + request["subjectId"])
        elif proposal.action is ProposalAction.defer:
            self._emit(at_ms, EventType.request_deferred, to_actor, request["id"],
                       [MEDIAL, to_actor],
                       {"requestId": request["id"], "untilMs": at_ms,
                        "rule": proposal.params.get("rule"),
                        **_yardstick(proposal.params),
                        "reason": proposal.params.get("reason"),
                        "utterance": proposal.utterance,
                        "evidenceRefs": proposal.evidenceRefs})
            if not self._offer_next(at_ms, request, disclosure):
                self._unresolved(
                    at_ms, request,
                    "요청받은 사람이 지금은 갈 수 없다고 했고 이 정책에는 대안 후보가 없다")
        else:
            self._emit(at_ms, EventType.request_declined, to_actor, request["id"],
                       [MEDIAL, to_actor],
                       {"requestId": request["id"],
                        "rule": proposal.params.get("rule"),
                        **_yardstick(proposal.params),
                        "reason": proposal.params.get("reason", "unspecified"),
                        "utterance": proposal.utterance,
                        "evidenceRefs": proposal.evidenceRefs,
                        "note": "거절은 신뢰 하락으로 계산하지 않는다."})
            if not self._offer_next(at_ms, request, disclosure):
                self._unresolved(at_ms, request,
                                 "요청이 거절되었고 이 정책에는 대안 후보가 없다")

    def _errand_minutes(self, actor_id: str, at_ms: int, place: str) -> float | None:
        """How long the walk would be. Measured, so the adapter need not guess.

        Handed over the same way ``detourMin`` already is for a ride: the adapter
        holds no map, and giving it one would let it reason about geography its
        own view does not contain.
        """
        runtime = self.world.actors.get(actor_id)
        if runtime is None:
            return None
        x, y = self.world.position_of(actor_id, at_ms)
        try:
            route = self.village.route(self.village.nearest_node(x, y),
                                       self.village.anchor_of_place(place, actor_id))
        except KeyError:
            return None
        if route is None:
            return None
        _polyline, metres = route
        return self.village.travel_ms(metres, "walk") / MIN_MS

    def _offer_next(self, at_ms: int, request: dict[str, Any],
                    disclosure: dict[str, Any]) -> bool:
        """Ask the next name on the policy's order, if there is one.

        Only a policy that supplied an order gets this. It is not a general
        fallback: "someone else will do it" is exactly the assumption that makes
        a coordination tool look better than it is, so a policy that named one
        person still ends when that person says no.
        """
        order = request.get("fallbackOrder") or []
        while order:
            nxt = order.pop(0)
            if nxt in self.world.actors and nxt not in self.relay_chains.get(
                    request["id"], []):
                request["fallbackOrder"] = order
                self._offer(at_ms, request, nxt, disclosure)
                return True
        request["fallbackOrder"] = []
        return False

    # -- one resident hands work to another ---------------------------------
    def _can_relay(self, request: dict[str, Any], actor_id: str) -> bool:
        """Whether this person has anyone left to hand this request to.

        False is a result, not a gap. P1 has one recorded relation and P2 has
        one; when that person already holds the request there is nobody else,
        and the interviews say so rather than the model being incomplete.
        """
        rules = self.environment.interaction
        if not rules.relayEnabled:
            return False
        if int(request.get("relayHop", 0)) >= rules.maxRelayHops:
            return False
        return bool(self._relay_candidates(request, actor_id))

    def _relay_candidates(self, request: dict[str, Any], actor_id: str) -> list[str]:
        """Everyone this person could hand the request to, and nobody else.

        Excluded: the subject of the check (asking someone to check on
        themselves is not a check), and anyone the request already passed
        through (a request that circles back is a loop, not a village).
        """
        held = set(self.relay_chains.get(request["id"], []))
        out = []
        for edge in self.relations.neighbours(actor_id):
            other = self.relations.other(edge, actor_id)
            if other == request["subjectId"] or other in held:
                continue
            if other not in self.world.actors:
                continue
            out.append(other)
        return sorted(out)

    def _relay(self, at_ms: int, request: dict[str, Any], from_actor: str,
               proposal: Any) -> None:
        """Commit a hand-off, and tell MEDial only that the request was accepted.

        This is the point of the whole mechanism. MEDial asked one person and was
        told yes; a different person goes. MEDial's ledger and the village's
        actual burden come apart, and that gap is what the evaluation screen has
        to be able to show. The researcher sees both sides; MEDial sees one.
        """
        target = proposal.targetActorId or proposal.params.get("targetActorId")
        allowed = self._relay_candidates(request, from_actor)
        if target not in allowed:
            # An adapter fault, like any other unusable proposal. It is never
            # written down as the resident having done something strange.
            self.rejected_proposals.append({
                "actorId": from_actor, "atMs": at_ms,
                "error": ("%s에게 넘기려 했으나 원자료에 두 사람의 왕래 기록이 없다 "
                          "(가능한 상대: %s)" % (target, allowed or "없음"))})
            self._emit(at_ms, EventType.medial_waiting, MEDIAL, request["id"],
                       [MEDIAL, RESEARCHER],
                       {"reason": "proposal_rejected", "untilMs": at_ms,
                        "actorId": from_actor,
                        "detail": "기록되지 않은 관계로 일을 넘기려 했다",
                        "note": "검증에 실패한 제안이며 주민의 행동으로 기록하지 않는다."})
            self._unresolved(at_ms, request, "넘길 상대가 원자료의 관계에 없다")
            return

        edge = self.relations.edge_between(from_actor, target)
        hop = int(request.get("relayHop", 0)) + 1

        # What MEDial hears: it asked this person, and this person said yes.
        self._emit(at_ms, EventType.request_accepted, from_actor, request["id"],
                   [MEDIAL, from_actor],
                   {"requestId": request["id"], "params": {},
                    "utterance": proposal.utterance,
                    "evidenceRefs": proposal.evidenceRefs})

        # What actually happens. MEDial is not in this list.
        relayed = self._emit(
            at_ms, EventType.request_relayed, from_actor, request["id"],
            [from_actor, target, RESEARCHER],
            {"requestId": request["id"], "fromActorId": from_actor,
             "toActorId": target, "hop": hop,
             "basis": proposal.params.get("basis", "recorded_relation"),
             "relationKind": edge.kind if edge else None,
             "relationReason": edge.reason if edge else None,
             "utterance": proposal.utterance,
             "note": ("MEDial은 이 전달을 보지 못한다. MEDial의 장부에는 부탁받은 사람이 "
                      "수락한 것으로 남는다.")})
        # Both ends remember it: the one who handed it on, and the one who now
        # holds it. Without the second, the neighbour is asked a question they
        # have no record of being asked.
        for observer in (from_actor, target):
            self.obs.record(self.attempt.id, observer, relayed, "request.relayed",
                            subject_id=request["subjectId"],
                            payload={"requestId": request["id"],
                                     "fromActorId": from_actor, "toActorId": target,
                                     "need": request["need"],
                                     "message": proposal.utterance,
                                     # From where they will be when they are
                                     # actually asked, not where they are now.
                                     "travelMinutes": self._errand_minutes(
                                         observer,
                                         at_ms + self.environment.interaction
                                         .relayDelayMin * MIN_MS,
                                         "HOME:" + request["subjectId"])})

        if self.environment.interaction.copresenceEnabled:
            place = self.world.place_of(from_actor, at_ms)
            together = self.world.actors_at(place, at_ms)
            if target in together:
                self._emit(at_ms, EventType.world_copresence, ENGINE, request["id"],
                           [RESEARCHER],
                           {"place": place, "actorIds": together,
                            "note": ("연구자 전용. 같이 있었다는 것은 세계의 사실이고 "
                                     "MEDial에게는 마을을 보는 감각이 없다.")})

        request["relayHop"] = hop
        request["reportedBy"] = request.get("reportedBy") or from_actor
        self.relay_chains.setdefault(request["id"], []).append(target)
        self.world.actors[target].asked_by_neighbour += 1
        self.world.actors[target].contacts_received += 1

        delay = self.environment.interaction.relayDelayMin * MIN_MS
        self._schedule(at_ms + delay, "relay",
                       {"requestId": request["id"], "fromActorId": from_actor,
                        "toActorId": target, "hop": hop})

    def _on_relay(self, at_ms: int, payload: dict[str, Any]) -> None:
        """The neighbour, some minutes later, answers the person who asked them."""
        request = self.requests[payload["requestId"]]
        if request.get("closed"):
            return
        target = payload["toActorId"]
        from_actor = payload["fromActorId"]

        allowed = [ProposalAction.accept, ProposalAction.decline, ProposalAction.defer]
        if self._can_relay(request, target):
            allowed.append(ProposalAction.relay)
        proposals = self._ask(target, at_ms, allowed)
        if not proposals:
            self._unresolved(at_ms, request, "수락 이후 확인이 완료되지 않았다")
            return
        proposal = proposals[0]

        if proposal.action is ProposalAction.relay:
            self._relay(at_ms, request, target, proposal)
            return
        if proposal.action is ProposalAction.accept:
            request["relayedTo"] = target
            self._emit(at_ms, EventType.request_accepted, target, request["id"],
                       [from_actor, target, RESEARCHER],
                       {"requestId": request["id"], "params": proposal.params,
                        "utterance": proposal.utterance,
                        "evidenceRefs": proposal.evidenceRefs,
                        "note": "이웃을 통해 받은 부탁에 대한 수락이며 MEDial은 보지 못한다."})
            self._start_check(at_ms, request, target, "HOME:" + request["subjectId"])
            return

        # Declined or deferred. MEDial still believes the first person accepted,
        # so the request is now open with nobody on it - which is precisely the
        # failure this mechanism exists to make visible.
        etype = (EventType.request_declined if proposal.action is ProposalAction.decline
                 else EventType.request_deferred)
        extra = ({"reason": proposal.params.get("reason", "unspecified")}
                 if proposal.action is ProposalAction.decline
                 else {"untilMs": at_ms, "reason": proposal.params.get("reason")})
        extra["rule"] = proposal.params.get("rule")
        extra.update(_yardstick(proposal.params))
        self._emit(at_ms, etype, target, request["id"],
                   [from_actor, target, RESEARCHER],
                   {"requestId": request["id"], **extra,
                    "utterance": proposal.utterance,
                    "evidenceRefs": proposal.evidenceRefs,
                    "note": ("MEDial은 이 거절을 보지 못한다. MEDial의 장부에는 "
                             "여전히 수락으로 남아 있다.")})
        # The reason MEDial is given must be the one MEDial could reach on its
        # own. It was told the request was accepted and then nothing happened;
        # it cannot know a second person was involved. The true reason is in the
        # decline event above, which MEDial is not addressed on.
        self._unresolved(at_ms, request, "수락 이후 확인이 완료되지 않았다")

    # -- neighbour task -----------------------------------------------------
    def _task_audience(self, request: dict[str, Any], actor_id: str) -> list[str]:
        """Who sees this person doing the work.

        For a relayed task MEDial is not on the list. It has no sensor in the
        village; it was told the request was accepted, and nothing after that
        reaches it until somebody reports. The researcher always sees.
        """
        if request.get("relayedTo") == actor_id:
            return [RESEARCHER, actor_id]
        return [MEDIAL, actor_id]

    def _start_check(self, at_ms: int, request: dict[str, Any], actor_id: str,
                     target_place: str) -> None:
        actor = self.world.actors[actor_id]
        x, y = self.world.position_of(actor_id, at_ms)
        route = self.village.route(self.village.nearest_node(x, y),
                                   self.village.anchor_of_place(target_place, actor_id))
        if route is None:
            self._unresolved(at_ms, request, "도로망에서 경로를 찾지 못했다")
            return
        polyline, metres = route
        duration = self.village.travel_ms(metres, "walk")

        travel = Segment(at_ms, at_ms + duration, "travel", "task", "안부 확인 이동",
                         from_place=actor.place_at(at_ms), to_place=target_place,
                         mode="walk", metres=metres, polyline=polyline,
                         request_id=request["id"])
        on_site = Segment(travel.end_ms, travel.end_ms + CHECK_ON_SITE_MS, "stay", "task",
                          "안부 확인", place=target_place, request_id=request["id"])
        change = self.world.divert(actor_id, at_ms, [travel, on_site], "안부 확인 요청 수락")
        audience = self._task_audience(request, actor_id)

        self._emit(at_ms, EventType.plan_modified, actor_id, request["id"],
                   sorted({RESEARCHER, actor_id, *audience}),
                   {"actorId": actor_id, "change": change["reason"],
                    "insertedSegments": change["insertedSegments"],
                    "resumeSegments": change["resumeSegments"]})
        self._emit(at_ms, EventType.task_started, actor_id, request["id"],
                   audience, {"requestId": request["id"]})
        self._emit(at_ms, EventType.task_travel_started, actor_id, request["id"],
                   audience,
                   {"requestId": request["id"], "from": travel.from_place,
                    "to": target_place, "mode": "walk",
                    "distanceM": round(metres, 1), "durationMs": duration,
                    # Say which of the two distances this is, so a reader of the
                    # log cannot confuse it with a figure the source reported.
                    "distanceBasis": "road-graph-shortest-path"})
        self._schedule(travel.end_ms, "arrival",
                       {"requestId": request["id"], "actorId": actor_id,
                        "place": target_place})

    def _on_arrival(self, at_ms: int, payload: dict[str, Any]) -> None:
        request = self.requests[payload["requestId"]]
        actor_id = payload["actorId"]
        place = payload["place"]
        subject = request["subjectId"]

        audience = self._task_audience(request, actor_id)
        self._emit(at_ms, EventType.task_travel_arrived, actor_id, request["id"],
                   audience, {"requestId": request["id"], "place": place})

        found = self.world.place_of(subject, at_ms) == place
        outcome = "subject_found_well" if found else "subject_absent"
        # When the subject is actually there, they experience the visit too.
        visibility = list(audience) + ([subject] if found else [])
        performed = self._emit(
            at_ms, EventType.task_check_performed, actor_id, request["id"], visibility,
            {"requestId": request["id"], "subjectId": subject, "place": place,
             "outcome": outcome,
             "note": "확인한 것은 '그 장소에 있는가'이며 건강 상태 판정이 아니다."})
        for observer in visibility:
            self.obs.record(self.attempt.id, observer, performed, "task.check_performed",
                            subject_id=subject,
                            payload={"requestId": request["id"], "outcome": outcome,
                                     "place": place})
        if found:
            self._emit(at_ms, EventType.task_completed, actor_id, request["id"],
                       audience, {"requestId": request["id"]})
            self._resolve(at_ms, request, outcome="no_issue_found",
                          path="neighbour_visit", by=actor_id)
            return

        proposals = self._ask(actor_id, at_ms,
                              [ProposalAction.report_observation, ProposalAction.decline])
        if not proposals or proposals[0].action is not ProposalAction.report_observation:
            self._unresolved(at_ms, request, "자택에 없었고 다음 확인처에 대한 근거가 없다")
            return

        proposal = proposals[0]
        suggested = proposal.params["suggestedPlace"]
        reported = self._emit(at_ms, EventType.medial_observed, actor_id, request["id"],
                              [MEDIAL, actor_id],
                              {"observationKind": "local_knowledge", "subjectId": subject,
                               "suggestedPlace": suggested,
                               "basis": proposal.params.get("basis"),
                               "utterance": proposal.utterance, "confidence": "reported"})
        self.obs.record(self.attempt.id, MEDIAL, reported, "local_knowledge",
                        subject_id=subject,
                        payload={"suggestedPlace": suggested, "requestId": request["id"]},
                        confidence="reported")

        ctx = self._context(at_ms, subject, request, request["contactAttempts"])
        decision, intents = self._decide(
            at_ms, request, "자택에 없을 때 확인을 계속할 것인가",
            lambda: self.policy.on_absent_report(
                ctx, suggested, proposal.params.get("basis", "unknown")))
        if decision is None:
            return
        self._commit_decision(at_ms, decision, request)
        for intent in intents:
            self._apply_intent(at_ms, intent, request)

    # -- institution ---------------------------------------------------------
    def _handoff(self, at_ms: int, request: dict[str, Any], to_actor: str,
                 disclosure: dict[str, Any]) -> None:
        requested = self._emit(at_ms, EventType.handoff_requested, MEDIAL, request["id"],
                               [MEDIAL, to_actor],
                               {"requestId": request["id"], "toActorId": to_actor,
                                "disclosure": disclosure,
                                "note": "인계는 업무 이전이며 완료가 아니다."})
        self._record_disclosure(disclosure, to_actor)
        self.obs.record(self.attempt.id, to_actor, requested, "handoff.requested",
                        subject_id=request["subjectId"],
                        payload={"requestId": request["id"]})

        # The routine crosses to the centre only if the policy disclosed it. With
        # ``disclosure=minimal`` the centre cannot pick a call-back hour, and the
        # extra work that costs is exactly what the comparison should show.
        if ROUTINE_DISCLOSURE_FIELD in (disclosure.get("fields") or []):
            subject = request["subjectId"]
            self.routines[HEALTH_STAFF][subject] = self.routines[MEDIAL][subject]

        proposals = self._ask(to_actor, at_ms,
                              [ProposalAction.accept, ProposalAction.decline])
        if not proposals or proposals[0].action is not ProposalAction.accept:
            reason = "기관이 접수하지 못했다"
            if proposals:
                reason += " (%s)" % proposals[0].params.get("reason", "unspecified")
            self._unresolved(at_ms, request, reason)
            return

        self._emit(at_ms, EventType.handoff_accepted, to_actor, request["id"],
                   [MEDIAL, to_actor], {"requestId": request["id"]})

        try:
            item = self.desk.schedule("review", request["id"], at_ms,
                                      self.resources.reviewMinutes * MIN_MS)
        except ShiftExhausted as exc:
            self._unresolved(at_ms, request, "기관 근무시간 안에 검토를 넣을 수 없다: %s" % exc)
            return

        self._emit(at_ms, EventType.institution_queued, to_actor, request["id"],
                   [MEDIAL, to_actor],
                   {"requestId": request["id"],
                    "queueDepth": self.resources.initialQueueDepth,
                    "startsAtMs": item.start_ms, "waitMs": item.wait_ms,
                    "staffIndex": item.staff_index,
                    "note": ("대기는 담당자 %d명의 실제 일정에서 계산했다. 대기열 길이와 "
                             "근무시간은 실험 가정이다." % self.desk.staff_count)})
        request["handoffMs"] = at_ms
        self._schedule(item.start_ms, "institution:review_start",
                       {"requestId": request["id"], "endMs": item.end_ms})

    def _arm_escalation(self, request: dict[str, Any]) -> None:
        """A deadline has to be able to fire by itself.

        ``escalateToInstitutionAfterMin`` used to be consulted only inside a
        decision some other event triggered. Under ``head_first`` the only
        decision happens at the missed check-in with zero minutes elapsed, so
        the condition was offered on screen and could never take effect.
        """
        limit = self.policy_revision.params.escalateToInstitutionAfterMin
        if limit is None or request.get("closed"):
            return
        due = int(request["raisedMs"]) + limit * MIN_MS
        if due in request.setdefault("escalationChecks", set()):
            return
        request["escalationChecks"].add(due)
        self._schedule(due, "institution:escalate", {"requestId": request["id"]})

    def _on_escalation_due(self, at_ms: int, payload: dict[str, Any]) -> None:
        request = self.requests[payload["requestId"]]
        if request.get("closed") or request.get("escalated"):
            return
        ctx = self._context(at_ms, request["subjectId"], request,
                            request.get("contactAttempts", 0))
        reason = self.policy._escalation_due(ctx)
        if reason is None:
            return
        request["escalated"] = True
        decision, intents = self._decide(
            at_ms, request, "응답이 없는 상태를 누가 어떻게 확인할 것인가",
            lambda: self.policy.on_unanswered_checkin(ctx))
        if decision is None:
            return
        self._commit_decision(at_ms, decision, request)
        for intent in intents:
            self._apply_intent(at_ms, intent, request)

    def _on_review_start(self, at_ms: int, payload: dict[str, Any]) -> None:
        request = self.requests[payload["requestId"]]
        if request.get("closed"):
            return
        self._emit(at_ms, EventType.institution_review_started, HEALTH_STAFF, request["id"],
                   [MEDIAL, HEALTH_STAFF], {"requestId": request["id"]})
        self._schedule(int(payload["endMs"]), "institution:review_done",
                       {"requestId": request["id"]})

    def _on_review_done(self, at_ms: int, payload: dict[str, Any]) -> None:
        request = self.requests[payload["requestId"]]
        if request.get("closed"):
            return
        subject = request["subjectId"]

        # The centre uses whatever routine the handoff actually disclosed - never
        # a live position, and nothing at all when the disclosure was minimal.
        routine = self.routines[HEALTH_STAFF].get(subject)
        next_home = home_window(routine, at_ms) if routine else None
        wanted_at = next_home + CALL_BUFFER_MS if next_home is not None else at_ms
        plan = "call_when_routine_says_home" if next_home is not None else "call_at_next_free_slot"

        try:
            item = self.desk.schedule("call", request["id"], wanted_at,
                                      self.resources.callMinutes * MIN_MS)
        except ShiftExhausted as exc:
            self._unresolved(at_ms, request, "근무시간 안에 후속 통화를 넣을 수 없다: %s" % exc)
            return

        self._emit(at_ms, EventType.institution_review_completed, HEALTH_STAFF,
                   request["id"], [MEDIAL, HEALTH_STAFF],
                   {"requestId": request["id"], "outcome": plan,
                    "callAtMs": item.start_ms,
                    "basis": ("공개 동의된 평소 일과에 맞춰 전화 시각을 골랐다. 실시간 위치가 아니다."
                              if routine else
                              "이 인계에는 일과가 공개되지 않아 다음 빈 시간에 그냥 전화한다."),
                    "routineDisclosed": bool(routine),
                    "reviewMinutes": self.resources.reviewMinutes})
        self._schedule(item.start_ms, "institution:call", {"requestId": request["id"]})

    def _on_institution_call(self, at_ms: int, payload: dict[str, Any]) -> None:
        request = self.requests[payload["requestId"]]
        if request.get("closed"):
            return
        self._contact(at_ms, {
            "toActorId": request["subjectId"],
            "channel": Channel.phone.value,
            "purpose": "clinic_followup",
            "fromActorId": HEALTH_STAFF,
            "disclosure": {"subjectId": request["subjectId"], "fields": ["연락 경위"],
                           "recipientClass": "subject"},
        }, attempt_number=request["contactAttempts"] + 1, correlation=request["id"])

    def _institution_after_failed_call(self, at_ms: int, request: dict[str, Any]) -> None:
        if request.get("visitScheduled"):
            self._unresolved(at_ms, request,
                             "방문에서도 확인되지 않았고 이 구현에는 다음 단계가 없다")
            return
        request["visitScheduled"] = True
        travel_ms = self.resources.visitTravelMinutes * MIN_MS
        # One way each direction plus the time on site: one work item, because a
        # staff member driving out cannot take the next case at the same time.
        try:
            item = self.desk.schedule(
                "visit", request["id"], at_ms,
                travel_ms * 2 + self.resources.visitMinutes * MIN_MS)
        except ShiftExhausted as exc:
            self._unresolved(at_ms, request, "근무시간 안에 방문을 넣을 수 없다: %s" % exc)
            return
        self._emit(at_ms, EventType.institution_review_completed, HEALTH_STAFF,
                   request["id"], [MEDIAL, HEALTH_STAFF],
                   {"requestId": request["id"], "outcome": "home_visit_dispatched",
                    "travelMinutes": self.resources.visitTravelMinutes,
                    "travelBasis": "편도. 방문 1건은 편도×2 + 체류로 계산한다.",
                    "departsAtMs": item.start_ms,
                    "basis": "연구용 자원 가정. 보건소 좌표가 없어 지도 밖 이동으로 처리한다."})
        self._schedule(item.start_ms + travel_ms, "institution:visit_arrival",
                       {"requestId": request["id"]})

    def _on_visit_arrival(self, at_ms: int, payload: dict[str, Any]) -> None:
        request = self.requests[payload["requestId"]]
        if request.get("closed"):
            return
        subject = request["subjectId"]
        home = "HOME:" + subject
        found = self.world.place_of(subject, at_ms) == home
        outcome = "subject_found_well" if found else "subject_absent"
        visibility = [MEDIAL, HEALTH_STAFF] + ([subject] if found else [])
        performed = self._emit(at_ms, EventType.task_check_performed, HEALTH_STAFF,
                               request["id"], visibility,
                               {"requestId": request["id"], "subjectId": subject,
                                "place": home, "outcome": outcome,
                                "note": "기관 방문 확인. 건강 상태 판정이 아니다."})
        for observer in visibility:
            self.obs.record(self.attempt.id, observer, performed, "task.check_performed",
                            subject_id=subject,
                            payload={"requestId": request["id"], "outcome": outcome,
                                     "place": home})
        if found:
            self._resolve(at_ms, request, outcome="no_issue_found",
                          path="institution_home_visit", by=HEALTH_STAFF)
        else:
            self._unresolved(at_ms, request, "기관 방문 시각에도 자택에 없었다")

    # -- T004: transport ------------------------------------------------------
    def _raise_transport_need(self, at_ms: int, scenario_event: Any) -> None:
        """A resident needs to get somewhere. Nobody is driving yet.

        The source records P9 arriving in town by car. That was the *result* of
        somebody agreeing, so what the deck carries is the need, and the ride has
        to be arranged again under whatever policy is running.
        """
        payload = dict(scenario_event.payload)
        subject = scenario_event.subjectId
        request_id = payload.get("requestId") or ("req-%s-transport" % subject)
        persona = self.personas.get(subject)
        preferred = list(getattr(persona, "closeContacts", []) or [])

        request = {
            "id": request_id, "subjectId": subject, "need": "transport",
            "raisedMs": at_ms, "contactAttempts": 0, "closed": False,
            "destination": payload["destination"],
            "departByMs": int(payload.get("departByMs", at_ms)),
            "returnAfterMin": int(payload.get("returnAfterMin", 120)),
            "purpose": payload.get("purpose", "읍내 용무"),
            "preferredHelpers": preferred,
            "askedHelpers": [],
            "lastContactMs": at_ms,
        }
        self.requests[request_id] = request

        self._emit(at_ms, EventType.transport_need_raised, subject, request_id,
                   [MEDIAL, subject, RESEARCHER],
                   {"requestId": request_id, "subjectId": subject,
                    "destination": request["destination"], "need": "transport",
                    "departByMs": request["departByMs"],
                    "purpose": request["purpose"],
                    "preferredHelpers": preferred,
                    "helpersBasis": ("본인이 가깝다고 말한 사람 목록이며 페르소나 근거 카드에서 왔다. "
                                     "운전 가능 여부는 확인되지 않았다."),
                    "note": ("이동 필요는 원본에 있고, 누가 태워 줬는지는 조율 결과다. "
                             "여기서는 결과를 미리 넣지 않는다.")})
        self.obs.record(self.attempt.id, MEDIAL,
                        self.events[-1], "transport.need_raised", subject_id=subject,
                        payload={"requestId": request_id,
                                 "destination": request["destination"],
                                 "departByMs": request["departByMs"]})
        self._ask_next_driver(at_ms, request)

    def _ask_next_driver(self, at_ms: int, request: dict[str, Any]) -> None:
        ctx = self._context(at_ms, request["subjectId"], request, 0)
        decision, intents = self.policy.on_transport_need(
            ctx, request, request["askedHelpers"], self.ride_replies)
        self._commit_decision(at_ms, decision, request)
        if not intents:
            self._unresolved(at_ms, request,
                             "물어볼 수 있는 후보가 남지 않았다. 이동 필요는 그대로 남는다")
            return
        for intent in intents:
            self._apply_intent(at_ms, intent, request)

    def _offer_ride(self, at_ms: int, request: dict[str, Any], to_actor: str,
                    disclosure: dict[str, Any]) -> None:
        request["askedHelpers"].append(to_actor)
        rider = request["subjectId"]
        depart_ms = max(at_ms, request["departByMs"])
        plan = self._ride_plan(to_actor, rider, depart_ms, request["destination"])

        offered = self._emit(
            at_ms, EventType.request_offered, MEDIAL, request["id"],
            [MEDIAL, to_actor],
            {"requestId": request["id"], "toActorId": to_actor, "need": "transport",
             "subjectId": rider, "destination": request["destination"],
             "departByMs": depart_ms, "disclosure": disclosure,
             "detourMin": None if plan is None else plan["detour_min"],
             "feasible": plan is not None})
        self._record_disclosure(disclosure, to_actor)
        self.world.actors[to_actor].contacts_received += 1
        self.obs.record(self.attempt.id, to_actor, offered, "ride.offered",
                        subject_id=rider,
                        payload={"requestId": request["id"],
                                 "destination": request["destination"],
                                 "departByMs": depart_ms,
                                 "detourMin": None if plan is None else plan["detour_min"],
                                 "feasible": plan is not None})

        if plan is None:
            self._emit(at_ms, EventType.transport_conflict_detected, ENGINE,
                       request["id"], [MEDIAL, RESEARCHER, to_actor],
                       {"driverId": to_actor, "reason": "no_route",
                        "conflictWith": [],
                        "note": "도로망에서 픽업 경로를 찾지 못했다"})
            self._ask_next_driver(at_ms, request)
            return

        proposals = self._ask(to_actor, at_ms,
                              [ProposalAction.accept, ProposalAction.decline,
                               ProposalAction.defer])
        if not proposals:
            self._unresolved(at_ms, request, "요청을 받은 사람이 응답을 만들지 못했다")
            return
        proposal = proposals[0]

        reason = proposal.params.get("reason", "unspecified")
        if reason in ("does_not_drive", "driving_status_unknown"):
            self.ride_replies[to_actor] = "not_driving"
        elif proposal.action is ProposalAction.accept:
            self.ride_replies[to_actor] = "drives"

        if proposal.action is not ProposalAction.accept:
            etype = (EventType.request_deferred if proposal.action is ProposalAction.defer
                     else EventType.request_declined)
            extra = ({"untilMs": at_ms} if etype is EventType.request_deferred else {})
            self._emit(at_ms, etype, to_actor, request["id"], [MEDIAL, to_actor],
                       {"requestId": request["id"],
                        "rule": proposal.params.get("rule"),
                        **_yardstick(proposal.params),
                        "reason": proposal.params.get("reason", "unspecified"),
                        "utterance": proposal.utterance,
                        "evidenceRefs": proposal.evidenceRefs,
                        "note": "거절은 신뢰 하락으로 계산하지 않는다.", **extra})
            self._ask_next_driver(at_ms, request)
            return

        conflict = self.book.conflicts(
            to_actor, rider, depart_ms, plan["arrive_ms"], request["destination"])
        if conflict is not None:
            self._emit(at_ms, EventType.transport_conflict_detected, ENGINE,
                       request["id"], [MEDIAL, RESEARCHER, to_actor],
                       {"driverId": to_actor, "reason": conflict["reason"],
                        "conflictWith": conflict["conflictWith"],
                        "detail": conflict["detail"],
                        "note": ("본인은 수락했지만 이미 잡힌 예약과 겹쳐 좌석을 확정할 수 없다. "
                                 "수락을 취소로 기록하지 않는다.")})
            self._ask_next_driver(at_ms, request)
            return

        self._emit(at_ms, EventType.request_accepted, to_actor, request["id"],
                   [MEDIAL, to_actor],
                   {"requestId": request["id"], "params": proposal.params,
                    "utterance": proposal.utterance,
                    "evidenceRefs": proposal.evidenceRefs})
        self._book_ride(at_ms, request, to_actor, plan,
                        conditions=list(proposal.params.get("conditions", [])))

    def _ride_plan(self, driver_id: str, rider_id: str, depart_ms: int,
                   destination: str) -> dict[str, Any] | None:
        """Can this driver collect this rider, and what does the detour cost?

        The detour is the difference between driving straight to the destination
        and going via the rider's house - computed from the road graph, not
        assumed.
        """
        from .world import OFF_MAP_PLACES, leg

        driver_place = self.world.actors[driver_id].place_at(depart_ms)
        pickup_place = "HOME:" + rider_id
        # The driver may be mid-journey at that minute, so the pickup leg starts
        # from where the car actually is rather than from a named place. This is
        # also what stops a driver being teleported to the pickup point.
        x, y = self.world.position_of(driver_id, depart_ms)
        start_node = self.village.nearest_node(x, y)
        route = self.village.route(
            start_node, self.village.anchor_of_place(pickup_place, rider_id))
        if route is None:
            return None
        polyline, metres = route
        pickup_ms = depart_ms + self.village.travel_ms(metres, "drive")
        to_pickup = Segment(depart_ms, pickup_ms, "travel", "task", "픽업 이동",
                            from_place=driver_place, to_place=pickup_place,
                            mode="drive", metres=metres, polyline=polyline)
        try:
            with_rider = leg(self.village, driver_id, pickup_ms, pickup_place,
                             destination, True, None, "task", "동승 이동")
        except ValueError:
            return None

        if destination in OFF_MAP_PLACES:
            # Driving out of the village takes the same fixed time from anywhere
            # in it, so the whole detour is the time spent collecting the rider.
            direct_ms = self.village.off_map_town_ms()
            direct_m = 0.0
        else:
            direct = self.village.route(
                start_node, self.village.anchor_of_place(destination, driver_id))
            if direct is None:
                return None
            direct_m = direct[1]
            direct_ms = self.village.travel_ms(direct_m, "drive")

        via_ms = (pickup_ms - depart_ms) + (with_rider.end_ms - with_rider.start_ms)
        return {
            "to_pickup": to_pickup,
            "with_rider": with_rider,
            "pickup_ms": pickup_ms,
            "arrive_ms": with_rider.end_ms,
            "pickup_place": pickup_place,
            "detour_min": round(max(0, via_ms - direct_ms) / MIN_MS, 1),
            "detour_m": round(max(0.0, (metres + with_rider.metres) - direct_m), 1),
        }

    def _book_ride(self, at_ms: int, request: dict[str, Any], driver_id: str,
                   plan: dict[str, Any], conditions: list[str]) -> None:
        rider = request["subjectId"]
        return_depart = plan["arrive_ms"] + request["returnAfterMin"] * MIN_MS
        reservation = self.book.hold(
            request["id"], driver_id, rider, plan["to_pickup"].start_ms,
            plan["pickup_place"], request["destination"], conditions)
        self.book.reservations[reservation.id] = reservation.model_copy(
            update={"returnDepartMs": return_depart, "returnDriverId": driver_id})

        self._emit(at_ms, EventType.transport_reservation_made, driver_id, request["id"],
                   [MEDIAL, driver_id, rider, RESEARCHER],
                   {"requestId": request["id"], "reservationId": reservation.id,
                    "driverId": driver_id, "riderId": rider,
                    "seatIndex": reservation.seatIndex,
                    "departMs": int(plan["to_pickup"].start_ms),
                    "pickupPlace": plan["pickup_place"],
                    "destination": request["destination"],
                    "returnDepartMs": return_depart,
                    "detourMin": plan["detour_min"],
                    "detourM": plan["detour_m"],
                    "conditions": conditions,
                    "seatAssumption": self.book.seat_assumption})

        change = self.world.divert(
            driver_id, plan["to_pickup"].start_ms,
            [plan["to_pickup"], plan["with_rider"]], "동승 요청 수락")
        self._emit(at_ms, EventType.plan_modified, driver_id, request["id"],
                   [RESEARCHER, driver_id, MEDIAL],
                   {"actorId": driver_id, "change": change["reason"],
                    "insertedSegments": change["insertedSegments"],
                    "resumeSegments": change["resumeSegments"]})
        self._emit(at_ms, EventType.task_travel_started, driver_id, request["id"],
                   [MEDIAL, driver_id],
                   {"requestId": request["id"], "from": plan["to_pickup"].from_place,
                    "to": plan["pickup_place"], "mode": "drive",
                    "distanceM": round(plan["to_pickup"].metres, 1),
                    "durationMs": plan["to_pickup"].end_ms - plan["to_pickup"].start_ms,
                    "distanceBasis": "road-graph-shortest-path"})
        self._schedule(plan["pickup_ms"], "transport:pickup",
                       {"requestId": request["id"], "reservationId": reservation.id})
        self._schedule(plan["arrive_ms"], "transport:dropoff",
                       {"requestId": request["id"], "reservationId": reservation.id})
        self._schedule(return_depart, "transport:return",
                       {"requestId": request["id"], "reservationId": reservation.id})

    def _on_pickup(self, at_ms: int, payload: dict[str, Any]) -> None:
        reservation = self.book.reservations[payload["reservationId"]]
        if reservation.status == "cancelled":
            return
        request = self.requests[payload["requestId"]]

        # A held seat is not a person in a car. If the rider is not actually at
        # the pickup point, the reservation is cancelled here rather than left
        # holding a seat nobody is using.
        if self.world.place_of(reservation.riderId, at_ms) != reservation.pickupPlace:
            self._cancel_reservation(at_ms, reservation.id, "rider_not_at_pickup")
            self._unresolved(at_ms, request,
                             "약속한 시각에 픽업 장소에 없어 동승이 성사되지 않았다")
            return

        self.book.pick_up(reservation.id)

        # The rider is a passenger: their realized day now follows the car.
        ride = self.world.actors[reservation.driverId].segment_at(at_ms)
        if ride is not None and ride.kind == "travel":
            # Who is aboard is a fact about the vehicle, and the map draws seats
            # from it. Without this the car always looked empty.
            if reservation.riderId not in ride.riders:
                ride.riders.append(reservation.riderId)
        rider_leg = Segment(at_ms, reservation.departMs, "stay", "task", "픽업 대기",
                            place=reservation.pickupPlace, request_id=request["id"])
        with_rider = self._rider_segment(at_ms, reservation, ride)
        self.world.divert(reservation.riderId, at_ms,
                          [s for s in (rider_leg, with_rider) if s.end_ms > s.start_ms],
                          "동승 이동")

        self._emit(at_ms, EventType.transport_pickup, reservation.driverId,
                   request["id"],
                   [MEDIAL, reservation.driverId, reservation.riderId, RESEARCHER],
                   {"reservationId": reservation.id, "riderId": reservation.riderId,
                    "driverId": reservation.driverId,
                    "place": reservation.pickupPlace})

    def _cancel_reservation(self, at_ms: int, reservation_id: str, reason: str) -> None:
        """Release the seat and say so in the log.

        The seat must actually come back: a cancelled reservation that still
        counts against the vehicle is how a resource model quietly starts
        refusing rides that were in fact possible.
        """
        reservation = self.book.cancel(reservation_id)
        self._emit(at_ms, EventType.transport_reservation_cancelled,
                   reservation.driverId, reservation.requestId,
                   [MEDIAL, reservation.driverId, reservation.riderId, RESEARCHER],
                   {"reservationId": reservation.id, "reason": reason,
                    "riderId": reservation.riderId, "driverId": reservation.driverId,
                    "note": "좌석은 즉시 반환된다. 취소된 예약은 자원을 붙잡지 않는다."})

    def _rider_segment(self, at_ms: int, reservation: Any,
                       driver_segment: Segment | None) -> Segment:
        if driver_segment is not None and driver_segment.kind == "travel":
            # The passenger is in that car, so their leg is the driver's leg -
            # same mode included. They used to differ ("drive" vs "offmap") for
            # one physical trip, which put the two of them in different places on
            # the map for the same thirty minutes.
            return Segment(at_ms, driver_segment.end_ms, "travel", "task", "동승 이동",
                           from_place=reservation.pickupPlace,
                           to_place=reservation.destination,
                           mode=driver_segment.mode,
                           metres=driver_segment.metres,
                           polyline=driver_segment.polyline,
                           request_id=reservation.requestId,
                           riders=[])
        return Segment(at_ms, at_ms, "stay", "task", "동승 대기",
                       place=reservation.pickupPlace, request_id=reservation.requestId)

    def _on_dropoff(self, at_ms: int, payload: dict[str, Any]) -> None:
        reservation = self.book.reservations[payload["reservationId"]]
        if reservation.status == "cancelled":
            return
        request = self.requests[payload["requestId"]]
        self._emit(at_ms, EventType.transport_dropoff, reservation.driverId,
                   request["id"],
                   [MEDIAL, reservation.driverId, reservation.riderId, RESEARCHER],
                   {"reservationId": reservation.id, "riderId": reservation.riderId,
                    "driverId": reservation.driverId,
                    "place": reservation.destination,
                    "note": ("도착은 이동 필요가 해결된 것이며 용무나 진료의 결과가 아니다.")})
        self.world.divert(
            reservation.riderId, at_ms,
            [Segment(at_ms, at_ms + request["returnAfterMin"] * MIN_MS, "stay", "task",
                     request["purpose"], place=reservation.destination,
                     request_id=request["id"])],
            "목적지 체류")

    def _on_return_trip(self, at_ms: int, payload: dict[str, Any]) -> None:
        """The way back is a second booking, not an assumption that it happens."""
        reservation = self.book.reservations[payload["reservationId"]]
        if reservation.status == "cancelled":
            return
        request = self.requests[payload["requestId"]]
        driver_id = reservation.returnDriverId or reservation.driverId
        from .world import leg

        try:
            back = leg(self.village, driver_id, at_ms, reservation.destination,
                       reservation.pickupPlace, True, None, "task", "귀가 동승")
        except ValueError:
            self._unresolved(at_ms, request, "귀가 경로를 찾지 못했다")
            return

        # The way home is one car with one passenger in it, and the two actors
        # need *separate* segment objects: handing the same object to both
        # diversions makes them share one ``riders`` list, so whatever the map
        # reads for the driver it also reads for the passenger.
        #
        # The outbound leg records who is aboard and the return leg did not, so
        # the car showed up empty on the way home while the reservation and the
        # events said a rider was in it.
        driver_leg = back.clone(riders=[reservation.riderId])
        rider_leg = back.clone(riders=[])
        self.world.divert(driver_id, at_ms, [driver_leg], "귀가 동승")
        self.world.divert(reservation.riderId, at_ms, [rider_leg], "귀가 동승")
        self._emit(at_ms, EventType.transport_pickup, driver_id, request["id"],
                   [MEDIAL, driver_id, reservation.riderId, RESEARCHER],
                   {"reservationId": reservation.id, "riderId": reservation.riderId,
                    "driverId": driver_id, "place": reservation.destination})
        self._schedule(back.end_ms, "transport:home",
                       {"requestId": request["id"], "reservationId": reservation.id})

    def _on_ride_home(self, at_ms: int, payload: dict[str, Any]) -> None:
        reservation = self.book.reservations[payload["reservationId"]]
        request = self.requests[payload["requestId"]]
        self.book.complete(reservation.id)
        self._emit(at_ms, EventType.transport_dropoff, reservation.driverId,
                   request["id"],
                   [MEDIAL, reservation.driverId, reservation.riderId, RESEARCHER],
                   {"reservationId": reservation.id, "riderId": reservation.riderId,
                    "driverId": reservation.returnDriverId or reservation.driverId,
                    "place": reservation.pickupPlace, "leg": "return"})
        self._resolve(at_ms, request, outcome="ride_completed",
                      path="neighbour_ride", by=reservation.driverId)

    # -- closure --------------------------------------------------------------
    def _resolve(self, at_ms: int, request: dict[str, Any], outcome: str, path: str,
                 by: str | None = None) -> None:
        if request.get("closed"):
            return
        request["closed"] = True
        request["resolvedMs"] = at_ms
        request["outcome"] = outcome
        request["resolutionPath"] = path
        # When the work was relayed, MEDial is told by the person it asked. That
        # is not a distortion of the log - it is what MEDial actually hears - and
        # the researcher-only event below names who really went.
        relayed_to = request.get("relayedTo")
        reported_by = request.get("reportedBy") if relayed_to == by else None
        credited = reported_by or by
        visibility = sorted({MEDIAL, request["subjectId"], RESEARCHER,
                             *([credited] if credited else []),
                             *([by] if by else [])})
        self._emit(at_ms, EventType.need_resolved, MEDIAL, request["id"], visibility,
                   {"requestId": request["id"], "subjectId": request["subjectId"],
                    "outcome": outcome, "resolutionPath": path, "byActorId": credited,
                    "note": "확인이 끝났다는 뜻이며 건강 문제가 없다는 임상 판정이 아니다."})
        if reported_by is not None and by is not None and reported_by != by:
            self._emit(at_ms, EventType.world_relay_resolved, ENGINE, request["id"],
                       [RESEARCHER],
                       {"requestId": request["id"], "reportedBy": reported_by,
                        "performedBy": by, "chain": self.relay_chains.get(request["id"], []),
                        "note": ("연구자 전용. MEDial은 부탁받은 사람이 했다고 알고 있고, "
                                 "실제로 간 사람은 다른 사람이다.")})

    def _unresolved(self, at_ms: int, request: dict[str, Any], reason: str) -> None:
        if request.get("closed"):
            return
        # A dead end is not the end while an escalation deadline is still
        # pending. Closing here would make escalateToInstitutionAfterMin useless
        # in exactly the case it exists for: nobody local could go, so the case
        # should sit with MEDial until the deadline hands it to the institution.
        pending = self._escalation_pending(at_ms, request)
        if pending is not None:
            self._emit(at_ms, EventType.medial_waiting, MEDIAL, request["id"],
                       [MEDIAL, RESEARCHER],
                       {"reason": "awaiting_escalation_deadline", "untilMs": pending,
                        "detail": reason,
                        "note": "지금은 갈 사람이 없다. 인계 기한까지 열어 둔 채 기다린다."})
            return
        request["closed"] = True
        request["outcome"] = "unresolved"
        self._emit(at_ms, EventType.need_unresolved, MEDIAL, request["id"],
                   [MEDIAL, RESEARCHER],
                   {"requestId": request["id"], "subjectId": request["subjectId"],
                    "reason": reason})

    def _escalation_pending(self, at_ms: int, request: dict[str, Any]) -> int | None:
        """When the standing escalation deadline will fire, if it still can."""
        limit = self.policy_revision.params.escalateToInstitutionAfterMin
        if limit is None or request.get("escalated"):
            return None
        due = int(request["raisedMs"]) + limit * MIN_MS
        if due <= at_ms or due > self.deck.horizonMs:
            return None
        return due

    def _on_finalize(self, at_ms: int, payload: dict[str, Any]) -> None:
        for request in self.requests.values():
            if not request.get("closed"):
                self._unresolved(at_ms, request, "관측 구간이 끝날 때까지 확인되지 않았다")
        self._emit(at_ms, EventType.attempt_completed, ENGINE, "world", [RESEARCHER],
                   {"horizonMs": self.deck.horizonMs})

    # -- helpers ---------------------------------------------------------------
    def _ensure_request(self, at_ms: int, subject: str) -> dict[str, Any]:
        existing = next((r for r in self.requests.values()
                         if r["subjectId"] == subject and not r.get("closed")
                         and r["need"] == "welfare_check"), None)
        if existing:
            return existing
        request_id = "req-%s-1" % subject
        if request_id in self.requests:
            return self.requests[request_id]
        request = {"id": request_id, "subjectId": subject, "need": "welfare_check",
                   "raisedMs": at_ms, "contactAttempts": 0, "closed": False,
                   "lastContactMs": at_ms}
        self.requests[request_id] = request

        try:
            classified = self.policy.classify(self._context(at_ms, subject, request, 1))
        except AdapterError as exc:
            # The head could not read the situation. The request still exists
            # - a missed check-in is a fact - and the reading is recorded as
            # the failure it was, never as "unconfirmed, all fine".
            self.adapter_failures.append({"actorId": MEDIAL, "atMs": at_ms,
                                          "error": str(exc)})
            classified = MedialPolicy(self.policy_revision, VILLAGE_HEAD_ID).classify(
                self._context(at_ms, subject, request, 1))
            classified["rationale"] = "MEDial 머리(모델)가 상황을 읽지 못했다: %s" % exc
            classified["source"] = "adapter_error"
        self._emit(at_ms, EventType.medial_classified, MEDIAL, request_id, [MEDIAL],
                   {"classification": classified["classification"],
                    "rationale": classified["rationale"],
                    "clinicalStatus": classified["clinicalStatus"],
                    "locationStatus": classified["locationStatus"],
                    "emergencyEvidence": classified["emergencyEvidence"],
                    "emergencyEvidenceNote": classified["emergencyEvidenceNote"],
                    "subjectId": subject,
                    **({"summary": classified["summary"]} if classified.get("summary") else {}),
                    **({"source": classified["source"]} if classified.get("source") else {})})
        self._emit(at_ms, EventType.request_raised, MEDIAL, request_id,
                   [MEDIAL, RESEARCHER],
                   {"requestId": request_id, "subjectId": subject, "need": "welfare_check"})
        self._arm_escalation(request)
        return request

    def _context(self, at_ms: int, subject: str, request: dict[str, Any],
                 attempt_number: int) -> PolicyContext:
        medial_obs = self.obs.for_actor(MEDIAL, at_ms)
        return PolicyContext(
            sim_time_ms=at_ms,
            subject_id=subject,
            request_id=request["id"],
            attempt_number=attempt_number,
            routines=self.routines[MEDIAL],
            village_head_id=VILLAGE_HEAD_ID,
            horizon_ms=self.deck.horizonMs,
            raised_ms=int(request.get("raisedMs", at_ms)),
            last_contact_ms=int(request.get("lastContactMs", at_ms)),
            observation_ids=[o.id for o in medial_obs],
            known_facts=_known_facts(subject, request, attempt_number))

    def _commit_decision(self, at_ms: int, decision: DecisionRecord,
                         request: dict[str, Any]) -> None:
        # Numbered by the engine, not by the policy object: a checkpoint fork
        # swaps the policy mid-run and a per-policy counter would restart, so
        # two different decisions would land on the same id.
        decision = decision.model_copy(update={
            "attemptId": self.attempt.id,
            "id": "dec-%d" % (len(self.decisions) + 1)})
        self.decisions.append(decision)
        self._emit(at_ms, EventType.medial_decided, MEDIAL, request["id"], [MEDIAL],
                   {"decisionId": decision.id, "question": decision.question,
                    "chosen": decision.chosen, "rationale": decision.rationale,
                    "policyId": self.policy_revision.id,
                    "excluded": [c.model_dump() for c in decision.candidates
                                 if not c.included]})
        self.trace.append({"atMs": at_ms, "decisionId": decision.id,
                           "question": decision.question, "chosen": decision.chosen,
                           "policyId": self.policy_revision.id})

    def _ask(self, actor_id: str, at_ms: int, allowed: list[ProposalAction]) -> list[Any]:
        adapter = self._adapters.get(actor_id)
        if adapter is None:
            return []
        view = self._view(actor_id, at_ms)
        try:
            proposals = adapter.propose(view, allowed)
        except AdapterError as exc:
            # An adapter failure is an engine fault, never a resident action.
            self.adapter_failures.append({"actorId": actor_id, "atMs": at_ms,
                                          "error": str(exc)})
            self._emit(at_ms, EventType.medial_waiting, MEDIAL, "adapter",
                       [MEDIAL, RESEARCHER],
                       {"reason": "adapter_error", "untilMs": at_ms, "actorId": actor_id,
                        "detail": str(exc),
                        "note": "모델·어댑터 장애이며 주민의 거절이나 무응답이 아니다."})
            return []

        open_ids = {r["id"] for r in self.requests.values() if not r.get("closed")}
        checked = []
        for proposal in proposals:
            try:
                validate_proposal(proposal, actor_id=actor_id,
                                  attempt_id=self.attempt.id, allowed=set(allowed),
                                  open_request_ids=open_ids,
                                  known_observation_ids=view.observation_ids)
            except ProposalRejection as exc:
                # A rejected proposal is an adapter fault too: it never becomes
                # an event, and it is never written down as what the person did.
                self.rejected_proposals.append(
                    {"actorId": actor_id, "atMs": at_ms, "error": str(exc)})
                self._emit(at_ms, EventType.medial_waiting, MEDIAL, "adapter",
                           [MEDIAL, RESEARCHER],
                           {"reason": "proposal_rejected", "untilMs": at_ms,
                            "actorId": actor_id, "detail": str(exc),
                            "note": "검증에 실패한 제안이며 주민의 행동으로 기록하지 않는다."})
                continue
            checked.append(proposal)
        return checked

    def _view(self, actor_id: str, at_ms: int) -> ActorView:
        runtime = self.world.actors.get(actor_id)
        segment = runtime.segment_at(at_ms) if runtime else None
        persona = self.personas.get(actor_id)
        return ActorView(
            actor_id=actor_id,
            sim_time_ms=at_ms,
            observations=self.obs.for_actor(actor_id, at_ms),
            own_place=runtime.place_at(at_ms) if runtime else None,
            own_activity=segment.label if segment else None,
            own_interruptible=bool(segment
                                   and segment.interruptible_under(self.environment)),
            commitments=[s.as_dict(environment=self.environment)
                         for s in (runtime.realized if runtime else [])
                         if s.request_id and s.start_ms >= at_ms],
            shared_routine=self.routines.get(actor_id, {}),
            contacts_received_today=runtime.contacts_received if runtime else 0,
            local_knowledge=self._local_knowledge(actor_id, at_ms),
            # The health-centre worker is not a villager and has no position on
            # the map, so there is nobody standing next to them.
            nearby=(self.world.actors_at(runtime.place_at(at_ms), at_ms,
                                         exclude=actor_id)
                    if runtime is not None
                    and self.environment.interaction.copresenceEnabled else []),
            relations=[{"actorId": self.relations.other(e, actor_id),
                        "kind": e.kind, "reason": e.reason}
                       for e in self.relations.neighbours(actor_id)],
            persona=persona.model_dump(mode="json") if persona is not None else {},
            reservations=[r.model_dump(mode="json")
                          for r in self.book.held_for(actor_id)],
            policy={"helperContactCap": self.policy_revision.params.helperContactCap,
                    "maxRideDetourMin": self.policy_revision.params.maxRideDetourMin},
            resources=self.resources.model_dump())

    def _local_knowledge(self, actor_id: str, at_ms: int) -> list[dict[str, Any]]:
        """The village head's own place-level memory of his neighbours' days.

        This is *his* knowledge, held as a ``place_level`` routine that MEDial
        does not have. It is an inference from what people usually do, never a
        live position, and it reaches MEDial only if he reports it.
        """
        from .observations import routine_place

        held = self.routines.get(actor_id) or {}
        if actor_id != VILLAGE_HEAD_ID or not held:
            return []
        out = []
        for subject_id, routine in sorted(held.items()):
            place = routine_place(routine, at_ms)
            if place in ("FARM", "PORT", "SEA"):
                out.append({"subjectId": subject_id, "place": place,
                            "basis": "평소 일과에 대한 지역 지식"})
        return out

    def _record_disclosure(self, disclosure: dict[str, Any] | None, recipient: str) -> None:
        if not disclosure:
            return
        fields = disclosure.get("fields") or []
        if not fields:
            return
        self.disclosures.append({
            "recipient": recipient,
            "recipientClass": disclosure.get("recipientClass", "unknown"),
            "subjectId": disclosure.get("subjectId"),
            "fieldCount": len(fields),
            "fields": list(fields)})


def _yardstick(params: dict[str, Any]) -> dict[str, Any]:
    """What the source-backed decline table would have said, when a model
    resident answered. Recorded beside the answer, never applied (D082)."""
    if "ruleTableSaid" not in params:
        return {}
    return {"ruleTableSaid": params["ruleTableSaid"],
            "agreesWithRuleTable": params.get("agreesWithRuleTable")}


def _clock(ms: int) -> str:
    total = max(0, ms // MIN_MS)
    return "%02d:%02d" % (total // 60, total % 60)


def _known_facts(subject: str, request: dict[str, Any], attempt_number: int) -> list[str]:
    """What MEDial can state at a decision, in the words of the need it is for.

    A transport request read "P9에게 0회 연락했고 응답이 없다", which is not what
    happened: nobody had failed to answer, the person needs a ride. Saying it that
    way in a decision record misrepresents the evidence the decision rested on.
    """
    unknown_position = "MEDial은 %s의 현재 위치를 알지 못한다" % subject
    if request.get("need") == "transport":
        return [
            "%s에게 오늘 %s까지 이동할 일이 있다고 접수되었다"
            % (subject, request.get("destination", "목적지")),
            "MEDial은 누가 운전할 수 있는지, 차에 자리가 있는지 알지 못한다",
            unknown_position,
        ]
    if attempt_number <= 0:
        return ["%s에 대한 확인이 접수되었다" % subject, unknown_position]
    return [
        "%s에게 %d회 연락했고 응답이 없다" % (subject, attempt_number),
        unknown_position,
    ]
