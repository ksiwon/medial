"""Pydantic contracts. This module is the single source of truth for the
simulation domain; docs/research/contracts/domain.schema.json was the earlier
hand-written agreement and is kept as a compatibility target, not as the model.

Two rules are enforced here rather than left to convention:

* a DomainEvent carries an explicit ``visibility`` list, and nothing reads an
  event that is not addressed to it (see observations.py);
* every event type declares the payload keys it requires, so a policy cannot
  quietly emit a half-filled event.
"""
from __future__ import annotations

from enum import Enum
from typing import Any, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

#: Bumped whenever the engine can produce a different log from the same inputs.
#: The comparison treats it as a controlled input, so two runs that differ only
#: because the code changed are reported as *not* a controlled comparison rather
#: than as a policy effect. 0.2.0: observation projection, institution desk,
#: transport reservations, standing escalation deadline.
ENGINE_VERSION = "medial-sim/0.2.0"

MEDIAL = "MEDial"
HEALTH_DIRECTOR = "HC_DIRECTOR"
HEALTH_STAFF = "HC_NURSE"
EMS_DISPATCH = "EMS_DISPATCH"
EMS_CREW = "EMS_CREW"
RESEARCHER = "RESEARCHER"
ENGINE = "ENGINE"


class ActorRole(str, Enum):
    resident = "resident"
    orchestrator = "orchestrator"
    health_director = "health_director"
    health_staff = "health_staff"
    ems_dispatch = "ems_dispatch"
    ems_crew = "ems_crew"
    researcher = "researcher"
    engine = "engine"


class Channel(str, Enum):
    home_device = "home_device"
    phone = "phone"
    in_person = "in_person"
    institution_queue = "institution_queue"


class EventType(str, Enum):
    # world / truth -- never visible to MEDial
    world_actor_moved = "world.actor_moved"
    world_actor_arrived = "world.actor_arrived"
    world_day_started = "world.day_started"
    #: Why a call was or was not picked up. The *reason* lives in the world, so
    #: it is researcher-only; the actor who called learns "no answer", nothing more.
    world_reachability_resolved = "world.reachability_resolved"
    # channels
    contact_attempted = "contact.attempted"
    contact_no_response = "contact.no_response"
    contact_answered = "contact.answered"
    # orchestration
    medial_observed = "medial.observed"
    medial_classified = "medial.classified"
    medial_decided = "medial.decided"
    medial_waiting = "medial.waiting"
    # coordination
    request_raised = "request.raised"
    request_offered = "request.offered"
    request_accepted = "request.accepted"
    request_declined = "request.declined"
    request_deferred = "request.deferred"
    # transport coordination (T004)
    transport_need_raised = "transport.need_raised"
    transport_reservation_made = "transport.reservation_made"
    transport_reservation_cancelled = "transport.reservation_cancelled"
    transport_pickup = "transport.pickup"
    transport_dropoff = "transport.dropoff"
    transport_conflict_detected = "transport.conflict_detected"
    # execution
    task_started = "task.started"
    task_travel_started = "task.travel_started"
    task_travel_arrived = "task.travel_arrived"
    task_check_performed = "task.check_performed"
    task_completed = "task.completed"
    plan_modified = "plan.modified"
    # institutions
    handoff_requested = "handoff.requested"
    handoff_accepted = "handoff.accepted"
    institution_queued = "institution.queued"
    institution_review_started = "institution.review_started"
    institution_review_completed = "institution.review_completed"
    #: A checkpoint fork swapped the policy mid-run. Researcher-only: it is a
    #: fact about the experiment, not about the village.
    policy_switched = "policy.switched"
    # closure
    need_resolved = "need.resolved"
    need_unresolved = "need.unresolved"
    attempt_completed = "attempt.completed"


