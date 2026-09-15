"""The simulator's own checks: every knob does something, somewhere.

The matrix below is the finding of 2026-09-15, pinned. A knob moving from
"changes the day" to "changes nothing" on a policy is a regression; one moving
the other way is a change worth reading about before the table is updated.

    python -m pytest server/tests/simulation/test_audit.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))

from app.simulation.audit import (  # noqa: E402
    dead_knobs, knob_effects, stability, synthesis_misclassification, synthesis_sheet,
    table_disagreement)
from app.simulation.contracts import PolicyParams  # noqa: E402
from app.simulation.village import load_village  # noqa: E402

SYNTHETIC = str(REPO_ROOT / "fixtures" / "synthetic" / "village.synthetic.json")
PERSONAS = str(REPO_ROOT / "fixtures" / "synthetic" / "personas.synthetic.json")
P1 = ["policy-A-v1", "policy-B-v1", "policy-C-v1", "policy-D-v1"]
P9 = ["policy-T-A-v1", "policy-T-B-v1"]

# True: flipping it changes the log on seed 17. False: reachable, but this
# day does not differ. None: the engine cannot read it under that policy.
#                                  A      B      C      D      T-A    T-B
EXPECTED = {
    "retryCount":                   (True,  True,  True,  True,  False, False),
    "retryIntervalMin":             (None,  True,  None,  True,  None,  None),
    "quietWindowMin":               (None,  True,  None,  True,  None,  None),
    "helperContactCap":             (True,  False, True,  True,  True,  True),
    "neighbourAskLimit":            (False, False, True,  False, False, False),
    "disclosure":                   (True,  True,  True,  True,  True,  True),
    "escalateToInstitutionAfterMin": (True, True,  True,  True,  False, False),
    "allowHeadContact":             (None,  False, True,  True,  None,  None),
    "rideCandidateOrder":           (False, False, False, False, True,  True),
    "maxRideDetourMin":             (False, False, False, False, True,  True),
}


def _rows():
    village = load_village(SYNTHETIC)
    return (knob_effects(village, PERSONAS, P1, ["deck-p1-no-response-v1"])
            + knob_effects(village, PERSONAS, P9, ["deck-p9-transport-v1"]))


def test_every_supported_knob_changes_some_day_and_the_matrix_is_as_recorded():
    rows = _rows()
    assert set(EXPECTED) == set(PolicyParams.SUPPORTED)
    got = {}
    for r in rows:
        got.setdefault(r["knob"], {})[r["policy"]] = r["logChanged"]
    for knob, expected in EXPECTED.items():
        assert tuple(got[knob][p] for p in P1 + P9) == expected, (knob, got[knob])
    assert dead_knobs(rows) == []


def test_an_unread_knob_says_why_instead_of_looking_dead():
    rows = _rows()
    a = next(r for r in rows if r["policy"] == "policy-A-v1" and r["knob"] == "retryIntervalMin")
    assert a["logChanged"] is None and "0회" in a["note"]
    head = next(r for r in rows if r["policy"] == "policy-A-v1" and r["knob"] == "allowHeadContact")
    assert head["logChanged"] is None and "head_first" in head["note"]


def test_stability_reports_how_many_days_kept_the_median_order():
    village = load_village(SYNTHETIC)
    s = stability(village, PERSONAS, ["policy-A-v1", "policy-D-v1"], "deck-p1-no-response-v1",
                  seeds=[1, 2, 3, 4, 5, 6, 7, 8])
    contacts = s["ranking"]["contacts"]
    # A never retries, D retries once: the order holds on every drawn day.
    assert contacts["orderByMedian"] == ["policy-A-v1", "policy-D-v1"]
    assert contacts["heldOnDays"] == contacts["ofDays"] == 8
    # D's day depends on where the head is at 10:10; seeds 3 and 7 leave it
    # unresolved (the head relays to a companion who cannot leave).
    assert s["summary"]["policy-D-v1"]["waitMinutes"]["censored"] == 2
    assert s["summary"]["policy-D-v1"]["outcomes"] == {"no_issue_found": 6, "unresolved": 2}
    assert s["ranking"]["resolved"]["direction"] == "higher"


def test_table_disagreement_counts_only_answers_that_carry_a_verdict():
    runs = [{"policy": "policy-C-v1", "run": 1, "residents": [
        {"actor": "P9", "type": "request.accepted", "table": "accept", "agrees": True},
        {"actor": "P10", "type": "request.declined", "table": "accept", "rule": "at_home",
         "agrees": False, "utterance": "오늘은 안 되겠어요"},
        {"actor": "P6", "type": "medial.observed", "table": None, "agrees": None}]},
        {"policy": "policy-C-v1", "run": 2, "error": "429"}]
    out = table_disagreement(runs)
    assert (out["runs"], out["answersWithVerdict"], out["disagreements"], out["rate"]) == (1, 2, 1, 0.5)
    assert out["cases"][0]["actor"] == "P10" and out["cases"][0]["model"] == "declined"


def test_synthesis_misclassification_is_counted_over_human_labels_only():
    detail = {"generations": [{"index": 0, "synthesis": {
        "ungroundedClaims": ["P1은 왕래하는 이웃이 없다"],
        "issueGroups": [{"id": "ig-1", "title": "이장에게 몰림", "eventRefs": ["evt-3"],
                         "severity": "significant"},
                        {"id": "ig-2", "title": "근거 없는 걱정", "eventRefs": [],
                         "severity": "minor"}]}}]}
    sheet = synthesis_sheet(detail)
    assert [i["filedAs"] for i in sheet] == ["ungrounded", "grounded", "no_event_refs"]
    assert synthesis_misclassification(sheet)["labelled"] == 0
    sheet[0]["humanLabel"] = "grounded"      # the log did support it: misfiled
    sheet[1]["humanLabel"] = "grounded"
    sheet[2]["draftLabel"] = "ungrounded"    # a draft label is not a person's
    human = synthesis_misclassification(sheet)
    assert (human["labelled"], human["misfiled"], human["rate"]) == (2, 1, 0.5)
    assert human["cases"][0]["text"] == "P1은 왕래하는 이웃이 없다"
    assert synthesis_misclassification(sheet, "draftLabel")["labelled"] == 1
