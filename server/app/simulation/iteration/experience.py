"""What one actor is allowed to review over, and whether a review stayed inside it.

The review boundary is the observation boundary applied after the fact. An actor
reviews the day it experienced: the events addressed to it, its own persona
evidence, and its own recorded burden. It does not get the aggregate metrics, the
other residents' reviews, the world's hidden reasons, or the outcome of any other
attempt.

Building the experience set from the *stored* log rather than from a live engine
is deliberate: a review produced after a restart has to see exactly what a review
produced at run time saw, or the two are not comparable.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..contracts import HEALTH_DIRECTOR, HEALTH_STAFF, RESEARCHER
from .contracts import AgentReview, UsageStatus

#: Roles that get a review of their own. MEDial is not one of them: it is the
#: thing being reviewed, and letting it grade itself would put the orchestrator's
#: own account into the evidence for changing the orchestrator.
REVIEWABLE_INSTITUTION_ACTORS = (HEALTH_STAFF,)

_ROLE_BY_ACTOR = {
    HEALTH_STAFF: "health_staff",
    HEALTH_DIRECTOR: "health_director",
}

VILLAGE_HEAD_ID = "P6"


class ReviewBoundaryError(ValueError):
    """A review cited something the actor could not have known.

    Raised rather than trimmed: a model that cites another resident's private
    event has produced an invalid review, and quietly deleting the citation
    would leave the sentence it justified standing.
    """


@dataclass
class ActorExperience:
    """Everything an adapter may see when writing one actor's review."""

    actor_id: str
    role: str
    attempt_id: str
    policy_revision_id: str
    cycle_end_ms: int
    events: list[dict[str, Any]] = field(default_factory=list)
    evidence: list[dict[str, Any]] = field(default_factory=list)
    burden: dict[str, Any] = field(default_factory=dict)
    persona: dict[str, Any] = field(default_factory=dict)
    #: What this actor was actually told, as opposed to what the policy says.
    #: A resident who was never contacted knows nothing about the disclosure
    #: setting, and their review must not reason about it.
    policy_information_received: list[dict[str, Any]] = field(default_factory=list)
    usage_status: UsageStatus = UsageStatus.no_experience

    @property
    def event_ids(self) -> list[str]:
        return [e["id"] for e in self.events]

    @property
    def evidence_ids(self) -> set[str]:
        return {c["id"] for c in self.evidence}

    def kinds(self) -> set[str]:
        return {e["type"] for e in self.events}

    def of_type(self, *types: str) -> list[dict[str, Any]]:
        wanted = set(types)
        return [e for e in self.events if e["type"] in wanted]

    def seq_of(self, event_id: str) -> int | None:
        for event in self.events:
            if event["id"] == event_id:
                return int(event["seq"])
        return None


def actor_role(actor_id: str, village_head_id: str = VILLAGE_HEAD_ID) -> str:
    if actor_id in _ROLE_BY_ACTOR:
        return _ROLE_BY_ACTOR[actor_id]
    if actor_id == village_head_id:
        return "village_head"
    return "resident"


def _usage_status(actor_id: str, events: list[dict[str, Any]]) -> UsageStatus:
    """Did this person meet the service, and how far did it get?

    ``not_offered`` and ``no_experience`` are outcomes to report, not failures to
    score. A resident nobody contacted has nothing to be dissatisfied about.
    """
    if not events:
        return UsageStatus.no_experience

    types = {e["type"] for e in events}
    addressed_to_me = [
        e for e in events
        if e["payload"].get("toActorId") == actor_id
        or e["payload"].get("riderId") == actor_id
        or e["payload"].get("subjectId") == actor_id
        or e["payload"].get("driverId") == actor_id
    ]

    used = {
        "task.check_performed", "task.completed", "transport.pickup",
        "transport.dropoff", "institution.review_completed", "contact.answered",
    }
    if any(e["type"] in used for e in addressed_to_me):
        return UsageStatus.used
    if any(e["type"] == "need.resolved" for e in events):
        # The need closed and this actor was in the visibility list for it.
        return UsageStatus.used
    if any(e["type"] == "request.declined" and e["actorId"] == actor_id for e in events):
        return UsageStatus.offered_declined
    if any(e["type"] == "contact.no_response" and e["payload"].get("toActorId") == actor_id
           for e in events):
        return UsageStatus.offered_no_response
    if "request.offered" in types or "handoff.requested" in types:
        return UsageStatus.offered_unfulfilled
    if not addressed_to_me:
        return UsageStatus.not_offered
    return UsageStatus.offered_unfulfilled


