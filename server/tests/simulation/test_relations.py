"""Residents hand work to each other, and MEDial does not see it happen.

Doc 19 excludes free resident chat by name, so this is not conversation. It is
the one thing the interviews actually show moving between people: the work
itself. The tests below pin the three properties that make it research rather
than fiction.

* **Nothing is invented.** An edge that is not in the source does not exist, and
  a resident with no recorded relation has nobody to pass a request to. That is
  a result about the village, not a gap in the model.
* **MEDial's ledger and the village's burden come apart, and that is the point.**
  MEDial asked one person and was told yes. Somebody else went. The researcher
  sees both; MEDial sees one.
* **A hand-off is still a proposal.** The engine checks the relation before
  committing, exactly as it checks everything else an adapter claims.

    python -m pytest server/tests/simulation/test_relations.py -q
"""
from __future__ import annotations

import heapq
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))

from app.simulation.contracts import (  # noqa: E402
    MEDIAL,
    RESEARCHER,
    EventType,
    ProposalAction,
    RelationRevision,
)
from app.simulation.decks.registry import DECKS, POLICIES, RESOURCE_SETS  # noqa: E402
from app.simulation.engine import Engine  # noqa: E402
from app.simulation.observations import visible_to  # noqa: E402
from app.simulation.relations import NO_RELATION_ID, REL_V1, get_relations  # noqa: E402
from app.simulation.runner import build_attempt  # noqa: E402
from app.simulation.village import load_village  # noqa: E402

SYNTHETIC = str(REPO_ROOT / "fixtures" / "synthetic" / "village.synthetic.json")
HOUR = 3_600_000
#: 14:00. P12 is off at the town, and of his two recorded relations the cousin
#: who is out on patrol is the one who can actually go.
AFTERNOON = 14 * HOUR
#: 12:30, when the recorded four-person group is at lunch together.
LUNCH = 12 * HOUR + 30 * 60_000


def _engine(relation_id: str | None = None, policy_id: str = "policy-A-v1") -> Engine:
    village = load_village(SYNTHETIC)
    policy = POLICIES[policy_id]
    deck = DECKS["deck-p1-no-response-v1"]
    resources = RESOURCE_SETS["assumed-resources-v1"]
    relations = get_relations(relation_id)
    attempt = build_attempt("att-rel", "x", policy, deck, resources, village,
                            relations=relations)
    return Engine(attempt, policy, deck, resources, village, relations=relations)


def _drain(engine: Engine) -> None:
    while engine._queue:
        pending = heapq.heappop(engine._queue)
        engine._dispatch(pending.kind, pending.at_ms, pending.payload)


def _run_offer(at_ms: int, to_actor: str, subject: str,
               relation_id: str | None = None) -> Engine:
    engine = _engine(relation_id)
    request = engine._ensure_request(at_ms, subject)
    engine._offer(at_ms, request, to_actor, {})
    _drain(engine)
    return engine


def _of(engine: Engine, etype: EventType) -> list:
    return [e for e in engine.events if e.type is etype]


# ------------------------------------------------------------ the graph
def test_every_edge_points_at_something_recorded():
    assert REL_V1.edges
    for edge in REL_V1.edges:
        assert edge.provenance == "source-adapted", edge
        assert edge.reason.strip(), edge


def test_the_lonely_residents_are_lonely_because_the_source_says_so():
    """P1 has the village head and nobody else. That is the finding, not a gap."""
    assert [REL_V1.other(e, "P1") for e in REL_V1.neighbours("P1")] == ["P6"]
    assert [REL_V1.other(e, "P2") for e in REL_V1.neighbours("P2")] == ["P5"]


def test_the_cousin_is_an_edge_the_registry_never_stated():
    """``cousin`` is a group of one; its meaning is this edge."""
    edge = REL_V1.edge_between("P6", "P12")
    assert edge is not None and edge.kind == "kin"


def test_the_graph_is_symmetric():
    for edge in REL_V1.edges:
        assert REL_V1.edge_between(edge.b, edge.a) is edge


def test_nobody_is_related_to_themselves():
    assert all(edge.a != edge.b for edge in REL_V1.edges)


def test_the_relation_graph_is_declared_not_editable():
    assert RelationRevision.EDITABLE_BY_CHANGE_SET is False


