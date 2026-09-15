"""The elicitation ledger: "nobody" and "nobody asked" are different facts.

    python -m pytest server/tests/simulation/test_ledger.py -q
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))

from app.simulation.contracts import EventType  # noqa: E402
from app.simulation.decks.registry import POLICIES  # noqa: E402
from app.simulation.ledger import (  # noqa: E402
    ElicitationLedger,
    ElicitationStatus,
    legacy_ledger,
    load_ledger,
)
from app.simulation.runner import run_attempt  # noqa: E402
from app.simulation.village import load_village  # noqa: E402

SYNTHETIC = REPO_ROOT / "fixtures" / "synthetic" / "village.synthetic.json"
PERSONAS = str(REPO_ROOT / "fixtures" / "synthetic" / "personas.synthetic.json")
IDS = ["P%d" % i for i in range(1, 13)]


def _run(policy_id, ledger, attempt_id="att-ledger"):
    village = load_village(SYNTHETIC)
    return run_attempt(attempt_id, policy_id, "deck-p1-no-response-v1", "assumed-resources-v1",
                       village=village, persona_path=PERSONAS,
                       environment_id="env-v3-fixed", ledger=ledger)


def _decisions(result, question_prefix):
    return [e.payload for e in result.events if e.type is EventType.medial_decided
            and e.payload["question"].startswith(question_prefix)]


# ------------------------------------------------------------- the file
def test_the_synthetic_ledger_loads_beside_the_village_and_is_hashed_in():
    ledger = load_ledger(SYNTHETIC, IDS, "P6")
    assert ledger.id == "ledger-synthetic-v1"
    assert ledger.status("P1", "companions") is ElicitationStatus.asked_none
    assert ledger.status("P1", "help_contacts") is ElicitationStatus.not_asked
    result = _run("policy-A-v1", ledger)
    assert result.attempt.ledgerRevisionId == "ledger-synthetic-v1"
    assert result.attempt.inputHashes["ledger"] == ledger.content_hash()


def test_without_a_ledger_every_question_is_unasked_and_the_head_is_assumed_to_know_all(monkeypatch):
    monkeypatch.setenv("MEDIAL_LEDGER_PATH", str(REPO_ROOT / "nope.json"))
    ledger = load_ledger(SYNTHETIC, IDS, "P6")
    assert ledger.id == "ledger-legacy"
    assert all(ledger.status(a, t) is ElicitationStatus.not_asked
               for a in IDS for t in ("companions", "help_contacts"))
    assert {k.knowerId for k in ledger.routineKnowledge} == {"P6"}
    assert all(k.provenance == "researcher-assumption" for k in ledger.routineKnowledge)


def test_a_ledger_naming_a_stranger_is_refused(tmp_path):
    bad = tmp_path / "ledger.bad.json"
    bad.write_text(json.dumps({"id": "x", "label": "x", "entries": [
        {"actorId": "P99", "topic": "companions", "status": "recorded", "basis": "?"}]}),
        encoding="utf-8")
    village_path = tmp_path / "village.json"
    village_path.write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError, match="P99"):
        load_ledger(village_path, IDS, "P6")


# ------------------------------------------------------- what the run says
def test_relation_first_says_not_asked_instead_of_nobody():
    ledger = load_ledger(SYNTHETIC, IDS, "P6")
    result = _run("policy-D-v1", ledger)
    decided = next(d for d in _decisions(result, "응답이 없는") if d["chosen"] == "P6")
    assert "묻지 않았다 (채록 공백)" in decided["rationale"]

    asked = ledger.model_copy(update={"entries": [
        e.model_copy(update={"status": ElicitationStatus.asked_none, "basis": "인터뷰"})
        if e.actorId == "P1" and e.topic == "help_contacts" else e for e in ledger.entries]})
    result = _run("policy-D-v1", asked, "att-ledger-2")
    decided = next(d for d in _decisions(result, "응답이 없는") if d["chosen"] == "P6")
    assert "물었고 없다고 했다" in decided["rationale"]


def test_where_to_look_is_asked_of_whoever_the_ledger_says_knows_not_the_head_by_code():
    ledger = load_ledger(SYNTHETIC, IDS, "P6")
    # Make P9 the only one who knows P1's day.
    knows = [k.model_copy(update={"knowerId": "P9"}) if k.subjectId == "P1" else k
             for k in ledger.routineKnowledge]
    rewired = ledger.model_copy(update={"routineKnowledge": knows})
    result = _run("policy-C-v1", rewired)
    asked = [e for e in result.events if e.type is EventType.request_offered
             and e.payload.get("purpose") == "whereabouts"]
    # P9 went himself and, knowing P1's day, said where to look; the head was
    # never phoned for it.
    assert asked == []
    observed = [e for e in result.events if e.type is EventType.medial_observed
                and e.payload.get("observationKind") == "local_knowledge"]
    assert observed and observed[0].actorId == "P9"


def test_an_outcome_that_rests_on_an_assumed_pair_says_so_in_the_metrics():
    legacy = legacy_ledger(IDS, "P6")
    result = _run("policy-C-v1", legacy)
    leaned = result.metrics["elicitation"]["leanedOn"]
    assert leaned and leaned[0]["kind"] == "assumed_routine_knowledge"
    assert leaned[0]["knowerId"] == "P6" and leaned[0]["subjectId"] == "P1"
    decided = _decisions(result, "자택에 없고")[0]
    assert "연구자 가정" in decided["rationale"]

    # Under the ledger that records the head learning P1's field in Q3, the
    # same day rests on nothing assumed.
    recorded = _run("policy-C-v1", load_ledger(SYNTHETIC, IDS, "P6"), "att-ledger-3")
    assert recorded.metrics["elicitation"]["leanedOn"] == []


def test_gaps_are_listed_only_for_the_people_the_day_involved():
    result = _run("policy-A-v1", load_ledger(SYNTHETIC, IDS, "P6"))
    gaps = result.metrics["elicitation"]["gaps"]
    assert {g["actorId"] for g in gaps} == {"P1", "P6"}
    assert any(g["topic"] == "help_contacts" and g["status"] == "not_asked" for g in gaps)


def test_two_ledgers_are_two_inputs_not_a_policy_effect():
    from app.simulation.metrics import compare
    a = _run("policy-A-v1", load_ledger(SYNTHETIC, IDS, "P6"), "att-l-a")
    b = _run("policy-A-v1", legacy_ledger(IDS, "P6"), "att-l-b")
    rows = [{"attempt": r.attempt.model_dump(mode="json"), "metrics": r.metrics,
             "policy": POLICIES["policy-A-v1"].model_dump(mode="json")} for r in (a, b)]
    assert "ledger" in compare(rows)["differingInputs"]