def build_experience(actor_id: str, *, attempt: dict[str, Any],
                     events: list[dict[str, Any]], metrics: dict[str, Any],
                     persona: dict[str, Any] | None,
                     cycle_end_ms: int,
                     village_head_id: str = VILLAGE_HEAD_ID) -> ActorExperience:
    """Project the stored log down to one actor's experience.

    The filter is the event's own ``visibility`` list, which is the same rule the
    engine used at run time. World-truth events name only the researcher, so no
    amount of filtering here can hand a resident the reason a call was missed.
    """
    mine = [
        e for e in events
        # The event's own visibility list is the rule the engine ran under, and
        # an event addressed only to the researcher never enters anyone's
        # experience however it is filtered.
        if actor_id in e.get("visibility", [])
        and e.get("visibility") != [RESEARCHER]
        and int(e["simTimeMs"]) <= cycle_end_ms
    ]

    burden = (metrics.get("residentBurden") or {}).get(actor_id, {})
    told = [
        {"eventId": e["id"], "seq": e["seq"], "atMs": e["simTimeMs"], "type": e["type"],
         "purpose": e["payload"].get("purpose"),
         "disclosure": e["payload"].get("disclosure")}
        for e in mine
        if e["payload"].get("disclosure") and (
            e["payload"].get("toActorId") == actor_id
            or (e["payload"].get("disclosure") or {}).get("subjectId") == actor_id)
    ]

    return ActorExperience(
        actor_id=actor_id,
        role=actor_role(actor_id, village_head_id),
        attempt_id=attempt["id"],
        policy_revision_id=attempt["policyId"],
        cycle_end_ms=cycle_end_ms,
        events=mine,
        evidence=list((persona or {}).get("evidence", [])),
        burden=burden,
        persona=persona or {},
        policy_information_received=told,
        usage_status=_usage_status(actor_id, mine),
    )


def build_all_experiences(*, attempt: dict[str, Any], events: list[dict[str, Any]],
                          metrics: dict[str, Any], personas: dict[str, Any],
                          resident_ids: list[str], cycle_end_ms: int,
                          village_head_id: str = VILLAGE_HEAD_ID,
                          ) -> dict[str, ActorExperience]:
    """One experience set per resident plus the institution desk.

    Every actor gets one, including the ones nothing happened to: doc 13 asks for
    a review from all of them, with ``no_experience`` where that is the answer.
    """
    out: dict[str, ActorExperience] = {}
    for actor_id in list(resident_ids) + list(REVIEWABLE_INSTITUTION_ACTORS):
        out[actor_id] = build_experience(
            actor_id, attempt=attempt, events=events, metrics=metrics,
            persona=personas.get(actor_id), cycle_end_ms=cycle_end_ms,
            village_head_id=village_head_id)
    return out


def validate_review(review: AgentReview, experience: ActorExperience) -> None:
    """Refuse a review that steps outside the actor's own experience.

    This is the check that keeps a model-written review honest. It runs on rule
    output too - the rule reviewer has to obey exactly the same boundary, or the
    boundary is a description of the LLM path rather than a property of the
    system.
    """
    if review.actorId != experience.actor_id:
        raise ReviewBoundaryError(
            "review claims actor %r but was produced for %r"
            % (review.actorId, experience.actor_id))
    if review.attemptId != experience.attempt_id:
        raise ReviewBoundaryError(
            "review belongs to attempt %r, not %r"
            % (review.attemptId, experience.attempt_id))

    allowed_events = set(experience.event_ids)
    allowed_evidence = experience.evidence_ids

    unknown = [e for e in review.experiencedEventIds if e not in allowed_events]
    if unknown:
        raise ReviewBoundaryError(
            "%s cites events it did not experience: %s" % (review.actorId, unknown[:5]))

    for index, item in enumerate(review.items):
        bad_events = [e for e in item.eventRefs if e not in allowed_events]
        if bad_events:
            raise ReviewBoundaryError(
                "%s item %d (%s) cites events outside its experience: %s"
                % (review.actorId, index, item.dimension.value, bad_events[:5]))
        bad_evidence = [c for c in item.evidenceRefs if c not in allowed_evidence]
        if bad_evidence:
            raise ReviewBoundaryError(
                "%s item %d (%s) cites evidence cards that are not its own: %s"
                % (review.actorId, index, item.dimension.value, bad_evidence[:5]))
        if item.assessment != "unknown" and not item.eventRefs:
            raise ReviewBoundaryError(
                "%s item %d (%s) is graded %s with no event behind it; "
                "an ungrounded opinion must be 'unknown'"
                % (review.actorId, index, item.dimension.value, item.assessment))

    bad_evidence = [c for c in review.evidenceRefs if c not in allowed_evidence]
    if bad_evidence:
        raise ReviewBoundaryError(
            "%s cites evidence cards that are not its own: %s"
            % (review.actorId, bad_evidence[:5]))

    if experience.usage_status is UsageStatus.no_experience:
        graded = [i for i in review.items if i.assessment != "unknown"]
        if graded:
            raise ReviewBoundaryError(
                "%s experienced nothing in this cycle, so it cannot grade %s"
                % (review.actorId, [i.dimension.value for i in graded]))
