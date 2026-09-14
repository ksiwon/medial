"""Model calls are recorded and replayed, never quietly repeated.

The moment a model answers for a resident, every claim the comparison screen
makes rests on being able to get the same answers back. These tests pin the
three ways that is lost:

* a replay that silently re-calls the provider when a recording is missing. It
  would look replayed, cost money, and differ;
* one adapter instance shared by every actor, so one resident's call counter
  numbers another's prompts and the two recordings collide;
* a model swap that does not show up in the attempt's inputs, and therefore
  reads on screen as a policy effect.

    python -m pytest server/tests/simulation/test_model_calls.py -q
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "server"))

from app.simulation.agents.base import AdapterError, ProposalFactory  # noqa: E402
from app.simulation.agents.llm import LlmAdapter, build_prompt_payload  # noqa: E402
from app.simulation.agents.model_calls import (  # noqa: E402
    MissingModelCall,
    ModelCallLog,
    call_key,
)
from app.simulation.contracts import HEALTH_STAFF, ModelPolicy, ProposalAction  # noqa: E402
from app.simulation.environment import FIXED_ENVIRONMENT_ID  # noqa: E402
from app.simulation.observations import ActorView  # noqa: E402
from app.simulation.persistence.store import Store  # noqa: E402
from app.simulation.runner import log_fingerprint, run_attempt  # noqa: E402
from app.simulation.village import load_village  # noqa: E402

SYNTHETIC = str(REPO_ROOT / "fixtures" / "synthetic" / "village.synthetic.json")
PERSONAS = str(REPO_ROOT / "fixtures" / "synthetic" / "personas.synthetic.json")

RECORD = ModelPolicy(provider="test", headModelId="test-head",
                     residentModelId="test-model", temperature=0.0, mode="record")
REPLAY = RECORD.model_copy(update={"mode": "replay"})

FENCED = '```json\n{"action": "accept", "usedObservationIds": ["o1"]}\n```'


class Provider:
    """A stand-in model. Counts calls, because "did not call" is the assertion."""

    def __init__(self, reply: str = '{"action": null}') -> None:
        self.reply = reply
        self.calls: list[dict] = []

    def __call__(self, prompt, policy, spec=None):
        self.calls.append(prompt)
        return self.reply


def _view(actor_id: str = "P1", at_ms: int = 0) -> ActorView:
    return ActorView(actor_id=actor_id, sim_time_ms=at_ms, observations=[],
                     commitments=[], persona=None, own_activity="home",
                     own_interruptible=True)


# ------------------------------------------------------------------ the key
def test_the_key_is_the_content_and_not_the_clock():
    """Re-running the same day must produce the same keys, hours later."""
    prompt = {"actorId": "P1", "simTimeMs": 0}
    assert call_key(RECORD, "P1", 0, prompt) == call_key(RECORD, "P1", 0, dict(prompt))


@pytest.mark.parametrize(("field", "value"), [
    ("residentModelId", "other-model"),
    ("temperature", 0.7),
    ("promptRevisionId", "prompt-v3"),
])
def test_asking_a_different_model_is_a_different_call(field, value):
    prompt = {"actorId": "P1"}
    other = RECORD.model_copy(update={field: value})
    assert call_key(RECORD, "P1", 0, prompt) != call_key(other, "P1", 0, prompt)


def test_the_head_and_a_resident_asked_the_same_bytes_are_two_calls():
    """Two tiers: the key carries the model of the role that asked."""
    prompt = {"same": "prompt"}
    assert call_key(RECORD, "MEDial", 0, prompt, "head") != call_key(
        RECORD, "MEDial", 0, prompt, "resident")
    other_head = RECORD.model_copy(update={"headModelId": "other-head"})
    assert call_key(RECORD, "MEDial", 0, prompt, "head") != call_key(
        other_head, "MEDial", 0, prompt, "head")
    # And changing the head model leaves every resident recording valid.
    assert call_key(RECORD, "P1", 0, prompt) == call_key(other_head, "P1", 0, prompt)


def test_two_actors_and_two_turns_are_four_calls():
    """Without the actor and the index in the key, these would collide."""
    prompt = {"same": "prompt"}
    keys = {call_key(RECORD, actor, index, prompt)
            for actor in ("P1", "P2") for index in (0, 1)}
    assert len(keys) == 4


# ------------------------------------------------------------------ the gate
def test_record_mode_calls_the_provider_and_writes_it_down():
    log = ModelCallLog("att-1", RECORD)
    provider = Provider()
    record = log.resolve("P1", 0, {"q": 1}, provider=provider)
    assert len(provider.calls) == 1
    assert record.origin == "live"
    assert record.status == "ok"
    assert log.records == [record]


def test_replay_returns_the_recording_without_calling_anything():
    log = ModelCallLog("att-1", RECORD)
    provider = Provider('{"action": "wait"}')
    first = log.resolve("P1", 0, {"q": 1}, provider=provider)

    replayed = ModelCallLog("att-2", REPLAY, inherited=[first])
    again = replayed.resolve("P1", 0, {"q": 1}, provider=provider)
    assert len(provider.calls) == 1, "replay called the provider"
    assert again.response == first.response
    assert again.origin == "replayed"
    assert again.attemptId == "att-2"


def test_a_missing_recording_fails_instead_of_asking_again():
    """The failure this module exists to prevent."""
    provider = Provider()
    log = ModelCallLog("att-2", REPLAY, inherited=[])
    with pytest.raises(MissingModelCall) as raised:
        log.resolve("P1", 0, {"q": 1}, provider=provider)
    assert provider.calls == []
    assert isinstance(raised.value, AdapterError), "must be an adapter fault"


def test_the_same_prompt_twice_is_two_recordings():
    log = ModelCallLog("att-1", RECORD)
    provider = Provider()
    a = log.resolve("P1", 0, {"q": 1}, provider=provider)
    b = log.resolve("P1", 1000, {"q": 1}, provider=provider)
    assert a.key != b.key
    assert (a.callIndex, b.callIndex) == (0, 1)
    assert len(provider.calls) == 2


def test_a_provider_failure_is_written_down_and_raised():
    def broken(prompt, policy, spec=None):
        raise RuntimeError("429")

    log = ModelCallLog("att-1", RECORD)
    with pytest.raises(AdapterError):
        log.resolve("P1", 0, {"q": 1}, provider=broken)
    # Recorded anyway: a run that dropped the calls it could not make would
    # report fewer attempts than it actually made.
    assert [r.status for r in log.records] == ["error"]


def test_record_mode_without_a_provider_says_so():
    log = ModelCallLog("att-1", RECORD)
    with pytest.raises(AdapterError) as raised:
        log.resolve("P1", 0, {"q": 1}, provider=None)
    assert "공급자" in str(raised.value)


# --------------------------------------------------------------- the adapter
def test_a_malformed_answer_is_an_adapter_fault_not_a_refusal():
    log = ModelCallLog("att-1", RECORD)
    adapter = LlmAdapter(ProposalFactory("att-1"), "P1", log,
                         provider=Provider("음, 잘 모르겠네요"))
    with pytest.raises(AdapterError):
        adapter.propose(_view(), [ProposalAction.accept])


def test_an_action_that_is_not_allowed_right_now_is_refused():
    log = ModelCallLog("att-1", RECORD)
    adapter = LlmAdapter(ProposalFactory("att-1"), "P1", log,
                         provider=Provider('{"action": "handoff"}'))
    with pytest.raises(AdapterError):
        adapter.propose(_view(), [ProposalAction.accept, ProposalAction.decline])


def test_choosing_nothing_is_allowed_and_is_not_an_error():
    log = ModelCallLog("att-1", RECORD)
    adapter = LlmAdapter(ProposalFactory("att-1"), "P1", log,
                         provider=Provider('{"action": null}'))
    assert adapter.propose(_view(), [ProposalAction.accept]) == []


def test_a_fenced_answer_still_parses():
    log = ModelCallLog("att-1", RECORD)
    adapter = LlmAdapter(ProposalFactory("att-1"), "P1", log, provider=Provider(FENCED))
    proposals = adapter.propose(_view(), [ProposalAction.accept])
    assert [p.action for p in proposals] == [ProposalAction.accept]
    assert proposals[0].source == "llm"
    assert proposals[0].observationIds == ["o1"]


def test_the_prompt_carries_only_this_actor_and_says_which_build_it_is():
    payload = build_prompt_payload(_view("P3"), [ProposalAction.accept])
    assert payload["actorId"] == "P3"
    assert payload["promptRevision"]
    text = json.dumps(payload, ensure_ascii=False)
    for other in ("P1", "P2", "P4"):
        assert '"%s"' % other not in text


# ------------------------------------------------------------- in the engine
def _run(policy: ModelPolicy, adapter: str = "llm", provider=None, inherited=None,
         attempt_id: str = "att-llm-1"):
    return run_attempt(attempt_id, "policy-A-v1", "deck-p1-no-response-v1",
                       "assumed-resources-v1", adapter=adapter,
                       village=load_village(SYNTHETIC), persona_path=PERSONAS,
                       environment_id=FIXED_ENVIRONMENT_ID,
                       model_policy=policy, provider=provider,
                       inherited_model_calls=inherited)


def test_each_actor_gets_their_own_adapter():
    """A shared instance would carry one resident's call counter into another's."""
    from app.simulation.decks.registry import DECKS, POLICIES, RESOURCE_SETS
    from app.simulation.engine import Engine
    from app.simulation.runner import build_attempt

    village = load_village(SYNTHETIC)
    policy = POLICIES["policy-A-v1"]
    deck = DECKS["deck-p1-no-response-v1"]
    resources = RESOURCE_SETS["assumed-resources-v1"]
    attempt = build_attempt("att-x", "x", policy, deck, resources, village,
                            adapter="llm", model_policy=RECORD)
    engine = Engine(attempt, policy, deck, resources, village)
    instances = [id(adapter) for adapter in engine._adapters.values()]
    assert len(set(instances)) == len(instances)
    assert HEALTH_STAFF in engine._adapters


@pytest.mark.parametrize("adapter", ["rule", "scripted"])
def test_a_run_that_calls_no_model_records_no_calls(adapter):
    result = _run(ModelPolicy(), adapter=adapter, attempt_id="att-%s" % adapter)
    assert result.model_calls == []
    assert result.metrics["modelCalls"]["total"] == 0


def test_an_llm_run_replays_into_the_same_log():
    """The property the whole module exists for."""
    provider = Provider()
    recorded = _run(RECORD, provider=provider, attempt_id="att-rec")
    assert recorded.model_calls, "the run asked nobody anything"
    assert provider.calls

    before = len(provider.calls)
    replayed = _run(REPLAY, provider=provider, attempt_id="att-rep",
                    inherited=recorded.model_calls)
    assert len(provider.calls) == before, "replay called the provider"
    assert log_fingerprint(replayed.events) == log_fingerprint(recorded.events)
    assert {m.origin for m in replayed.model_calls} == {"replayed"}
    assert replayed.metrics["modelCalls"]["replayed"] == len(replayed.model_calls)


def test_replaying_without_the_recording_fails_the_actors_rather_than_the_run():
    """A missing recording is an adapter fault, so it is visible, not silent."""
    result = _run(REPLAY, attempt_id="att-empty", inherited=[])
    waits = [e for e in result.events if e.payload.get("reason") == "adapter_error"]
    assert waits, "a replay with no recording produced no adapter failure"
    assert any("재생" in e.payload.get("detail", "") for e in waits)


# -------------------------------------------------------------- in the inputs
def test_a_model_swap_is_reported_as_a_different_input():
    a = _run(RECORD, provider=Provider(), attempt_id="att-m1")
    hotter = RECORD.model_copy(update={"temperature": 0.9})
    b = _run(hotter, provider=Provider(), attempt_id="att-m2")
    assert a.attempt.inputHashes["modelPolicy"] != b.attempt.inputHashes["modelPolicy"]
    assert a.attempt.modelPolicy.residentModelId == "test-model"


def test_the_rule_path_still_reports_a_model_policy():
    """Absent is a value too; "off" is what a rule run actually ran under."""
    result = _run(ModelPolicy(), adapter="rule", attempt_id="att-off")
    assert result.attempt.modelPolicy.mode == "off"
    assert result.attempt.inputHashes["modelPolicy"]


def test_model_calls_survive_being_stored():
    from app.simulation.decks.registry import POLICIES

    store = Store(":memory:")
    result = _run(RECORD, provider=Provider(), attempt_id="att-store")
    store.save_run(result, POLICIES["policy-A-v1"], log_fingerprint(result.events))
    rows = store.attempt_model_calls("att-store")
    assert len(rows) == len(result.model_calls)
    assert {row["actorId"] for row in rows} == {m.actorId for m in result.model_calls}


@pytest.mark.parametrize("key", [
    "modelPolicy.temperature",
    "model.modelId",
    "prompt.revision",
])
def test_a_change_set_cannot_edit_the_model_policy(key):
    from app.simulation.decks.registry import ITERATION_START_POLICY, POLICIES
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


# ------------------------------------------------------------------- a fork
def _service(policy: ModelPolicy, provider):
    from app.simulation.service import SimulationService

    return SimulationService(store=Store(":memory:"), village=load_village(SYNTHETIC),
                             persona_path=PERSONAS,
                             environment_id=FIXED_ENVIRONMENT_ID,
                             model_policy=policy, provider=provider)


def test_a_fork_replays_its_parents_answers_across_the_shared_prefix():
    """Otherwise the prefix would differ because the model felt different."""
    provider = Provider()
    svc = _service(RECORD, provider)
    parent = svc.create_attempt("policy-A-v1", "deck-p1-no-response-v1",
                                "assumed-resources-v1", adapter="llm")["attempt"]
    parent_calls = svc.store.attempt_model_calls(parent["id"])
    assert parent_calls, "the parent asked nobody anything"

    child = svc.fork_attempt(parent["id"], 3, {"params": {"retryCount": 1}},
                             "재연락 한 번")["attempt"]
    child_calls = svc.store.attempt_model_calls(child["id"])
    # The fork's own prefix verification already refused a divergent log; what
    # this adds is that the prefix was replayed rather than re-asked.
    assert any(call["origin"] == "replayed" for call in child_calls)
    assert child["parentSeq"] == 3


def test_a_rerun_does_not_inherit_the_parents_recording():
    """A rerun changes the policy from the first minute, so nothing is shared.

    Handing it the parent's recording would let an accidental key match pass as
    continuity that was never checked.
    """
    provider = Provider()
    svc = _service(RECORD, provider)
    parent = svc.create_attempt("policy-A-v1", "deck-p1-no-response-v1",
                                "assumed-resources-v1", adapter="llm")["attempt"]
    child = svc.rerun_attempt(parent["id"], {"params": {"retryCount": 1}},
                              "재연락 한 번")["attempt"]
    origins = {call["origin"] for call in svc.store.attempt_model_calls(child["id"])}
    assert origins == {"live"}


# ------------------------------------------------- not the iteration table
def test_the_attempt_table_did_not_take_the_iteration_tables_name():
    """Found by the server refusing to start on a database that already existed.

    ``IterationTables`` owns ``model_calls`` for the review session's own calls,
    and ``Store`` inherits from it. Calling this table and this method
    ``model_calls`` too was invisible on a fresh database - the schema ran first
    and the iteration CREATE silently no-opped - and on an existing one the
    index failed and the server would not boot.
    """
    store = Store(":memory:")
    names = {row[0] for row in store._conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert {"model_calls", "attempt_model_calls"} <= names

    # Both readers exist and neither shadows the other.
    assert store.attempt_model_calls("att-x") == []
    assert store.model_calls("session-x") == []
    assert Store.model_calls is not Store.attempt_model_calls


def test_the_two_tables_hold_their_own_rows():
    store = Store(":memory:")
    result = _run(RECORD, provider=Provider(), attempt_id="att-both")
    from app.simulation.decks.registry import POLICIES
    store.save_run(result, POLICIES["policy-A-v1"], log_fingerprint(result.events))

    store.save_model_call({
        "id": "mc-iter-1", "sessionId": "sess-1", "role": "reviewer",
        "requestHash": "h", "status": "ok", "createdAt": "now"})

    assert len(store.attempt_model_calls("att-both")) == len(result.model_calls)
    assert [c["id"] for c in store.model_calls("sess-1")] == ["mc-iter-1"]
