"""Outcome measures, and the simulated experience reviews.

Two separations are load-bearing:

* what actually happened in the log (this file, ``build_metrics``) is kept apart
  from what an agent says about its experience (``build_reviews``), and both are
  kept apart from anything a real person would say - which this build cannot
  produce at all and therefore reports as ``unknown``;
* a request that never closed is ``censored``, not a fast zero. Averages over
  successful requests only are labelled as such.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .contracts import (
    HEALTH_STAFF,
    MEDIAL,
    EventType,
    ExperienceReview,
    ReviewDimension,
)

if TYPE_CHECKING:  # pragma: no cover
    from .engine import Engine

MIN_MS = 60_000


def build_metrics(engine: "Engine") -> dict[str, Any]:
    requests = list(engine.requests.values())
    resolved = [r for r in requests if r.get("outcome") not in (None, "unresolved")]
    censored = [r for r in requests if r.get("outcome") in (None, "unresolved")]

    waits = [r["resolvedMs"] - r["raisedMs"] for r in resolved if "resolvedMs" in r]

    burden: dict[str, Any] = {}
    for actor_id, runtime in engine.world.actors.items():
        if runtime.task_ms == 0 and runtime.contacts_received == 0:
            continue
        burden[actor_id] = {
            "addedTaskMinutes": round(runtime.task_ms / MIN_MS, 1),
            "addedTravelMetres": round(runtime.task_metres, 1),
            "interruptions": runtime.interruptions,
            "contactsReceived": runtime.contacts_received,
            # Who did the asking. MEDial's ledger counts only the first column;
            # a neighbour pulled in by another neighbour is in the second and
            # MEDial never sees that row.
            "askedByMedial": runtime.asked_by_medial,
            "askedByNeighbour": runtime.asked_by_neighbour,
            "basis": "실현된 계획에서 baseline 대비 추가된 task 구간",
        }

    contacts_by_result = {"answered": 0, "no_response": 0}
    for event in engine.events:
        if event.type is EventType.contact_answered:
            contacts_by_result["answered"] += 1
        elif event.type is EventType.contact_no_response:
            contacts_by_result["no_response"] += 1

    disclosure_by_class: dict[str, dict[str, Any]] = {}
    for row in engine.disclosures:
        bucket = disclosure_by_class.setdefault(
            row["recipientClass"], {"recipients": set(), "fieldCount": 0})
        bucket["recipients"].add(row["recipient"])
        bucket["fieldCount"] += row["fieldCount"]
    disclosure = {
        cls: {"recipientCount": len(v["recipients"]), "fieldCount": v["fieldCount"]}
        for cls, v in sorted(disclosure_by_class.items())
    }

    # An emergency classification is one where MEDial actually held evidence
    # pointing that way. "No such evidence arrived" is not the same claim as
    # "an emergency was ruled out", and the second must never appear at all.
    emergency_events = [e for e in engine.events
                        if e.type is EventType.medial_classified
                        and e.payload.get("emergencyEvidence")]
    rule_out_claims = [e.id for e in engine.events
                       if "emergencyRuledOut" in e.payload]

    transport = _transport_metrics(engine)
    handovers = _handovers(engine)
    refusals = _refusals(engine)

    return {
        "requests": {
            "raised": len(requests),
            "resolved": len(resolved),
            "unresolved": len(censored),
            "outcomes": sorted({r.get("outcome", "open") for r in requests}),
            "resolutionPaths": sorted({r["resolutionPath"] for r in resolved
                                       if r.get("resolutionPath")}),
        },
        "waitMs": {
            "resolvedOnly": waits,
            "meanMinutesResolvedOnly": round(sum(waits) / len(waits) / MIN_MS, 1) if waits else None,
            "censoredCount": len(censored),
            "note": "미해결 건은 평균에 넣지 않고 censored로 센다.",
        },
        "contacts": {
            "attempts": len(engine.contacts),
            "byResult": contacts_by_result,
            "toSubject": sum(1 for c in engine.contacts
                             if c["to"] in {r["subjectId"] for r in requests}),
            "note": "무응답을 거절로 합치지 않는다.",
        },
        "residentBurden": burden,
        "neighbourMinutes": round(
            sum(r.task_ms for a, r in engine.world.actors.items()) / MIN_MS, 1),
        "institutionBurden": {
            **engine.desk.report(),
            "note": "인계는 업무 이전이므로 받는 쪽 시간을 따로 센다. 실험 가정 기반.",
        },
        "disclosure": disclosure,
        "transport": transport,
        "handovers": handovers,
        "refusals": refusals,
        "elicitation": _elicitation(engine),
        "safety": {
            "emergencyClassifications": len(emergency_events),
            "expected": 0,
            "emergencyRuleOutClaims": len(rule_out_claims),
            "note": ("무응답만으로는 응급 분류의 근거가 없다. 이 수치는 '응급이 아니라고 "
                     "판정한 횟수'가 아니라 '응급을 시사하는 관측이 있었던 횟수'다."),
        },
        "adapterFailures": len(engine.adapter_failures),
        "rejectedProposals": len(engine.rejected_proposals),
        "decisionCount": len(engine.decisions),
        "eventCount": len(engine.events),
    }


def _handovers(engine: "Engine") -> dict[str, Any]:
    """Work one resident passed to another, read from the committed log.

    Not from ``engine.relay_chains``: that list also holds the people MEDial
    asked in turn under ``neighbour_first``, and a request that went P10 → P11
    → P9 by MEDial asking each one is not a hand-off. Only ``request.relayed``
    is, and only the log says who finally did the work.
    """
    offered: dict[str, list[str]] = {}
    hops: dict[str, list[dict[str, Any]]] = {}
    performed: dict[str, str] = {}
    for event in engine.events:
        rid = event.payload.get("requestId")
        if not isinstance(rid, str):
            continue
        if event.type is EventType.request_offered:
            offered.setdefault(rid, []).append(event.payload["toActorId"])
        elif event.type is EventType.request_relayed:
            hops.setdefault(rid, []).append({
                "fromActorId": event.payload["fromActorId"],
                "toActorId": event.payload["toActorId"],
                "atMs": event.simTimeMs,
                "basis": event.payload.get("basis"),
                "relationKind": event.payload.get("relationKind"),
            })
        elif event.type is EventType.world_relay_resolved:
            performed[rid] = event.payload["performedBy"]

    rows = []
    for rid, chain in sorted(hops.items()):
        request = engine.requests.get(rid, {})
        rows.append({
            "requestId": rid,
            "subjectId": request.get("subjectId"),
            # The person MEDial's ledger credits: the one it asked, who said yes.
            "askedActorId": chain[0]["fromActorId"],
            "chain": [chain[0]["fromActorId"]] + [h["toActorId"] for h in chain],
            "hops": chain,
            # None when nobody went: the person it was handed to said no, and
            # MEDial still believes the first one accepted.
            "performedBy": performed.get(rid),
            "outcome": request.get("outcome") or "unresolved",
        })

    asked_by_medial = {a for a, r in engine.world.actors.items() if r.asked_by_medial}
    asked_by_neighbour = {a for a, r in engine.world.actors.items() if r.asked_by_neighbour}
    return {
        "count": len(rows),
        "rows": rows,
        "peopleAskedByMedial": sorted(asked_by_medial),
        "peopleAskedByNeighbour": sorted(asked_by_neighbour),
        "note": ("MEDial은 자기가 부탁한 사람이 수락했다고만 안다. 이웃끼리 넘긴 것과 "
                 "실제로 간 사람은 연구자 전용 기록이다."),
    }


def _elicitation(engine: "Engine") -> dict[str, Any]:
    """What this run's outcome rests on that the record does not fully back.

    Two lists: the ledger's gaps for the people this day actually involved
    (a question never asked of someone who was never contacted changes
    nothing), and the assumed facts a decision actually used.
    """
    from .ledger import STATUS_WORDS, TOPIC_WORDS, ElicitationStatus

    involved = sorted({r["subjectId"] for r in engine.requests.values()}
                      | {a for a, rt in engine.world.actors.items()
                         if rt.contacts_received or rt.task_ms})
    gaps = []
    for actor in involved:
        for topic in engine.ledger.gaps(actor):
            status = engine.ledger.status(actor, topic)
            gaps.append({"actorId": actor, "topic": topic, "status": status.value,
                         "text": "%s · %s: %s" % (actor, TOPIC_WORDS[topic],
                                                  STATUS_WORDS[ElicitationStatus(status)])})
    return {"ledgerId": engine.ledger.id, "involved": involved, "gaps": gaps,
            "leanedOn": list(engine.leaned_on),
            "note": "채록 공백은 '없음'이 아니라 '모름'이다. leanedOn은 이 실행의 결정이 실제로 기댄 연구자 가정이다."}


def _refusals(engine: "Engine") -> dict[str, Any]:
    """Every no and every not-now, with the rule that produced it.

    ``rule`` is the machine key from the decline table (or the ride-path code);
    ``reason`` is the sentence the person is recorded as giving. Both stay: a
    count needs the key and a reader needs the sentence.
    """
    rows = []
    by_rule: dict[str, int] = {}
    for event in engine.events:
        if event.type not in (EventType.request_declined, EventType.request_deferred):
            continue
        rule = event.payload.get("rule") or event.payload.get("reason") or "unspecified"
        rows.append({
            "requestId": event.payload.get("requestId"),
            "actorId": event.actorId,
            "kind": "declined" if event.type is EventType.request_declined else "deferred",
            "rule": rule,
            "reason": event.payload.get("reason"),
            "atMs": event.simTimeMs,
            # Whether MEDial was even told. A refusal further down a hand-off
            # is addressed to the neighbours and the researcher only.
            "seenByMedial": MEDIAL in event.visibility,
        })
        by_rule[rule] = by_rule.get(rule, 0) + 1
    return {
        "count": len(rows),
        "byRule": dict(sorted(by_rule.items())),
        "rows": rows,
        "note": "거절과 미룸을 합산 점수로 만들지 않는다. 규칙 하나가 걸린 것이 곧 사유다.",
    }


def _transport_metrics(engine: "Engine") -> dict[str, Any]:
    """Rides split into need, ask, accept and actually used.

    Doc 05 asks for the denominator to be visible: a ride that was never
    requested is not the same as one that was refused, and "one ride happened"
    means nothing without "out of how many needs".
    """
    needs = [e for e in engine.events if e.type is EventType.transport_need_raised]
    offers = [e for e in engine.events if e.type is EventType.request_offered
              and e.payload.get("need") == "transport"]
    accepted = [r for r in engine.book.reservations.values()
                if r.status in ("held", "picked_up", "completed")]
    completed = [r for r in engine.book.reservations.values() if r.status == "completed"]
    conflicts = [e for e in engine.events
                 if e.type is EventType.transport_conflict_detected]
    return {
        "needsRaised": len(needs),
        "peopleAsked": len(offers),
        "reservationsHeld": len(accepted),
        "ridesCompleted": len(completed),
        "conflictsDetected": len(conflicts),
        "conflictReasons": sorted({e.payload["reason"] for e in conflicts}),
        "cancelled": sum(1 for r in engine.book.reservations.values()
                         if r.status == "cancelled"),
        "seatAssumption": engine.book.seat_assumption,
        "note": ("분모는 '이동이 필요했던 횟수'다. 요청·수락·실제 이용을 따로 센다. "
                 "도착은 이동 필요의 해결이며 진료 결과가 아니다."),
    }


# Dimensions asked of every actor that experienced something. Wording follows
# doc 05 section 3B; no numeric scale is produced.
DIMENSIONS = (
    ("resolution", "일이 해결되었는가 / 다음 담당자가 명확한가"),
    ("time_respected", "내 일정과 노동이 존중되었는가"),
    ("choice", "거절·시간 제안·공개 범위 선택이 가능했는가"),
    ("disclosure", "민감한 정보가 원하지 않는 상대에게 전달되었는가"),
)


def build_reviews(engine: "Engine") -> list[ExperienceReview]:
    """One review per resident, grounded only in what that resident experienced."""
    reviews: list[ExperienceReview] = []
    actor_ids = sorted(engine.world.actors) + [HEALTH_STAFF]

    for index, actor_id in enumerate(actor_ids, start=1):
        experienced = [e for e in engine.events if actor_id in e.visibility]
        event_ids = [e.id for e in experienced]

        if not experienced:
            reviews.append(ExperienceReview(
                id="rev-%d" % index, attemptId=engine.attempt.id, actorId=actor_id,
                source="simulated", experiencedEventIds=[], dimensions=[],
                assessment="unknown",
                comment="이 시도에서 이 사람이 경험한 사건이 없다. 평가할 근거가 없다.",
                unknowns=["경험 없음", "실제 본인 평가"]))
            continue

        dimensions = _dimensions_for(engine, actor_id, experienced)
        graded = [d for d in dimensions if d.assessment != "unknown"]
        if not graded:
            overall = "unknown"
        elif any(d.assessment == "negative" for d in graded):
            overall = "mixed" if any(d.assessment == "positive" for d in graded) else "negative"
        elif all(d.assessment == "positive" for d in graded):
            overall = "positive"
        else:
            overall = "mixed"

        reviews.append(ExperienceReview(
            id="rev-%d" % index, attemptId=engine.attempt.id, actorId=actor_id,
            source="simulated", experiencedEventIds=event_ids, dimensions=dimensions,
            assessment=overall,  # type: ignore[arg-type]
            comment="규칙 기반 시뮬레이션 경험 평가이며 실제 주민 만족도가 아니다.",
            unknowns=["실제 본인 평가", "실제 감정 반응"]))
    return reviews


_ADDRESSED_TYPES = frozenset({
    EventType.request_offered,
    EventType.contact_attempted,
    EventType.handoff_requested,
})


def _dimensions_for(engine: "Engine", actor_id: str,
                    experienced: list[Any]) -> list[ReviewDimension]:
    kinds = {e.type for e in experienced}
    runtime = engine.world.actors.get(actor_id)
    out: list[ReviewDimension] = []

    if EventType.need_resolved in kinds:
        out.append(ReviewDimension(
            key="resolution", assessment="positive",
            reason="이 사람이 관련된 확인이 종료되는 것을 경험했다"))
    elif EventType.need_unresolved in kinds:
        out.append(ReviewDimension(
            key="resolution", assessment="negative",
            reason="확인이 끝나지 않은 채로 남았다"))
    elif EventType.handoff_requested in kinds:
        out.append(ReviewDimension(
            key="resolution", assessment="mixed",
            reason="다음 담당자는 정해졌으나 이 시점에서 해결되지는 않았다"))
    else:
        out.append(ReviewDimension(
            key="resolution", assessment="unknown",
            reason="종료 여부를 이 사람이 경험한 사건에서 알 수 없다"))

    if runtime and runtime.task_ms > 0:
        minutes = round(runtime.task_ms / MIN_MS)
        out.append(ReviewDimension(
            key="time_respected", assessment="mixed",
            reason="일과를 %d분 중단하고 이동했다. 부담의 크기는 본인 확인이 필요하다" % minutes))
    elif EventType.request_offered in kinds:
        out.append(ReviewDimension(
            key="time_respected", assessment="unknown",
            reason="요청을 받았으나 수행으로 이어지지 않았다"))
    else:
        out.append(ReviewDimension(
            key="time_respected", assessment="unknown",
            reason="이 시도에서 시간을 쓴 기록이 없다"))

    if EventType.request_offered in kinds:
        out.append(ReviewDimension(
            key="choice", assessment="positive",
            reason="수락·거절·연기 중에서 고를 수 있는 요청을 받았다"))
    else:
        out.append(ReviewDimension(
            key="choice", assessment="unknown",
            reason="선택지가 주어지는 상황을 경험하지 않았다"))

    # Only what this person could actually have noticed. The whole-run
    # disclosure table is a researcher metric: telling P1 that his routine went
    # to the health centre, in a sentence he never heard, is exactly the leak
    # the observation boundary exists to prevent.
    seen = [e for e in experienced if e.payload.get("disclosure")
            and (e.payload["disclosure"].get("subjectId") == actor_id
                 or e.payload.get("toActorId") == actor_id)]
    disclosed_to_me = [e for e in seen if e.payload.get("toActorId") == actor_id]
    about_me = [e for e in seen
                if e.payload["disclosure"].get("subjectId") == actor_id
                and e.payload["disclosure"].get("fields")]
    if not seen:
        out.append(ReviewDimension(
            key="disclosure", assessment="unknown",
            reason="이 사람이 겪은 사건 중 정보 공개를 알 수 있는 것이 없다"))
    elif about_me:
        fields = sorted({f for e in about_me
                         for f in e.payload["disclosure"].get("fields", [])})
        out.append(ReviewDimension(
            key="disclosure", assessment="unknown",
            reason=("내 이야기로 %s이(가) 전달되는 자리에 있었다. 이것을 원했는지는 "
                    "본인만 답할 수 있다" % ", ".join(fields))))
    else:
        out.append(ReviewDimension(
            key="disclosure", assessment="unknown",
            reason=("다른 사람 사정을 %d건 전달받았다. 알고 싶었는지는 본인만 답할 수 있다"
                    % len(disclosed_to_me))))
    return out


#: Everything that has to be equal before a comparison may be called controlled.
#: Free-text ``changes`` is not on the list: a sentence a researcher typed is not
#: evidence that the inputs matched.
CONTROLLED_INPUTS = (
    ("deck", lambda a, r: a["inputHashes"].get("deck")),
    ("resources", lambda a, r: a["inputHashes"].get("resources")),
    ("village", lambda a, r: a["inputHashes"].get("village")),
    ("environment", lambda a, r: a["inputHashes"].get("environment")),
    ("day", lambda a, r: a["inputHashes"].get("day")),
    ("relations", lambda a, r: a["inputHashes"].get("relations")),
    ("ledger", lambda a, r: a["inputHashes"].get("ledger")),
    ("modelPolicy", lambda a, r: a["inputHashes"].get("modelPolicy")),
    ("persona", lambda a, r: a.get("personaRevisionId")),
    ("baseline", lambda a, r: a.get("baselineRevisionId")),
    ("engineVersion", lambda a, r: a.get("engineVersion")),
    ("adapter", lambda a, r: a.get("adapter")),
    ("seed", lambda a, r: a.get("seed")),
    ("dataSource", lambda a, r: a.get("dataSource")),
)


def compare(runs: list[dict[str, Any]]) -> dict[str, Any]:
    """Line up two or more attempts and say exactly what differed.

    Condition difference is computed, not narrated: the policy objects are
    diffed field by field and every controlled input is hashed and compared. If
    anything other than the policy differs, ``controlled`` is false and the
    screen must not call it "same initial state, policy changed".
    """
    conditions = []
    decisions = []
    outcomes = []
    for run in runs:
        attempt = run["attempt"]
        metrics = run["metrics"]
        policy = run.get("policy") or {}
        conditions.append({
            "attemptId": attempt["id"],
            "label": attempt["label"],
            "lineage": attempt.get("lineage", "root"),
            "parentId": attempt.get("parentId"),
            "parentSeq": attempt.get("parentSeq"),
            "policyId": attempt["policyId"],
            "policyLabel": run.get("policyLabel"),
            "contactStrategy": run.get("contactStrategy"),
            "params": policy.get("params", {}),
            "changedFields": run.get("changes", []),
            "deckId": attempt["scenarioDeckId"],
            "resourceRevisionId": attempt["resourceRevisionId"],
            "seed": attempt["seed"],
            "adapter": attempt["adapter"],
            "inputHashes": attempt.get("inputHashes", {}),
            "personaRevisionId": attempt.get("personaRevisionId"),
            "baselineRevisionId": attempt.get("baselineRevisionId"),
            "engineVersion": attempt.get("engineVersion"),
        })
        decisions.append({
            "attemptId": attempt["id"],
            "steps": run.get("trace", []),
        })
        outcomes.append({
            "attemptId": attempt["id"],
            "resolved": metrics["requests"]["resolved"],
            "unresolved": metrics["requests"]["unresolved"],
            "resolutionPaths": metrics["requests"]["resolutionPaths"],
            "meanWaitMinutesResolvedOnly": metrics["waitMs"]["meanMinutesResolvedOnly"],
            "contactAttempts": metrics["contacts"]["attempts"],
            "neighbourMinutes": metrics["neighbourMinutes"],
            "institutionStaffMinutes": metrics["institutionBurden"]["staffMinutes"],
            "institutionQueueWaitMinutes":
                metrics["institutionBurden"]["queueWaitMinutes"],
            "disclosure": metrics["disclosure"],
            "residentBurden": metrics["residentBurden"],
            "transport": metrics.get("transport", {}),
            "handovers": metrics.get("handovers", {}).get("count", 0),
            "refusals": metrics.get("refusals", {}).get("count", 0),
            "dayRealization": metrics.get("dayRealization"),
            "elicitation": metrics.get("elicitation"),
            "emergencyClassifications": metrics["safety"]["emergencyClassifications"],
        })

    differing_inputs = [
        name for name, get in CONTROLLED_INPUTS
        if len({_key(get(r["attempt"], r)) for r in runs}) > 1
    ]
    policy_diff = _policy_diff([r.get("policy") or {} for r in runs],
                               [r["attempt"]["id"] for r in runs])
    controlled = not differing_inputs

    return {
        "conditionDifference": conditions,
        "decisionDifference": decisions,
        "outcomeDifference": outcomes,
        "policyDifference": policy_diff,
        "controlled": controlled,
        "differingInputs": differing_inputs,
        "claim": ("같은 deck·초기 상태에서 정책만 다르게 실행했다."
                  if controlled else
                  "정책 외의 입력(%s)도 다르다. 통제 비교가 아니다."
                  % ", ".join(differing_inputs)),
        "note": ("평균 점수로 우승자를 고르지 않는다. 합성 결과이며 실제 주민 만족도나 "
                 "임상 효과가 아니다."),
    }


def _key(value: Any) -> str:
    return repr(value)


def _policy_diff(policies: list[dict[str, Any]],
                 attempt_ids: list[str]) -> list[dict[str, Any]]:
    """Field-by-field difference between the policies that actually ran."""
    fields = ["contactStrategy"] + sorted(
        {k for p in policies for k in (p.get("params") or {})})
    rows = []
    for field_name in fields:
        values = []
        for policy in policies:
            if field_name == "contactStrategy":
                values.append(policy.get("contactStrategy"))
            else:
                values.append((policy.get("params") or {}).get(field_name))
        if len({_key(v) for v in values}) == 1:
            continue
        rows.append({"field": field_name,
                     "values": dict(zip(attempt_ids, values))})
    return rows