@pytest.mark.parametrize("key", [
    "relations.P1.edges",
    "relation.P1.P3",
    "interaction.maxRelayHops",
])
def test_a_change_set_cannot_give_a_lonely_person_a_friend(key):
    """That would close the quest without MEDial having improved at all."""
    from app.simulation.decks.registry import ITERATION_START_POLICY
    from app.simulation.iteration.contracts import (
        ChangeSet,
        ChangeSetValidation,
        ExecutionBinding,
        RuleChange,
    )
    from app.simulation.iteration.service import SUPPORTED_CAPABILITIES
    from app.simulation.iteration.validation import validate_change_set

    policy = POLICIES[ITERATION_START_POLICY].model_dump(mode="json")
    change_set = ChangeSet(
        id="c1", sessionId="s", generationIndex=0, baseRevisionId=policy["id"],
        label="변경", reviewItemRefs=["rev-x#0"], mechanism="검증",
        changes=[RuleChange(
            scope="task", target="timing_burden",
            questId="quest:no-response-welfare-check",
            taskIds=["task:contact-subject"], field="retry",
            beforeRule="재연락하지 않는다.", afterRule="한 번 재연락한다.",
            executionBindings=[ExecutionBinding(key=key, before=False, after=True)])],
        createdAt="now")
    checked = validate_change_set(change_set, policy=policy,
                                  capabilities=SUPPORTED_CAPABILITIES,
                                  known_review_items={"rev-x#0"})
    assert checked.validationStatus is not ChangeSetValidation.valid
    assert any("고정 사례 입력" in error for error in checked.validationErrors)


# ------------------------------------------------- the hand-off happens
def test_a_tied_up_resident_hands_the_request_to_a_recorded_relation():
    engine = _run_offer(AFTERNOON, "P12", "P9")
    relayed = _of(engine, EventType.request_relayed)
    assert len(relayed) == 1
    assert relayed[0].payload["fromActorId"] == "P12"
    assert relayed[0].payload["toActorId"] == "P6"
    assert relayed[0].payload["relationKind"] == "kin"


def test_the_hand_off_goes_to_whoever_is_standing_there():
    """At lunch the recorded four are together, which is how it went in the source."""
    engine = _run_offer(LUNCH, "P6", "P1")
    relayed = _of(engine, EventType.request_relayed)
    assert len(relayed) == 1
    assert relayed[0].payload["basis"] == "copresent"
    assert relayed[0].payload["toActorId"] in {"P4", "P7", "P8"}

    together = _of(engine, EventType.world_copresence)
    assert together and set(together[0].payload["actorIds"]) == {"P4", "P6", "P7", "P8"}


def test_the_relayed_check_actually_gets_done():
    engine = _run_offer(AFTERNOON, "P12", "P9")
    performed = _of(engine, EventType.task_check_performed)
    assert [e.actorId for e in performed] == ["P6"]
    assert performed[0].payload["outcome"] == "subject_found_well"
    assert _of(engine, EventType.need_resolved)


# --------------------------------------------- and MEDial does not see it
def test_medial_never_learns_that_somebody_else_went():
    """The property the whole mechanism exists for."""
    engine = _run_offer(AFTERNOON, "P12", "P9")
    seen = [e for e in engine.events if MEDIAL in e.visibility]
    assert not [e for e in seen if e.type is EventType.request_relayed]
    # MEDial was told the person it asked accepted, and never sees the work.
    accepted = [e for e in seen if e.type is EventType.request_accepted]
    assert [e.actorId for e in accepted] == ["P12"]
    assert not [e for e in seen if e.type is EventType.task_check_performed]
    resolved = _of(engine, EventType.need_resolved)[0]
    assert resolved.payload["byActorId"] == "P12", "MEDial credits who it asked"


def test_the_researcher_is_told_who_really_went():
    engine = _run_offer(AFTERNOON, "P12", "P9")
    truth = _of(engine, EventType.world_relay_resolved)
    assert len(truth) == 1
    assert truth[0].visibility == [RESEARCHER]
    assert truth[0].payload["reportedBy"] == "P12"
    assert truth[0].payload["performedBy"] == "P6"
    assert truth[0].payload["chain"] == ["P12", "P6"]