#: Payload keys that must be present for each event type.
EVENT_PAYLOAD_REQUIRED: dict[EventType, tuple[str, ...]] = {
    EventType.world_day_started: ("dayStartMs",),
    EventType.world_actor_moved: ("from", "to", "mode"),
    EventType.world_actor_arrived: ("place",),
    EventType.world_reachability_resolved: ("toActorId", "channel", "answered", "worldReason"),
    EventType.contact_attempted: ("channel", "toActorId", "purpose", "disclosure"),
    EventType.contact_no_response: ("channel", "toActorId"),
    EventType.contact_answered: ("channel", "toActorId", "reply"),
    EventType.medial_observed: ("observationKind", "subjectId"),
    EventType.medial_classified: ("classification", "rationale", "clinicalStatus",
                                  "locationStatus", "emergencyEvidence"),
    EventType.medial_decided: ("decisionId", "question", "chosen"),
    EventType.medial_waiting: ("reason", "untilMs"),
    EventType.request_raised: ("requestId", "subjectId", "need"),
    EventType.request_offered: ("requestId", "toActorId"),
    EventType.request_accepted: ("requestId",),
    EventType.request_declined: ("requestId", "reason"),
    EventType.request_deferred: ("requestId", "untilMs"),
    EventType.transport_need_raised: ("requestId", "subjectId", "destination", "need"),
    EventType.transport_reservation_made: ("requestId", "reservationId", "driverId",
                                           "riderId", "seatIndex", "departMs"),
    EventType.transport_reservation_cancelled: ("reservationId", "reason"),
    EventType.transport_pickup: ("reservationId", "riderId", "driverId", "place"),
    EventType.transport_dropoff: ("reservationId", "riderId", "driverId", "place"),
    EventType.transport_conflict_detected: ("driverId", "reason", "conflictWith"),
    EventType.task_started: ("requestId",),
    EventType.task_travel_started: ("requestId", "from", "to", "mode", "distanceM", "durationMs"),
    EventType.task_travel_arrived: ("requestId", "place"),
    EventType.task_check_performed: ("requestId", "subjectId", "outcome"),
    EventType.task_completed: ("requestId",),
    EventType.plan_modified: ("actorId", "change"),
    EventType.handoff_requested: ("requestId", "toActorId", "disclosure"),
    EventType.handoff_accepted: ("requestId",),
    EventType.institution_queued: ("requestId", "queueDepth"),
    EventType.institution_review_started: ("requestId",),
    EventType.institution_review_completed: ("requestId", "outcome"),
    EventType.policy_switched: ("fromPolicyId", "toPolicyId", "atSeq"),
    EventType.need_resolved: ("requestId", "subjectId", "outcome", "resolutionPath"),
    EventType.need_unresolved: ("requestId", "subjectId", "reason"),
    EventType.attempt_completed: ("horizonMs",),
}

#: Event types that describe ground truth. They exist so the researcher view and
#: the map can show what really happened; no in-world actor may observe them.
WORLD_TRUTH_EVENTS = frozenset({
    EventType.world_actor_moved,
    EventType.world_actor_arrived,
    EventType.world_day_started,
    EventType.world_reachability_resolved,
})

#: Payload value types, checked as well as presence. Without this a policy can
#: emit ``durationMs="25분"`` and nothing notices until a chart divides by it.
EVENT_PAYLOAD_TYPES: dict[str, type | tuple[type, ...]] = {
    "answered": bool,
    "attemptNumber": int,
    "callAtMs": int,
    "dayStartMs": int,
    "departMs": int,
    "distanceM": (int, float),
    "durationMs": int,
    "horizonMs": int,
    "queueDepth": int,
    "seatIndex": int,
    "untilMs": int,
    "atSeq": int,
    "fromPolicyId": str,
    "toPolicyId": str,
    "channel": str,
    "classification": str,
    "clinicalStatus": str,
    "locationStatus": str,
    "mode": str,
    "outcome": str,
    "place": str,
    "reason": str,
    "requestId": str,
    "reservationId": str,
    "resolutionPath": str,
    "subjectId": str,
    "toActorId": str,
    "driverId": str,
    "riderId": str,
    "disclosure": dict,
    "emergencyEvidence": list,
}


