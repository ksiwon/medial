"""The health centre and 119 as agents (2026-09-15).

* the source day's Q4: a neighbour's report goes to 119 unread, the crew's
  arrival is the resources' number, the reporter stays, and the request ends
  as a handover - never as a judgement about the person;
* the 17:00 daily report: MEDial tells the centre only what it observed, the
  centre answers per resident, and a follow-up call it asks for is made;
* the model versions: a fake provider proves the plumbing - the institution
  tier is the head model, an answer outside the schema is an adapter failure
  and never a refusal, and a plan for someone not in the report is refused.

    python -m pytest server/tests/simulation/test_institutions.py -q
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))

from app.simulation.agents.base import AdapterError  # noqa: E402
from app.simulation.contracts import (  # noqa: E402
    EMS_CREW,
    EMS_DISPATCH,
    HEALTH_STAFF,
    MEDIAL,
    EventType,
    ModelPolicy,
)
from app.simulation.runner import run_attempt  # noqa: E402
from app.simulation.village import load_village  # noqa: E402

SYNTHETIC = str(REPO_ROOT / "fixtures" / "synthetic" / "village.synthetic.json")
PERSONAS = str(REPO_ROOT / "fixtures" / "synthetic" / "personas.synthetic.json")
DAY = "deck-eunjeom-day-v1"
RES = "assumed-resources-transport-v1"
HOUR = 3600_000

POLICY = ModelPolicy(provider="fake", headModelId="fake-head", residentModelId="fake-lite",
                     temperature=0.0, mode="record")


def _run(institution_adapter="rule", provider=None, attempt_id="att-inst"):
    return run_attempt(attempt_id, "policy-IT-v0", DAY, RES, adapter="rule",
                       village=load_village(SYNTHETIC), persona_path=PERSONAS,
                       environment_id="env-v3-fixed",
                       institution_adapter=institution_adapter,
                       model_policy=POLICY if institution_adapter == "llm" else None,
                       provider=provider)


def _of(result, etype):
    return [e for e in result.events if e.type is etype]


# ------------------------------------------------------------------ Q4 by rule
def test_an_emergency_is_handed_to_119_and_ends_as_a_handover():
    result = _run()
    reported = _of(result, EventType.emergency_reported)
    assert len(reported) == 1 and reported[0].actorId == "P7"
    assert reported[0].payload["subjectId"] == "P8"
    # 119 read the report itself, not a summary MEDial wrote.
    assert EMS_DISPATCH in reported[0].visibility

    dispatched = _of(result, EventType.ems_dispatched)
    assert len(dispatched) == 1 and dispatched[0].payload["etaMinutes"] == 22
    arrived = _of(result, EventType.ems_arrived)
    assert arrived and arrived[0].simTimeMs == dispatched[0].simTimeMs + 22 * 60_000
    handover = _of(result, EventType.ems_handover)
    assert handover and handover[0].actorId == EMS_CREW

    closed = [e for e in _of(result, EventType.need_resolved)
              if e.payload["requestId"] == "req-P8-emergency"]
    assert closed and closed[0].payload["resolutionPath"] == "ems_handover"
    assert closed[0].payload["byActorId"] == EMS_CREW
    # No clinical word anywhere on the chain.
    text = json.dumps([e.payload for e in result.events
                       if e.correlationId == "req-P8-emergency"], ensure_ascii=False)
    for word in ("진단", "뇌졸중", "심정지", "골절"):
        assert word not in text


def test_the_reporter_walks_over_and_stays_until_the_crew_arrives():
    result = _run()
    accepted = [e for e in _of(result, EventType.request_accepted)
                if e.correlationId == "req-P8-emergency"]
    assert accepted and accepted[0].actorId == "P7"
    started = [e for e in _of(result, EventType.task_started)
               if e.correlationId == "req-P8-emergency"]
    assert started and started[0].payload["task"] == "stay_with"
    p7 = [s for s in result.timeline["actors"]["P7"]["realized"]
          if s.get("requestId") == "req-P8-emergency"]
    assert [s["kind"] for s in p7] == ["travel", "stay"]
    assert p7[-1]["endMs"] == _of(result, EventType.ems_arrived)[0].simTimeMs
    done = [e for e in _of(result, EventType.task_completed)
            if e.correlationId == "req-P8-emergency"]
    assert done and done[0].actorId == "P7"


def test_the_whole_source_day_resolves_all_four_needs():
    result = _run()
    assert result.metrics["requests"]["raised"] == 4
    assert result.metrics["requests"]["unresolved"] == 0
    assert result.metrics["adapterFailures"] == 0


# -------------------------------------------------------- the daily report
def test_the_daily_report_holds_only_what_medial_observed():
    result = _run()
    sent = _of(result, EventType.institution_report_sent)
    assert len(sent) == 1 and sent[0].simTimeMs == 17 * HOUR
    assert set(sent[0].visibility) == {MEDIAL, HEALTH_STAFF}
    subjects = sent[0].payload["subjects"]
    assert len(subjects) == 12
    # No ground truth: no positions, no places, no activities.
    for row in subjects:
        assert not ({"place", "x", "y", "activity"} & set(row))
    p1 = next(r for r in subjects if r["subjectId"] == "P1")
    assert p1["noResponse"] == 1 and p1["resolved"] == 1
    p9 = next(r for r in subjects if r["subjectId"] == "P9")
    assert p9["rides"] == 1
    # 20:30 has not happened at 17:00.
    p8 = next(r for r in subjects if r["subjectId"] == "P8")
    assert p8["emergencies"] == 0


def test_the_centre_answers_every_resident_and_a_note_for_a_closed_no_response():
    result = _run()
    reviewed = _of(result, EventType.institution_report_reviewed)
    assert len(reviewed) == 1 and reviewed[0].actorId == HEALTH_STAFF
    actions = reviewed[0].payload["actions"]
    assert {a["subjectId"] for a in actions} == {"P%d" % i for i in range(1, 13)}
    by = {a["subjectId"]: a["action"] for a in actions}
    assert by["P1"] == "note"
    assert by["P3"] == "none"


# --------------------------------------------------------- the model versions
class Institutions:
    """A scripted model for the institution tier only."""

    def __init__(self, ems=None, centre=None):
        self.ems = ems
        self.centre = centre
        self.calls: list[tuple[str, dict]] = []
        self.available = True

    def verify_models(self, policy):
        return []

    def __call__(self, prompt, policy, spec):
        self.calls.append((spec.role, prompt))
        model = policy.model_for(spec.role)
        assert model == "fake-head", "institutions are the head tier"
        if prompt["duty"] == "ems_dispatch":
            handoff = next(o for o in prompt["observations"] if o["kind"] == "handoff.requested")
            reply = self.ems(prompt) if self.ems else {"action": "accept"}
            return json.dumps({"action": reply["action"],
                               "requestId": handoff["payload"]["requestId"],
                               "utterance": reply.get("utterance", "접수했습니다. 출동합니다."),
                               "usedObservationIds": [handoff["id"]],
                               "uncertainty": None}, ensure_ascii=False)
        report = next(o for o in prompt["observations"] if o["kind"] == "institution.report_sent")
        if self.centre:
            return json.dumps(self.centre(prompt, report), ensure_ascii=False)
        return json.dumps({
            "actions": [{"subjectId": r["subjectId"], "action": "followup_call" if r["noResponse"] else "none",
                         "reason": "무응답이 있었다" if r["noResponse"] else "특이 없음"}
                        for r in report["payload"]["subjects"]],
            "usedObservationIds": [report["id"]], "uncertainty": None}, ensure_ascii=False)


def test_model_institutions_are_the_head_tier_and_their_answers_become_events():
    fake = Institutions()
    result = _run("llm", fake)
    roles = [r for r, _ in fake.calls]
    assert roles.count("institution") == 2, roles
    assert result.metrics["adapterFailures"] == 0
    dispatched = _of(result, EventType.ems_dispatched)
    assert dispatched and dispatched[0].payload["etaMinutes"] == 22
    assert dispatched[0].payload["utterance"] == "접수했습니다. 출동합니다."
    reviewed = _of(result, EventType.institution_report_reviewed)[0]
    assert reviewed.payload["provenance"] == "llm"
    # The model asked for a call to P1 (the one no-response), and it was made
    # by the centre, in the shift.
    calls = [e for e in _of(result, EventType.contact_attempted)
             if e.actorId == HEALTH_STAFF and e.payload["purpose"] == "daily_report_followup"]
    assert [e.payload["toActorId"] for e in calls] == ["P1"]
    assert 17 * HOUR <= calls[0].simTimeMs < 18 * HOUR
    # The prompt held the institution's own view and nothing of the map.
    for _, prompt in fake.calls:
        assert set(prompt) <= {"promptRevision", "role", "duty", "actorId", "simTimeMs", "clock",
                               "observations", "resources", "allowedActions"}


def test_119_declining_is_written_as_119_declining_and_the_request_stays_open_as_unresolved():
    fake = Institutions(ems=lambda p: {"action": "decline", "utterance": "관할이 아닙니다."})
    result = _run("llm", fake)
    declined = [e for e in _of(result, EventType.request_declined)
                if e.actorId == EMS_DISPATCH]
    assert declined and declined[0].payload["utterance"] == "관할이 아닙니다."
    assert not _of(result, EventType.ems_dispatched)
    unresolved = [e for e in _of(result, EventType.need_unresolved)
                  if e.payload["requestId"] == "req-P8-emergency"]
    assert unresolved and "119" in unresolved[0].payload["reason"]


def test_a_model_answer_outside_the_schema_is_an_adapter_failure_not_a_refusal():
    fake = Institutions(ems=lambda p: {"action": "resolve"})
    result = _run("llm", fake)
    assert result.metrics["adapterFailures"] >= 1
    assert not [e for e in _of(result, EventType.request_declined) if e.actorId == EMS_DISPATCH]
    faults = [e for e in _of(result, EventType.medial_waiting)
              if e.payload.get("reason") == "adapter_error" and e.payload.get("actorId") == EMS_DISPATCH]
    assert faults


def test_a_plan_for_someone_not_in_the_report_is_refused():
    def centre(prompt, report):
        return {"actions": [{"subjectId": "P99", "action": "home_visit", "reason": "x"}],
                "usedObservationIds": [report["id"]], "uncertainty": None}
    fake = Institutions(centre=centre)
    result = _run("llm", fake)
    reviewed = _of(result, EventType.institution_report_reviewed)[0]
    assert reviewed.payload["outcome"] == "no_plan"
    faults = [e for e in _of(result, EventType.medial_waiting)
              if e.payload.get("actorId") == HEALTH_STAFF]
    assert faults and "P99" in faults[0].payload["detail"]


def test_the_attempt_records_which_institution_adapter_ran():
    assert _run().attempt.institutionAdapter == "rule"
    assert _run("llm", Institutions()).attempt.institutionAdapter == "llm"