def test_medial_is_given_no_observation_it_could_not_have_had():
    engine = _run_offer(AFTERNOON, "P12", "P9")
    for event in engine.events:
        if event.type in (EventType.request_relayed, EventType.world_relay_resolved,
                          EventType.world_copresence):
            assert not visible_to(MEDIAL, event), event.type


def test_the_burden_ledger_separates_who_did_the_asking():
    """One counter could not show that MEDial asked one person and two went."""
    engine = _run_offer(AFTERNOON, "P12", "P9")
    asked = engine.world.actors["P12"]
    went = engine.world.actors["P6"]
    assert (asked.asked_by_medial, asked.asked_by_neighbour) == (1, 0)
    assert (went.asked_by_medial, went.asked_by_neighbour) == (0, 1)


def test_a_refusal_further_down_leaves_medial_believing_it_was_accepted():
    """The failure this makes visible: MEDial's ledger says yes, nobody went."""
    engine = _run_offer(LUNCH, "P6", "P1")
    assert _of(engine, EventType.request_relayed)
    assert not _of(engine, EventType.task_check_performed)
    accepted = [e for e in engine.events
                if e.type is EventType.request_accepted and MEDIAL in e.visibility]
    assert [e.actorId for e in accepted] == ["P6"]
    unresolved = _of(engine, EventType.need_unresolved)
    assert unresolved
    # And the reason MEDial is given is one MEDial could have reached itself.
    assert "이웃" not in unresolved[0].payload["reason"]


# ------------------------------------------------------------- the bounds
def test_a_relayed_request_is_not_relayed_on():
    engine = _run_offer(AFTERNOON, "P12", "P9")
    assert len(_of(engine, EventType.request_relayed)) == 1
    assert engine.environment.interaction.maxRelayHops == 1


def test_a_request_never_circles_back_to_someone_who_already_held_it():
    engine = _engine()
    request = engine._ensure_request(AFTERNOON, "P9")
    engine._offer(AFTERNOON, request, "P12", {})
    assert "P12" not in engine._relay_candidates(request, "P6")


def test_nobody_is_asked_to_check_on_themselves():
    engine = _engine()
    request = engine._ensure_request(AFTERNOON, "P6")
    engine._offer(AFTERNOON, request, "P12", {})
    assert "P6" not in engine._relay_candidates(request, "P12")


def test_handing_it_to_a_stranger_is_an_adapter_fault_not_a_resident_action():
    engine = _engine()
    request = engine._ensure_request(AFTERNOON, "P9")
    proposal = engine.factory.make("P12", AFTERNOON, ProposalAction.relay,
                                   targetActorId="P1")
    engine._relay(AFTERNOON, request, "P12", proposal)
    assert not _of(engine, EventType.request_relayed)
    assert engine.rejected_proposals
    assert "왕래 기록이 없다" in engine.rejected_proposals[0]["error"]


def test_switching_the_relations_off_reproduces_the_old_dead_end():
    engine = _run_offer(AFTERNOON, "P12", "P9", relation_id=NO_RELATION_ID)
    assert not _of(engine, EventType.request_relayed)
    assert _of(engine, EventType.request_deferred)


def test_two_villages_that_disagree_about_relations_are_not_a_controlled_pair():
    village = load_village(SYNTHETIC)
    policy = POLICIES["policy-A-v1"]
    deck = DECKS["deck-p1-no-response-v1"]
    resources = RESOURCE_SETS["assumed-resources-v1"]
    a = build_attempt("att-a", "x", policy, deck, resources, village,
                      relations=get_relations())
    b = build_attempt("att-b", "x", policy, deck, resources, village,
                      relations=get_relations(NO_RELATION_ID))
    assert a.relationRevisionId == "rel-v1"
    assert a.inputHashes["relations"] != b.inputHashes["relations"]


# --------------------------------------------------------- in the review
def test_the_neighbour_who_was_pulled_in_can_say_so_in_their_own_review():
    """Doc 19's case 1 names this: 확인 업무의 전가. It has to be citable."""
    from app.simulation.metrics import build_reviews

    engine = _run_offer(AFTERNOON, "P12", "P9")
    reviews = {r.actorId: r for r in build_reviews(engine)}
    relayed = _of(engine, EventType.request_relayed)[0]
    assert relayed.id in reviews["P6"].experiencedEventIds
    assert relayed.id in reviews["P12"].experiencedEventIds