class Base(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class DomainEvent(Base):
    id: str
    attemptId: str
    seq: int = Field(ge=1)
    simTimeMs: int = Field(ge=0)
    type: EventType
    actorId: str
    causationId: str | None = None
    correlationId: str
    visibility: list[str]
    committed: Literal[True] = True
    payload: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_payload(self) -> "DomainEvent":
        required = EVENT_PAYLOAD_REQUIRED.get(self.type, ())
        missing = [k for k in required if k not in self.payload]
        if missing:
            raise ValueError(
                "event %s is missing payload keys %s" % (self.type.value, missing)
            )
        for key, value in self.payload.items():
            expected = EVENT_PAYLOAD_TYPES.get(key)
            if expected is None or value is None:
                continue
            # bool is a subclass of int; an int where a bool belongs is a bug.
            if expected is bool and not isinstance(value, bool):
                raise ValueError("event %s payload %r must be a bool, got %r"
                                 % (self.type.value, key, type(value).__name__))
            if expected is not bool and isinstance(value, bool) and expected is not str:
                raise ValueError("event %s payload %r must not be a bool"
                                 % (self.type.value, key))
            if not isinstance(value, expected):
                raise ValueError("event %s payload %r must be %s, got %r"
                                 % (self.type.value, key,
                                    getattr(expected, "__name__", expected),
                                    type(value).__name__))
        if self.type in WORLD_TRUTH_EVENTS and self.visibility != [RESEARCHER]:
            raise ValueError(
                "world-truth event %s must be visible to the researcher only"
                % self.type.value
            )
        return self


class Observation(Base):
    """What one actor is allowed to know, and when it stops being current."""

    id: str
    attemptId: str
    actorId: str
    simTimeMs: int
    kind: str
    subjectId: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    sourceEventId: str
    ttlMs: int | None = None
    confidence: Literal["observed", "reported", "assumed"] = "observed"


class ProposalAction(str, Enum):
    contact = "contact"
    retry_contact = "retry_contact"
    request_visit = "request_visit"
    accept = "accept"
    decline = "decline"
    defer = "defer"
    handoff = "handoff"
    wait = "wait"
    report_observation = "report_observation"
    resolve = "resolve"


class ActionProposal(Base):
    """An actor states what it wants. Nothing has happened yet."""

    id: str
    attemptId: str
    actorId: str
    simTimeMs: int
    action: ProposalAction
    targetActorId: str | None = None
    requestId: str | None = None
    channel: Channel | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    utterance: str | None = None
    observationIds: list[str] = Field(default_factory=list)
    evidenceRefs: list[str] = Field(default_factory=list)
    uncertainty: str | None = None
    source: Literal["rule", "scripted", "llm", "human"] = "rule"


class Candidate(Base):
    actorId: str
    included: bool
    reason: str


class DecisionRecord(Base):
    id: str
    attemptId: str
    simTimeMs: int
    policyId: str
    question: str
    candidates: list[Candidate]
    chosen: str | None
    rationale: str
    knownFacts: list[str] = Field(default_factory=list)
    observationIds: list[str] = Field(default_factory=list)
    excludedByPermission: list[str] = Field(default_factory=list)


class ContactStrategy(str, Enum):
    head_first = "head_first"
    retry_then_clinic = "retry_then_clinic"


class PolicyParams(Base):
    """Every field here is read by the engine.

    A condition the screen offers but the engine ignores is worse than a missing
    condition: the researcher concludes it made no difference. ``SUPPORTED`` is
    the list the API validates edits against, and anything outside it is rejected
    rather than silently stored.
    """

    retryCount: int = Field(
        default=0, ge=0, le=6,
        description="본인에게 다시 연락해 보는 횟수. 0이면 재연락하지 않는다.")
    retryIntervalMin: int = Field(
        default=40, ge=5, le=240,
        description="재연락 사이의 간격(분).")
    #: No contact is placed inside this window after the previous one, so a short
    #: retryInterval cannot produce three calls in ten minutes.
    quietWindowMin: int = Field(
        default=0, ge=0, le=240,
        description="같은 사람에게 연락을 다시 걸기까지 반드시 비워 두는 시간(분). "
                    "재연락 간격보다 길면 이쪽이 이긴다.")
    helperContactCap: int = Field(
        default=2, ge=0, le=10,
        description="한 사람이 하루에 받을 수 있는 조율 연락의 상한. 넘으면 거절한다. "
                    "연구자 설정이며 실제 수용 한계가 아니다.")
    #: ``minimal`` discloses only that a check-in went unanswered; ``named``
    #: additionally shares the attempt times and the consented routine.
    disclosure: Literal["minimal", "named"] = Field(
        default="minimal",
        description="공개 범위. minimal은 '응답 없음'만, named는 연락 시도 시각과 "
                    "(기관에는) 공개 동의된 평소 일과까지 함께 넘긴다.")
    #: Hand the case to the institution once this many minutes have passed since
    #: the request was raised, whatever the strategy would otherwise do next.
    escalateToInstitutionAfterMin: int | None = Field(
        default=None, ge=5, le=600,
        description="접수 후 이 시간(분)이 지나면 전략과 무관하게 기관으로 넘긴다. "
                    "비우면 기한 없음.")
    allowHeadContact: bool = Field(
        default=True,
        description="이장에게 확인을 요청할 수 있는지. head_first 전략에서는 꺼 둘 수 없다.")
    #: T004. Who is asked first for a ride: the neighbour whose own trip is
    #: closest in time and destination, or the relative the persona lists as a
    #: close contact.
    rideCandidateOrder: Literal["closest_first", "kin_first"] = "closest_first"
    #: A driver declines a ride that would add more than this to their own trip.
    #: The threshold is a researcher assumption; the *detour* is computed from
    #: the road graph.
    maxRideDetourMin: int = Field(default=20, ge=0, le=120)

    #: Editable through the policy editor. Kept next to the fields so the two
    #: cannot drift apart.
    SUPPORTED: ClassVar[tuple[str, ...]] = (
        "retryCount", "retryIntervalMin", "quietWindowMin", "helperContactCap",
        "disclosure", "escalateToInstitutionAfterMin", "allowHeadContact",
        "rideCandidateOrder", "maxRideDetourMin",
    )


class PolicyRevision(Base):
    id: str
    parentId: str | None
    coreItem: str
    label: str
    changes: list[str] = Field(default_factory=list)
    contactStrategy: ContactStrategy
    params: PolicyParams = Field(default_factory=PolicyParams)
    assumptionRefs: list[str] = Field(default_factory=list)


class ScenarioEvent(Base):
    id: str
    simTimeMs: int
    type: EventType
    subjectId: str
    initiallyVisibleTo: list[str]
    payload: dict[str, Any] = Field(default_factory=dict)
    hiddenTruth: str | None = None
    prohibitedInferences: list[str] = Field(default_factory=list)


class ScenarioDeck(Base):
    id: str
    label: str
    classification: Literal["source_adapted", "plausible_extension", "stress_test", "emergent"]
    assumptions: list[str]
    horizonMs: int
    events: list[ScenarioEvent]


class ResourceRevision(Base):
    """Institution capacity. None of these numbers are measured; they are the
    experiment assumptions listed in ``assumptions``."""

    id: str
    label: str
    staffCount: int = 1
    shiftStartMs: int
    shiftEndMs: int
    reviewMinutes: int = 20
    callMinutes: int = 5
    #: One way. A visit therefore costs ``2 x visitTravelMinutes + visitMinutes``
    #: of staff time. The field used to be described as a round trip in one place
    #: and billed as one way in another.
    visitTravelMinutes: int = 25
    visitMinutes: int = 20
    initialQueueDepth: int = 0
    #: Seats a private car is assumed to have. The persona source does not state
    #: this for anybody, so it is an experiment assumption and is reported as one
    #: everywhere a reservation is shown.
    assumedVehicleSeats: int = Field(default=3, ge=1, le=8)
    assumptions: list[str] = Field(default_factory=list)


class ReachabilityRule(Base):
    """Whether a channel reaches a person standing in a given place.

    This is a fact about the world, not about the person, which is why it lives
    here and not in a resident adapter. Swapping the rule adapter for a model
    must not change whether a phone rings in a field.

    ``provenance`` separates the one rule the source material actually records
    (P1 did not answer while out in the field) from the assumptions around it.
    """

    place: str
    channel: Channel
    reachable: bool
    provenance: Literal["source-adapted", "researcher-assumption"]
    reason: str


class RoutineVariation(Base):
    """How much a recorded day is allowed to differ from itself on a rerun.

    The source gives one day's departure times. Treating them as exact laws is a
    stronger claim than the data supports, so a run may jitter them. The jitter
    is *uncertainty about the record*, not a new claim that a resident varies.

    Every field here is a researcher setting. None of it is measured, so it is
    hashed into the attempt and shown next to any day it produced.
    """

    enabled: bool = True
    #: Symmetric bound in minutes on a source-recorded departure time.
    departJitterMin: int = Field(default=15, ge=0, le=120)
    #: Chance that one outing (home -> somewhere -> home) does not happen at all.
    #: The source records no frequency for this; the value is an experiment
    #: assumption and the resulting day is labelled ``plausible_extension``.
    skipOutingProbability: float = Field(default=0.15, ge=0.0, le=1.0)
    #: Chance of repeating an outing to a place already in this person's own
    #: baseline. New destinations are never invented, so this cannot move anyone
    #: anywhere the source did not already put them.
    repeatOutingProbability: float = Field(default=0.0, ge=0.0, le=1.0)
    #: Residents whose baseline is a single all-day step have nothing to vary.
    #: Varying them would be invention, so they are named and left alone.
    excludeSingleStepResidents: bool = True
    assumptions: list[str] = Field(default_factory=list)


class EnvironmentRevision(Base):
    """The world's rules, as a versioned artifact rather than module constants.

    Visibility, scheduling and dynamics used to sit in three different modules as
    literals, which meant two runs could disagree about when a phone is answered
    and still report identical input hashes. They are gathered here so that
    changing an assumption is visible as a different input.

    This is fixed case input. A Change Set may not edit it: MEDial must not be
    able to look better by making the world stop producing the problem. A
    researcher who wants different assumptions creates a new revision and runs a
    different experiment, which the comparison screen then reports as such.
    """

    EDITABLE_BY_CHANGE_SET: ClassVar[bool] = False

    id: str
    label: str
    #: Order in which same-timestamp work is drained, by pending kind.
    scheduling: dict[str, int]
    reachability: list[ReachabilityRule]
    variation: RoutineVariation = Field(default_factory=RoutineVariation)
    assumptions: list[str] = Field(default_factory=list)

    def priority(self, kind: str) -> int:
        try:
            return self.scheduling[kind]
        except KeyError:
            raise KeyError(
                "environment %s has no scheduling priority for %r" % (self.id, kind)
            ) from None

    def reaches(self, place: str, channel: Channel) -> ReachabilityRule:
        """Most specific match wins: exact place, then prefix, then default."""
        default: ReachabilityRule | None = None
        prefix: ReachabilityRule | None = None
        for rule in self.reachability:
            if rule.channel is not channel:
                continue
            if rule.place == place:
                return rule
            if rule.place == "*":
                default = rule
            elif rule.place.endswith("*") and place.startswith(rule.place[:-1]):
                prefix = rule
        chosen = prefix or default
        if chosen is None:
            raise KeyError(
                "environment %s has no reachability rule for %s over %s"
                % (self.id, place, channel.value)
            )
        return chosen


class StepChange(Base):
    """One edit the realization made to a recorded step, and why.

    Kept per step rather than summarised, because "P1 left 12 minutes late" is
    the kind of thing a reader has to be able to check against the source before
    believing anything the day produced.
    """

    index: int
    kind: Literal["jitter", "clamp", "skip_outing", "repeat_outing"]
    target: str
    beforeMs: int | None = None
    afterMs: int | None = None
    note: str


class ResidentDay(Base):
    """One person's realized day."""

    actorId: str
    steps: list[dict[str, Any]]
    changes: list[StepChange] = Field(default_factory=list)
    #: Set when this person was deliberately left alone. The reason is shown
    #: rather than hidden: a resident with no recorded routine is a gap in the
    #: data, and inventing one would be the opposite of what this tool is for.
    excludedReason: str | None = None


class DayRealization(Base):
    """The day a run actually took place on.

    The source records one day. Treating its departure times as exact laws is a
    stronger claim than the data supports, so a run may draw a nearby day from
    the same seed. This is uncertainty about the record, not a claim that a
    resident is erratic.

    It is a pure function of (village, environment, seed), which is what makes a
    controlled comparison work: a rerun and a fork inherit the parent's seed, so
    they land on the same day without anyone having to copy it. Changing the
    seed is an explicit decision to run a *different day*, and it shows up as a
    different input hash rather than as a policy effect.
    """

    id: str
    seed: int
    villageContentHash: str
    environmentRevisionId: str
    #: ``source_baseline`` - nothing was varied.
    #: ``source_jittered`` - only recorded times moved, within the stated bound.
    #: ``plausible_extension`` - an outing was dropped or repeated, which the
    #: source does not record the frequency of.
    classification: Literal["source_baseline", "source_jittered", "plausible_extension"]
    residents: list[ResidentDay]
    assumptions: list[str] = Field(default_factory=list)

    @property
    def changed_actor_ids(self) -> list[str]:
        return [day.actorId for day in self.residents if day.changes]


class AttemptMode(str, Enum):
    experiment = "experiment"
    source_replay = "source_replay"


class AttemptStatus(str, Enum):
    created = "created"
    running = "running"
    paused = "paused"
    completed = "completed"
    failed = "failed"


class ModelPolicy(Base):
    """Everything about a model call that changes the answer.

    Fixed case input, like the environment: a Change Set may not edit it. MEDial
    improving because the model got bigger is not MEDial improving, and the
    comparison screen has to be able to say the two runs asked the same model
    the same way.

    ``temperature`` is recorded but never trusted as a reproducibility mechanism.
    temperature=0 is not deterministic on any provider we can call, which is why
    reproducibility here comes from replaying recorded calls rather than from
    asking nicely.
    """

    EDITABLE_BY_CHANGE_SET: ClassVar[bool] = False

    modelId: str = "none"
    temperature: float = 0.0
    maxOutputTokens: int = 512
    #: Which prompt build this ran under. Bumped whenever the payload sent to the
    #: model changes shape, because an identical prompt hash across a prompt
    #: change would make two different questions look like the same one.
    promptRevisionId: str = "prompt-v1"
    #: ``record`` calls the provider and writes every call down. ``replay`` calls
    #: nothing: a prompt with no recorded answer is an adapter failure, never a
    #: quiet fresh call. ``off`` is the rule/scripted path, where no model exists.
    mode: Literal["off", "record", "replay"] = "off"


class ModelCallRecord(Base):
    """One model call, written down so the run can be replayed exactly.

    ``key`` is content-addressed - model, temperature, prompt revision, actor,
    that actor's call index and the prompt payload - and deliberately excludes
    wall-clock time, so re-running the same day produces the same keys.
    ``latencyMs`` and ``createdAt`` are recorded for cost accounting but are not
    part of the key for that reason.
    """

    key: str
    attemptId: str
    actorId: str
    callIndex: int
    simTimeMs: int
    modelId: str
    temperature: float
    promptRevisionId: str
    prompt: dict[str, Any]
    #: Raw provider text. Parsing happens in the adapter so that a parse fix can
    #: be re-applied to an old recording instead of requiring a fresh call.
    response: str | None = None
    status: Literal["ok", "error"] = "ok"
    error: str | None = None
    latencyMs: int | None = None
    createdAt: str | None = None
    #: ``live`` was answered by the provider during this attempt; ``replayed``
    #: came from a recording (the parent's, for a fork). A run whose calls are
    #: all replayed did not spend a token, and the screen must not imply it did.
    origin: Literal["live", "replayed"] = "live"


class AttemptLineage(str, Enum):
    """How this attempt relates to its parent.

    ``rerun`` and ``fork`` are different experiments and were conflated before:
    a rerun changes the policy and starts the day again from the initial state;
    a fork keeps everything that already happened up to ``parentSeq`` - state,
    memory, reservations, pending queue and the log prefix - and only then
    applies the new policy.
    """

    root = "root"
    rerun = "rerun"
    fork = "fork"


class Attempt(Base):
    id: str
    parentId: str | None = None
    #: Only a ``fork`` has one. A rerun starts from the initial state and says so
    #: by leaving this empty, instead of carrying a decorative number.
    parentSeq: int | None = None
    lineage: AttemptLineage = AttemptLineage.root
    label: str
    policyId: str
    scenarioDeckId: str
    personaRevisionId: str
    baselineRevisionId: str
    resourceRevisionId: str
    seed: int
    mode: AttemptMode = AttemptMode.experiment
    status: AttemptStatus = AttemptStatus.created
    engineVersion: str = ENGINE_VERSION
    adapter: Literal["rule", "scripted", "llm"] = "rule"
    #: Which world rules this run used. Defaulted so that attempts stored before
    #: the environment was extracted still load; they all ran on ``env-v1``.
    environmentRevisionId: str = "env-v1"
    #: Identifies the realized day (baseline + seeded variation). Two attempts
    #: may only be compared as a controlled pair when this matches.
    dayRealizationId: str | None = None
    #: Which model, asked how. Defaulted to the ``off`` policy so that attempts
    #: stored before this existed still load: they all ran on rules.
    modelPolicy: ModelPolicy = Field(default_factory=ModelPolicy)
    createdAt: str
    cursorSeq: int = 0
    eventCount: int = 0
    dataSource: str = "unknown"
    inputHashes: dict[str, str] = Field(default_factory=dict)


class ReviewDimension(Base):
    key: str
    assessment: Literal["positive", "mixed", "negative", "unknown"]
    reason: str


class ExperienceReview(Base):
    """Named 'simulated experience review', never 'satisfaction'.

    ``source`` separates a rule/LLM agent reflection from a researcher note and
    from an actual person. Nothing here may be reported as resident satisfaction.
    """

    id: str
    attemptId: str
    actorId: str
    source: Literal["simulated", "human", "researcher"]
    #: Written at the end of the day, over the whole day. The replay must not
    #: show it at 09:30 as if the person already felt it, so the screen files it
    #: under a retrospective panel rather than the timeline.
    scope: Literal["day_end_retrospective", "moment"] = "day_end_retrospective"
    experiencedEventIds: list[str]
    dimensions: list[ReviewDimension] = Field(default_factory=list)
    assessment: Literal["positive", "mixed", "negative", "unknown"]
    comment: str
    unknowns: list[str] = Field(default_factory=list)


class CommandName(str, Enum):
    play = "play"
    pause = "pause"
    step = "step"
    seek = "seek"
    cancel = "cancel"


class Command(Base):
    commandId: str
    name: CommandName
    seq: int | None = None


class ConsentStatus(str, Enum):
    """Whether the source establishes that a resident agreed to share something.

    The interviews describe a support worker calling and the village head
    checking, but they do not record anybody consenting to a coordination system
    holding their day. So almost everything here is ``assumed`` and says so on
    screen.
    """

    verified = "verified"      # the source records the agreement
    assumed = "assumed"        # the researcher assumed it; stated as an assumption
    unknown = "unknown"        # not established either way


class RoutineWindow(Base):
    startMs: int
    endMs: int
    atHome: bool
    #: Present only when the recipient is allowed place-level detail. MEDial is
    #: not: it receives ``atHome`` and nothing more.
    place: str | None = None


class SharedRoutine(Base):
    """What one actor may hold about another actor's day.

    Split from the baseline plan on purpose. MEDial gets ``windows`` with
    ``atHome`` only; the village head's place-level knowledge is his own private
    memory and reaches MEDial solely through a report he chooses to make.
    """

    subjectId: str
    holderId: str
    granularity: Literal["home_or_away", "place_level"]
    consent: ConsentStatus
    consentBasis: str
    windows: list[RoutineWindow] = Field(default_factory=list)
    caveat: str = "\ub3d9\uc758\ub41c \ud3c9\uc18c \uc77c\uacfc\uc774\uba70 \ud604\uc7ac \uc704\uce58\uac00 \uc544\ub2c8\ub2e4."


class EvidenceCard(Base):
    """One claim taken from the persona source, with a pointer back to it.

    ``kind`` is the distinction the research documents insist on: a fact stated
    in the interview, the researcher's reading of it, an assumption made to fill
    a gap, and an explicit unknown. Nothing here carries the source text itself;
    ``quoteHash`` lets a claim be matched back to the local file without copying
    interview material into the repository.
    """

    id: str
    subjectId: str
    kind: Literal["fact", "interpretation", "assumption", "unknown"]
    field: str
    claim: str
    pointer: str                      # RFC 6901 JSON pointer into the persona file
    sourceKind: str                   # interview | joint_interview | researcher_note | none
    confidence: Literal["high", "medium", "low"]
    quoteHash: str | None = None
    note: str | None = None


class PersonaProfile(Base):
    """The compiled, non-sensitive projection of one persona.

    Names, interview quotes and the role-play system prompt stay in the local
    source file. What crosses into the engine is behavioural structure plus the
    evidence cards that justify it.
    """

    subjectId: str
    revisionId: str
    displayName: str                  # "P1" style label, never the real name
    ageBand: str
    livesAlone: bool | None
    drivesSelf: bool | None
    hasVehicle: bool | None
    seatCapacity: int | None
    closeContacts: list[str] = Field(default_factory=list)
    groupLabel: str = "unknown"
    acceptanceConditions: list[str] = Field(default_factory=list)
    declineConditions: list[str] = Field(default_factory=list)
    unknowns: list[str] = Field(default_factory=list)
    evidence: list[EvidenceCard] = Field(default_factory=list)
    interviewBasis: str = "unknown"
    speechSource: Literal["rule", "source_quote", "llm"] = "rule"


class TransportReservation(Base):
    """A seat held in a specific vehicle at a specific time.

    A reservation is the thing that makes double-booking detectable: the driver
    has a finite number of seats and one position at a time, so a second request
    either fits into the same trip or conflicts with it.
    """

    id: str
    requestId: str
    driverId: str
    riderId: str
    seatIndex: int
    departMs: int
    pickupPlace: str
    destination: str
    returnDepartMs: int | None = None
    returnDriverId: str | None = None
    status: Literal["held", "picked_up", "completed", "cancelled"] = "held"
    conditions: list[str] = Field(default_factory=list)


class DesignFinding(Base):
    """What the researcher concluded from comparing attempts, and what they
    changed because of it. This is the link that makes the tool iterative rather
    than a pair of one-off runs."""

    id: str
    createdAt: str
    coreItem: str
    comparedAttemptIds: list[str]
    observation: str
    interpretation: str
    nextChange: str
    fromPolicyId: str
    resultingPolicyId: str | None = None
    resultingAttemptId: str | None = None
    author: Literal["researcher"] = "researcher"


class ProposalRejection(RuntimeError):
    """A proposal that fails validation is an engine fault, not an actor action."""


def validate_proposal(proposal: "ActionProposal", *, actor_id: str, attempt_id: str,
                      allowed: "Any",
                      open_request_ids: "set[str]",
                      known_observation_ids: "set[str]") -> None:
    """Check a proposal before the engine acts on it.

    An adapter - especially a model-backed one - can claim to be someone else,
    answer a request that does not exist, or cite an observation it was never
    given. Each of those is caught here rather than becoming a committed event.
    """
    if proposal.actorId != actor_id:
        raise ProposalRejection(
            "proposal claims actorId %r but was produced for %r"
            % (proposal.actorId, actor_id))
    if proposal.attemptId != attempt_id:
        raise ProposalRejection(
            "proposal belongs to attempt %r, not %r" % (proposal.attemptId, attempt_id))
    if proposal.action not in allowed:
        raise ProposalRejection(
            "action %s is not allowed here (allowed: %s)"
            % (proposal.action.value, [a.value for a in allowed]))
    if proposal.requestId is not None and proposal.requestId not in open_request_ids:
        raise ProposalRejection(
            "proposal refers to unknown or closed request %r" % proposal.requestId)
    unknown = [o for o in proposal.observationIds if o not in known_observation_ids]
    if unknown:
        raise ProposalRejection(
            "proposal cites observations %s that %s cannot see" % (unknown, actor_id))
