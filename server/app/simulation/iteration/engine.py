"""The iteration state machine: run, review, synthesise, propose, validate,
evaluate, select, repeat - and stop honestly.

Every transition writes its result to the database before the next one starts,
and every transition is idempotent: it looks at what the generation already has
and skips the work if it is there. That is what makes a restart safe. A process
that dies between "ran the candidate" and "recorded which candidate won" resumes
without running the candidate twice or applying its patch twice.

Stopping is not one thing. ``reached_max_generations``, ``needs_decision``,
``budget_exhausted``, ``no_valid_change``, ``stalled``, ``model_failure`` and
``cancelled`` are separate states with separate text, and none of them is
reported as a completed, successful design. The last generation is never marked
as the winner; that is the designer's call and it lives in
:class:`~.contracts.DesignerDecision`.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from ..contracts import PolicyRevision
from ..decks.registry import DECKS
from ..metrics import compare as compare_runs
from .contracts import (
    AgentReview,
    ChangeProposal,
    Generation,
    GenerationOutcome,
    IterationSession,
    ProposalSelection,
    ProposalValidation,
    ReviewSynthesis,
    SessionStatus,
    STOP_REASON_TEXT,
)
from .experience import build_all_experiences, validate_review
from .improvement import SUPPORTED_CAPABILITIES, RuleImprovementAdapter
from .llm import BudgetExhausted, LlmClient, ModelCallError, ModelNotConfigured, content_hash
from .llm_adapters import LlmImprovementAdapter, LlmReviewAdapter, LlmSynthesisAdapter
from .reviewers import ReviewAdapterError, RuleReviewAdapter, ScriptedReviewAdapter
from .selection import (
    DEFAULT_CRITERIA,
    evaluate,
    outcome_vector,
    per_actor_delta,
    violates_required,
)
from .synthesis import RuleSynthesisAdapter
from .validation import patch_to_changes, validate_proposal


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _short() -> str:
    return uuid.uuid4().hex[:8]


class IterationError(RuntimeError):
    """The loop could not continue. Recorded with a stop reason, never hidden."""


class LongitudinalNotImplemented(IterationError):
    """Multi-day memory is a separate mode and this build does not run it."""


def combine_vectors(vectors: list[dict[str, float | None]]) -> dict[str, float | None]:
    """One row for a generation that ran several decks.

    Additive measures add; a mean over resolved requests is averaged over the
    decks that actually resolved something, and stays ``None`` when none did -
    a zero there would read as "answered instantly".
    """
    if not vectors:
        return {}
    out: dict[str, float | None] = {}
    for key in vectors[0]:
        values = [v.get(key) for v in vectors]
        known = [x for x in values if x is not None]
        if key == "meanWaitMinutes":
            out[key] = round(sum(known) / len(known), 1) if known else None
        else:
            out[key] = float(sum(known)) if known else None
    return out


class IterationEngine:
    """Owns one session. Not thread-safe by itself; the service serialises it."""

    def __init__(self, service: Any, session: IterationSession,
                 llm_client: LlmClient | None = None,
                 review_script: dict[str, Any] | None = None) -> None:
        self.service = service
        self.store = service.store
        self.session = session
        self.llm = llm_client
        self.review_script = review_script or {}
        self._cancel = False
        self._pause = False

    # -- adapters ---------------------------------------------------------
    def _on_call(self, record: Any) -> None:
        self.store.save_model_call(record)
        self.session.callsUsed += 1
        self.session.tokensUsed += int(record.inputTokens + record.outputTokens)

    def _review_adapter(self):
        choice = self.session.reviewAdapter
        if choice == "llm":
            return LlmReviewAdapter(self._require_llm(), on_call=self._on_call)
        if choice == "scripted":
            return ScriptedReviewAdapter(self.review_script)
        return RuleReviewAdapter()

    def _synthesis_adapter(self):
        if self.session.improvementAdapter == "llm":
            return LlmSynthesisAdapter(self._require_llm(), on_call=self._on_call)
        return RuleSynthesisAdapter()

    def _improvement_adapter(self):
        if self.session.improvementAdapter == "llm":
            return LlmImprovementAdapter(self._require_llm(), on_call=self._on_call)
        return RuleImprovementAdapter()

    def _require_llm(self) -> LlmClient:
        if self.llm is None or not self.llm.available:
            raise ModelNotConfigured(
                "이 session은 온라인 어댑터로 설정됐지만 모델이 구성되어 있지 않다. "
                "실패를 scripted 결과로 대체하지 않는다.")
        return self.llm

    def _check_budget(self) -> None:
        """Only the model paths consume budget; a rule session cannot exhaust it."""
        if not self._uses_model:
            return
        if self.session.callBudget and self.session.callsUsed >= self.session.callBudget:
            raise BudgetExhausted(
                "모델 호출 예산 %d회를 모두 썼다." % self.session.callBudget)
        if self.session.tokenBudget and self.session.tokensUsed >= self.session.tokenBudget:
            raise BudgetExhausted(
                "토큰 예산 %d를 모두 썼다." % self.session.tokenBudget)

    @property
    def _uses_model(self) -> bool:
        return "llm" in (self.session.reviewAdapter, self.session.improvementAdapter)

    # -- control ----------------------------------------------------------
    def request_pause(self) -> None:
        self._pause = True

    def request_cancel(self) -> None:
        self._cancel = True

    def run(self, max_steps: int = 64) -> IterationSession:
        """Advance until the session blocks, finishes, is paused or cancelled."""
        for _ in range(max_steps):
            if self._cancel:
                return self._stop(SessionStatus.cancelled, "cancelled")
            if self._pause:
                return self._pause_now()
            if self.session.status not in _RUNNABLE:
                return self.session
            self.step()
        return self._stop(SessionStatus.failed, "step_limit",
                          "상태 전이가 %d회를 넘겼다. 무한 루프를 의심한다." % max_steps)

    def step(self) -> IterationSession:
        handler = {
            SessionStatus.created: self._start,
            SessionStatus.running_cycle: self._run_cycle,
            SessionStatus.collecting_reviews: self._collect_reviews,
            SessionStatus.synthesizing: self._synthesise,
            SessionStatus.proposing_changes: self._propose,
            SessionStatus.validating_changes: self._validate,
            SessionStatus.evaluating_candidates: self._evaluate,
            SessionStatus.selecting_next: self._select,
        }.get(self.session.status)
        if handler is None:
            return self.session
        try:
            handler()
        except BudgetExhausted as exc:
            return self._stop(SessionStatus.budget_exhausted, "budget_exhausted", str(exc))
        except (ModelNotConfigured, ModelCallError, ReviewAdapterError) as exc:
            # A model outage is a tooling failure. It is never recorded as a
            # resident declining, and never replaced by a scripted success.
            return self._stop(SessionStatus.failed, "model_failure", str(exc))
        except LongitudinalNotImplemented as exc:
            return self._stop(SessionStatus.failed, "unsupported_mode", str(exc))
        except Exception as exc:  # noqa: BLE001 - recorded with its type
            return self._stop(SessionStatus.failed, "engine_error",
                              "%s: %s" % (type(exc).__name__, exc))
        self._touch()
        return self.session

    # -- transitions ------------------------------------------------------
    def _start(self) -> None:
        if self.session.mode.value == "longitudinal":
            raise LongitudinalNotImplemented(
                "다일(longitudinal) 모드는 이 빌드에서 실행하지 않는다. 하루 단위 "
                "controlled_iteration만 지원한다.")
        existing = self.store.list_generations(self.session.id)
        if not existing:
            generation = Generation(
                id="gen-%s-0" % self.session.id[-8:],
                sessionId=self.session.id, index=0, parentGenerationId=None,
                policyRevisionId=self.session.basePolicyRevisionId,
                label="v0 · %s" % self._policy(self.session.basePolicyRevisionId)["label"],
                outcome=GenerationOutcome.running, createdAt=now_iso())
            self.store.save_generation(generation)
        self.session.status = SessionStatus.running_cycle

    def _run_cycle(self) -> None:
        generation = self._current()
        if not generation.attemptIds:
            attempt_ids = []
            for deck_id in self.session.developmentDeckRefs:
                detail = self.service.create_attempt(
                    generation.policyRevisionId, deck_id,
                    self.session.resourceRevisionId,
                    label="%s · %s" % (generation.label, DECKS[deck_id].label),
                    adapter=self.session.behaviourAdapter)
                attempt_ids.append(detail["attempt"]["id"])
            generation.attemptIds = attempt_ids
            generation.outcome = GenerationOutcome.running
            self.store.update_generation(generation)
        self.session.status = SessionStatus.collecting_reviews

    def _collect_reviews(self) -> None:
        generation = self._current()
        if not generation.reviewIds:
            reviews = self._reviews_for(generation)
            self.store.save_agent_reviews(generation.id, reviews)
            generation.reviewIds = [r.id for r in reviews]
            generation.metrics = self._generation_metrics(generation, reviews)
            generation.outcome = GenerationOutcome.reviewed
            self.store.update_generation(generation)
        self.session.status = SessionStatus.synthesizing

    def _reviews_for(self, generation: Generation) -> list[AgentReview]:
        """One review per actor per attempt, validated against its own experience."""
        adapter = self._review_adapter()
        personas = {p["subjectId"]: p for p in
                    self.service.personas_payload()["profiles"]}
        resident_ids = [r["id"] for r in self.service.village.residents]
        out: list[AgentReview] = []

        for attempt_id in generation.attemptIds:
            row = self.store.get_attempt(attempt_id)
            events = self.store.events(attempt_id)
            deck = DECKS[row["attempt"]["scenarioDeckId"]]
            experiences = build_all_experiences(
                attempt=row["attempt"], events=events, metrics=row["metrics"],
                personas=personas, resident_ids=resident_ids,
                cycle_end_ms=deck.horizonMs)
            for actor_id, experience in sorted(experiences.items()):
                self._check_budget()
                review_id = "rev-%s-%s-%s" % (generation.id, attempt_id[-8:], actor_id)
                cache_key = content_hash([
                    self.session.id, generation.id, "review", actor_id, attempt_id,
                    experience.event_ids])
                cached = (self.store.cached_model_result(cache_key)
                          if self.session.reviewAdapter == "llm" else None)
                if cached is not None:
                    review = AgentReview.model_validate(cached)
                else:
                    review = adapter.review(
                        experience, session_id=self.session.id,
                        generation_index=generation.index, created_at=now_iso(),
                        review_id=review_id)
                    if self.session.reviewAdapter == "llm":
                        self.store.cache_model_result(
                            cache_key, session_id=self.session.id, role="review",
                            subject=actor_id, created_at=now_iso(),
                            result=review.model_dump(mode="json"))
                # The same boundary check for every adapter. A model that cites
                # somebody else's private event fails here, loudly.
                validate_review(review, experience)
                out.append(review)
        return out

    def _synthesise(self) -> None:
        generation = self._current()
        if not generation.synthesisId:
            reviews = [AgentReview.model_validate(r)
                       for r in self.store.agent_reviews(generation.id)]
            self._check_budget()
            synthesis = self._synthesis_adapter().synthesise(
                reviews=reviews,
                objective_metrics=generation.metrics.get("objective", {}),
                session_id=self.session.id, generation_index=generation.index,
                attempt_ids=generation.attemptIds, created_at=now_iso(),
                synthesis_id="syn-%s" % generation.id)
            self.store.save_synthesis(generation.id, synthesis)
            generation.synthesisId = synthesis.id
            self.store.update_generation(generation)
        self.session.status = SessionStatus.proposing_changes

    def _propose(self) -> None:
        generation = self._current()
        # The last planned generation is reviewed and compared, but nothing new is
        # proposed from it: the loop ends with a designer choice, not with another
        # automatic change.
        if generation.index + 1 >= self.session.maxGenerations:
            generation.outcome = GenerationOutcome.final
            self.store.update_generation(generation)
            self._stop(SessionStatus.ready_for_designer, "reached_max_generations")
            return

        if not generation.proposalIds:
            synthesis = ReviewSynthesis.model_validate(
                self.store.synthesis(generation.synthesisId))
            policy = self._policy(generation.policyRevisionId)
            self._check_budget()
            proposals, no_change = self._improvement_adapter().propose(
                synthesis=synthesis, policy=policy,
                allowed_paths=self.session.allowedPatchPaths,
                capabilities=list(SUPPORTED_CAPABILITIES),
                criteria=[c.model_dump(mode="json")
                          for c in self.session.criteriaRevision.criteria],
                core_item=self.session.coreItem,
                max_candidates=self.session.maxCandidatesPerGeneration,
                session_id=self.session.id, generation_index=generation.index,
                created_at=now_iso(), id_prefix="prop-%s" % generation.id,
                already_tried=self.store.session_patch_hashes(self.session.id))
            if proposals:
                self.store.save_proposals(generation.id, proposals)
                generation.proposalIds = [p.id for p in proposals]
            generation.outcome = GenerationOutcome.proposed
            self.store.update_generation(generation)
            if no_change and not any(p.patch for p in proposals):
                self._stop(SessionStatus.no_valid_change, "no_valid_change", no_change)
                return
        self.session.status = SessionStatus.validating_changes

    def _validate(self) -> None:
        generation = self._current()
        policy = self._policy(generation.policyRevisionId)
        reviews = self.store.agent_reviews(generation.id)
        known_items = {"%s#%d" % (r["id"], i)
                       for r in reviews for i in range(len(r["items"]))}
        world_truth = self._world_truth_event_ids(generation)
        applied = self._applied_patch_hashes()

        checked: list[ChangeProposal] = []
        for row in self.store.proposals(generation.id):
            proposal = ChangeProposal.model_validate(row)
            if proposal.validationStatus is not ProposalValidation.pending:
                checked.append(proposal)
                continue
            result = validate_proposal(
                proposal, policy=policy,
                allowed_paths=self.session.allowedPatchPaths,
                known_review_items=known_items,
                world_truth_event_ids=world_truth,
                applied_patch_hashes=applied)
            self.store.update_proposal(result)
            checked.append(result)

        runnable = [p for p in checked if p.validationStatus is ProposalValidation.valid]
        if not runnable:
            blocked = [p for p in checked
                       if p.validationStatus is ProposalValidation.requires_implementation]
            repeats = [p for p in checked
                       if any("반복" in e or "이미 적용" in e for e in p.validationErrors)]
            generation.outcome = GenerationOutcome.blocked
            self.store.update_generation(generation)
            if repeats and len(repeats) == len(checked):
                self._stop(SessionStatus.stalled, "stalled",
                           "제안된 변경이 이미 적용한 것과 같다.")
            else:
                self._stop(
                    SessionStatus.no_valid_change, "no_valid_change",
                    ("실행 가능한 정책 변경이 없다. 구현이 필요한 제안 %d건은 기록해 두었다."
                     % len(blocked)) if blocked else
                    "제안이 모두 검증을 통과하지 못했다.")
            return
        self.session.status = SessionStatus.evaluating_candidates

    def _evaluate(self) -> None:
        """Run every valid candidate as its own generation, then measure it."""
        generation = self._current()
        children_by_proposal = {
            g["selectedProposalId"]: g
            for g in self.store.list_generations(self.session.id)
            if g["parentGenerationId"] == generation.id and g["selectedProposalId"]}

        for row in self.store.proposals(generation.id):
            proposal = ChangeProposal.model_validate(row)
            if proposal.validationStatus is not ProposalValidation.valid:
                continue
            if proposal.id in children_by_proposal:
                continue  # already run before a restart
            policy = self._policy(generation.policyRevisionId)
            revision = self.service.create_policy(
                policy["id"], patch_to_changes(policy, proposal.patch),
                reason="ChangeProposal %s: %s" % (proposal.id, proposal.mechanism),
                label="v%d · %s" % (generation.index + 1, proposal.label))
            child = Generation(
                id="gen-%s-%d-%s" % (self.session.id[-8:], generation.index + 1, _short()),
                sessionId=self.session.id, index=generation.index + 1,
                parentGenerationId=generation.id, policyRevisionId=revision.id,
                label="v%d · %s" % (generation.index + 1, proposal.label),
                selectedProposalId=proposal.id, outcome=GenerationOutcome.running,
                createdAt=now_iso())
            self.store.save_generation(child)

            attempt_ids = []
            for deck_id in self.session.developmentDeckRefs:
                detail = self.service.create_attempt(
                    revision.id, deck_id, self.session.resourceRevisionId,
                    label="%s · %s" % (child.label, DECKS[deck_id].label),
                    adapter=self.session.behaviourAdapter)
                attempt_ids.append(detail["attempt"]["id"])
            child.attemptIds = attempt_ids
            self.store.update_generation(child)

            reviews = self._reviews_for(child)
            self.store.save_agent_reviews(child.id, reviews)
            child.reviewIds = [r.id for r in reviews]
            child.metrics = self._generation_metrics(child, reviews)
            child.metrics["comparedToParent"] = self._compare(generation, child)
            child.outcome = GenerationOutcome.evaluated
            self.store.update_generation(child)

            proposal = proposal.model_copy(update={
                "resultingPolicyRevisionId": revision.id,
                "resultingAttemptId": attempt_ids[0] if attempt_ids else None})
            self.store.update_proposal(proposal)

        generation.branchGenerationIds = [
            g["id"] for g in self.store.list_generations(self.session.id)
            if g["parentGenerationId"] == generation.id]
        generation.outcome = GenerationOutcome.evaluated
        self.store.update_generation(generation)
        self.session.status = SessionStatus.selecting_next

    def _select(self) -> None:
        generation = self._current()
        children = [Generation.model_validate(g)
                    for g in self.store.list_generations(self.session.id)
                    if g["parentGenerationId"] == generation.id]
        if not children:
            self._stop(SessionStatus.no_valid_change, "no_valid_change",
                       "실행된 후보가 없다.")
            return

        incumbent = {"id": generation.id, "label": generation.label,
                     "vector": generation.metrics.get("vector", {})}
        candidates = [{"id": c.id, "label": c.label,
                       "vector": c.metrics.get("vector", {})} for c in children]
        verdict = evaluate(incumbent=incumbent, candidates=candidates,
                           criteria=self.session.criteriaRevision,
                           selection_rule=self.session.selectionRule)

        by_id = {c.id: c for c in children}
        for row in self.store.proposals(generation.id):
            proposal = ChangeProposal.model_validate(row)
            child = next((c for c in children
                          if c.selectedProposalId == proposal.id), None)
            if child is None:
                continue
            if verdict["selected"] == child.id:
                status = ProposalSelection.selected
            elif any(d["id"] == child.id for d in verdict["dominated"]):
                status = ProposalSelection.dominated
            elif any(d["id"] == child.id for d in verdict["excluded"]):
                status = ProposalSelection.rejected
            else:
                status = ProposalSelection.branch
            self.store.update_proposal(proposal.model_copy(
                update={"selectionStatus": status}))

        generation.selectionReason = verdict["reason"]
        generation.metrics["selection"] = verdict
        self.store.update_generation(generation)

        if verdict["decision"] == "advance":
            winner = by_id[verdict["selected"]]
            winner.selectedBy = "auto"
            winner.selectionReason = verdict["reason"]
            winner.outcome = GenerationOutcome.running
            self.store.update_generation(winner)
            for other in children:
                if other.id == winner.id:
                    continue
                other.outcome = GenerationOutcome.blocked
                other.selectionReason = "분기로 보존한다. 삭제하지 않는다."
                self.store.update_generation(other)
            generation.outcome = GenerationOutcome.advanced
            self.store.update_generation(generation)
            self.session.currentGenerationIndex = winner.index
            self._current_id = winner.id
            self.session.status = SessionStatus.running_cycle
            return

        reason = {"needs_decision": "needs_decision",
                  "no_progress": "stalled",
                  "no_valid": "no_valid_change"}[verdict["decision"]]
        status = {"needs_decision": SessionStatus.needs_decision,
                  "no_progress": SessionStatus.stalled,
                  "no_valid": SessionStatus.no_valid_change}[verdict["decision"]]
        for child in children:
            child.outcome = GenerationOutcome.blocked
            child.selectionReason = verdict["reason"]
            self.store.update_generation(child)
        self._stop(status, reason, verdict["reason"])

    # -- helpers ----------------------------------------------------------
    _current_id: str | None = None

    def _current(self) -> Generation:
        rows = self.store.list_generations(self.session.id)
        if self._current_id:
            row = next((g for g in rows if g["id"] == self._current_id), None)
            if row is not None:
                return Generation.model_validate(row)
        # After a restart: the current generation is the deepest one that was
        # either started or chosen, never a branch that lost.
        live = [g for g in rows
                if g["index"] == self.session.currentGenerationIndex
                and g["outcome"] != GenerationOutcome.blocked.value]
        if not live:
            live = [g for g in rows if g["index"] == self.session.currentGenerationIndex]
        if not live:
            raise IterationError("세대 기록을 찾지 못했다: %s" % self.session.id)
        chosen = live[-1]
        self._current_id = chosen["id"]
        return Generation.model_validate(chosen)

    def _policy(self, policy_id: str) -> dict[str, Any]:
        policy = self.service.policies.get(policy_id)
        if policy is None:
            raise IterationError("알 수 없는 정책 revision: %s" % policy_id)
        return policy.model_dump(mode="json")

    def _generation_metrics(self, generation: Generation,
                            reviews: list[AgentReview]) -> dict[str, Any]:
        vectors = []
        objective: dict[str, Any] = {}
        for attempt_id in generation.attemptIds:
            row = self.store.get_attempt(attempt_id)
            attempt_reviews = [r for r in reviews if r.attemptId == attempt_id]
            vectors.append(outcome_vector(row["metrics"], attempt_reviews))
            objective[attempt_id] = {
                "deckId": row["attempt"]["scenarioDeckId"],
                "requests": row["metrics"]["requests"],
                "waitMs": row["metrics"]["waitMs"],
                "contacts": row["metrics"]["contacts"],
                "neighbourMinutes": row["metrics"]["neighbourMinutes"],
                "institutionBurden": row["metrics"]["institutionBurden"],
                "disclosure": row["metrics"]["disclosure"],
                "transport": row["metrics"].get("transport", {}),
                "residentBurden": row["metrics"]["residentBurden"],
            }
        vector = combine_vectors(vectors)
        return {
            "vector": vector,
            "objective": objective,
            "requiredViolations": violates_required(vector,
                                                    self.session.criteriaRevision),
            "reviewCounts": _review_counts(reviews),
            "note": ("모의 리뷰 집계와 로그 기반 지표를 함께 두되 하나의 만족도 점수로 "
                     "합치지 않는다."),
        }

    def _compare(self, parent: Generation, child: Generation) -> dict[str, Any]:
        """Policy diff and controlled-input check, computed not narrated."""
        rows = []
        for attempt_id in (parent.attemptIds[:1] + child.attemptIds[:1]):
            row = self.store.get_attempt(attempt_id)
            rows.append({"attempt": row["attempt"], "metrics": row["metrics"],
                         "policy": row["policy"],
                         "policyLabel": row["policy"]["label"],
                         "contactStrategy": row["policy"]["contactStrategy"],
                         "changes": row["policy"]["changes"],
                         "trace": row["trace"]})
        comparison = compare_runs(rows) if len(rows) == 2 else {}
        before = self.store.get_attempt(parent.attemptIds[0])["metrics"] \
            if parent.attemptIds else {}
        after = self.store.get_attempt(child.attemptIds[0])["metrics"] \
            if child.attemptIds else {}
        comparison["perActor"] = per_actor_delta(before, after)
        return comparison

    def _world_truth_event_ids(self, generation: Generation) -> set[str]:
        out: set[str] = set()
        for attempt_id in generation.attemptIds:
            for event in self.store.events(attempt_id):
                if event.get("visibility") == ["RESEARCHER"]:
                    out.add(event["id"])
        return out

    def _applied_patch_hashes(self) -> set[str]:
        """Patches that already produced a generation, so the loop can notice
        itself going round in circles."""
        out: set[str] = set()
        generations = {g["id"] for g in self.store.list_generations(self.session.id)}
        for generation_id in generations:
            for row in self.store.proposals(generation_id):
                if row.get("resultingPolicyRevisionId") and row.get("patchHash"):
                    out.add(row["patchHash"])
        return out

    def _touch(self) -> None:
        self.session.updatedAt = now_iso()
        self.store.update_session(self.session)

    def _pause_now(self) -> IterationSession:
        self.session.pausedFrom = self.session.status.value
        self.session.status = SessionStatus.paused
        self.session.stopReason = None
        self._touch()
        return self.session

    def _stop(self, status: SessionStatus, reason: str,
              detail: str | None = None) -> IterationSession:
        self.session.status = status
        self.session.stopReason = reason
        self.session.stopDetail = detail or STOP_REASON_TEXT.get(reason)
        self._touch()
        return self.session


_RUNNABLE = frozenset({
    SessionStatus.created, SessionStatus.running_cycle,
    SessionStatus.collecting_reviews, SessionStatus.synthesizing,
    SessionStatus.proposing_changes, SessionStatus.validating_changes,
    SessionStatus.evaluating_candidates, SessionStatus.selecting_next,
})


def _review_counts(reviews: list[AgentReview]) -> dict[str, int]:
    counts = {"positive": 0, "mixed": 0, "negative": 0, "unknown": 0,
              "actors": len({r.actorId for r in reviews}),
              "noExperience": 0}
    for review in reviews:
        if review.usageStatus.value == "no_experience":
            counts["noExperience"] += 1
        for item in review.items:
            counts[item.assessment] += 1
    return counts
