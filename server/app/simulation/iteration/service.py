"""Application service around the iteration engine.

The engine is a state machine; this is what starts it, stops it, keeps one
running per session, and turns the stored records into the payloads the screens
read.

Bounded automatic running means what doc 12 section 8 says it means: the
designer fixes the generations, the budget, the editable fields and the
criteria *once*, presses start, and is not asked again unless the loop hits
something only they can settle. Pause, resume and cancel remain available
throughout, and pausing keeps the place in the machine rather than restarting
the generation.
"""
from __future__ import annotations

import threading
import uuid
from typing import Any

from ..decks.registry import DECKS, RESOURCE_SETS
from .contracts import (
    AgentReview,
    ChangeProposal,
    CriteriaRevision,
    DesignerDecision,
    EpisodeCard,
    FieldReviewPackage,
    Generation,
    GenerationOutcome,
    HumanReview,
    IterationSession,
    ReviewSynthesis,
    SessionControl,
    SessionMode,
    SessionStatus,
    STOP_REASON_TEXT,
)
from .engine import IterationEngine, now_iso
from .improvement import SUPPORTED_CAPABILITIES
from .llm import LlmClient, content_hash
from .selection import DEFAULT_CRITERIA
from .validation import default_allowed_paths


class SessionNotRunnable(RuntimeError):
    """A command asked for something this session's state does not allow."""


class IterationService:
    def __init__(self, simulation_service: Any,
                 llm_client: LlmClient | None = None) -> None:
        self.sim = simulation_service
        self.store = simulation_service.store
        self.llm = llm_client if llm_client is not None else LlmClient.from_env()
        self._engines: dict[str, IterationEngine] = {}
        self._threads: dict[str, threading.Thread] = {}
        self._lock = threading.Lock()

    # -- capability report ------------------------------------------------
    def capabilities(self) -> dict[str, Any]:
        """What this build can actually run, said plainly.

        Listed because doc 12 section 13 asks the tool not to present itself as a
        general medical-service designer when it implements two scenarios.
        """
        return {
            "supportedCapabilities": list(SUPPORTED_CAPABILITIES),
            "editablePolicyPaths": default_allowed_paths(),
            "decks": [{"id": d.id, "label": d.label} for d in DECKS.values()],
            "modes": {
                "controlled_iteration": True,
                # Kept visible and switched off, rather than quietly missing.
                "longitudinal": False,
            },
            "notImplemented": [
                "다일(longitudinal) 기억 - 하루 단위만 실행한다",
                "119 접수·출동·인계",
                "보건소장의 배정·우선순위",
                "지원 목록 밖의 서비스 절차 (사전 가능 시간 확인, 종료 통지 등)",
            ],
            "model": self.llm.describe(),
            "adapterModes": {
                "rule": "주민 행동·리뷰·개선 모두 규칙. 모델 호출 없음.",
                "hybrid": "주민 행동은 규칙, 리뷰/개선만 모델. 전체 주민 판단이 LLM이 아니다.",
                "scripted": "고정된 리뷰로 흐름만 확인한다. 모델 결과가 아니다.",
            },
        }

    # -- sessions ---------------------------------------------------------
    def create_session(self, *, label: str, core_item: str, base_policy_id: str,
                       development_decks: list[str], resource_id: str,
                       evaluation_decks: list[str] | None = None,
                       max_generations: int = 3, max_candidates: int = 2,
                       call_budget: int = 0, token_budget: int = 0,
                       allowed_paths: list[str] | None = None,
                       criteria: CriteriaRevision | None = None,
                       mode: str = "controlled_iteration",
                       control: str = "bounded_auto",
                       behaviour_adapter: str = "rule",
                       review_adapter: str = "rule",
                       improvement_adapter: str = "rule",
                       selection_rule: str = "pareto_then_stop") -> IterationSession:
        if base_policy_id not in self.sim.policies:
            raise KeyError("unknown policy %s" % base_policy_id)
        for deck_id in development_decks:
            if deck_id not in DECKS:
                raise KeyError("unknown deck %s" % deck_id)
        if resource_id not in RESOURCE_SETS:
            raise KeyError("unknown resource revision %s" % resource_id)
        if mode == "longitudinal":
            raise ValueError(
                "다일(longitudinal) 모드는 이 빌드에서 실행하지 않는다. 기본 모드는 "
                "하루 단위 controlled_iteration이며, 세대 비교는 같은 초기 하루에서만 한다.")
        if "llm" in (review_adapter, improvement_adapter) and not self.llm.available:
            raise ValueError(
                "온라인 어댑터를 선택했지만 모델 키가 서버에 설정되어 있지 않다. "
                "rule 또는 scripted 로 실행하거나 서버 환경변수를 설정한다. "
                "실패를 scripted 성공으로 대체하지 않는다.")

        village = self.sim.village
        persona = self.sim.personas_payload()["provenance"]
        # The snapshot every generation is reset to. Hashing it is what lets the
        # comparison say "same initial day" as a checked claim.
        snapshot = {
            "village": village.content_hash,
            "persona": persona.get("revisionId"),
            "resources": resource_id,
            "decks": sorted(development_decks),
            "engine": self.sim.catalog()["engineVersion"],
        }
        session = IterationSession(
            id="iter-%s" % uuid.uuid4().hex[:12],
            label=label, coreItem=core_item,
            briefRevision="brief-%s" % content_hash({"core": core_item})[:8],
            initialSnapshotRef="snapshot-%s" % content_hash(snapshot)[:12],
            initialSnapshotHash=content_hash(snapshot),
            personaRevisionId=persona.get("revisionId", "unknown"),
            worldRevisionId="village-" + village.content_hash,
            resourceRevisionId=resource_id,
            developmentDeckRefs=list(development_decks),
            evaluationDeckRefs=list(evaluation_decks or []),
            criteriaRevision=criteria or DEFAULT_CRITERIA,
            mode=SessionMode(mode), control=SessionControl(control),
            basePolicyRevisionId=base_policy_id,
            maxGenerations=max_generations, maxCandidatesPerGeneration=max_candidates,
            callBudget=call_budget, tokenBudget=token_budget,
            allowedPatchPaths=allowed_paths or default_allowed_paths(),
            selectionRule=selection_rule,  # type: ignore[arg-type]
            behaviourAdapter=behaviour_adapter,  # type: ignore[arg-type]
            reviewAdapter=review_adapter,  # type: ignore[arg-type]
            improvementAdapter=improvement_adapter,  # type: ignore[arg-type]
            createdAt=now_iso(), updatedAt=now_iso())
        self.store.save_session(session)
        return session

    def load(self, session_id: str) -> IterationSession:
        row = self.store.get_session(session_id)
        if row is None:
            raise KeyError("unknown iteration session %s" % session_id)
        return IterationSession.model_validate(row)

    def _engine(self, session: IterationSession,
                review_script: dict[str, Any] | None = None) -> IterationEngine:
        with self._lock:
            engine = self._engines.get(session.id)
            if engine is None:
                engine = IterationEngine(self.sim, session, llm_client=self.llm,
                                         review_script=review_script)
                self._engines[session.id] = engine
            else:
                engine.session = session
                if review_script:
                    engine.review_script = review_script
            return engine

    # -- commands ---------------------------------------------------------
    def command(self, session_id: str, command_id: str, name: str,
                payload: dict[str, Any] | None = None,
                blocking: bool = False) -> dict[str, Any]:
        payload = payload or {}
        session = self.load(session_id)
        request = {"name": name, "payload": payload}

        if name == "start":
            result = self._start(session, blocking=blocking)
        elif name == "pause":
            result = self._pause(session)
        elif name == "resume":
            result = self._resume(session, blocking=blocking)
        elif name == "cancel":
            result = self._cancel(session)
        elif name == "select_proposal":
            result = self._select_proposal(session, payload, blocking=blocking)
        else:
            raise ValueError("unknown iteration command %s" % name)

        stored, replayed = self.store.record_iteration_command(
            command_id, session_id, name, now_iso(), request, result)
        stored = dict(stored)
        stored["deduplicated"] = replayed
        return stored

    def _start(self, session: IterationSession, blocking: bool) -> dict[str, Any]:
        if session.status is not SessionStatus.created:
            raise SessionNotRunnable(
                "이미 시작한 session이다 (현재 상태: %s)." % session.status.value)
        return self._spawn(session, blocking)

    def _resume(self, session: IterationSession, blocking: bool) -> dict[str, Any]:
        if session.status is not SessionStatus.paused:
            raise SessionNotRunnable(
                "일시정지 상태가 아니다 (현재 상태: %s)." % session.status.value)
        session.status = SessionStatus(session.pausedFrom or
                                       SessionStatus.running_cycle.value)
        session.pausedFrom = None
        session.updatedAt = now_iso()
        self.store.update_session(session)
        return self._spawn(session, blocking)

    def _spawn(self, session: IterationSession, blocking: bool) -> dict[str, Any]:
        engine = self._engine(session)
        engine._pause = False
        engine._cancel = False
        if blocking:
            engine.run()
            return self.status(session.id)

        def loop() -> None:
            try:
                engine.run()
            except Exception:  # noqa: BLE001 - the engine records its own failure
                pass

        thread = threading.Thread(target=loop, name="iteration-%s" % session.id,
                                  daemon=True)
        with self._lock:
            self._threads[session.id] = thread
        thread.start()
        return self.status(session.id)

    def _pause(self, session: IterationSession) -> dict[str, Any]:
        engine = self._engines.get(session.id)
        if engine is not None:
            engine.request_pause()
        else:
            session.pausedFrom = session.status.value
            session.status = SessionStatus.paused
            session.updatedAt = now_iso()
            self.store.update_session(session)
        return self.status(session.id)

    def _cancel(self, session: IterationSession) -> dict[str, Any]:
        engine = self._engines.get(session.id)
        if engine is not None:
            engine.request_cancel()
        else:
            session.status = SessionStatus.cancelled
            session.stopReason = "cancelled"
            session.stopDetail = STOP_REASON_TEXT["cancelled"]
            session.updatedAt = now_iso()
            self.store.update_session(session)
        return self.status(session.id)

    def _select_proposal(self, session: IterationSession, payload: dict[str, Any],
                         blocking: bool) -> dict[str, Any]:
        """The designer settles a trade-off the loop refused to settle itself."""
        if session.status is not SessionStatus.needs_decision:
            raise SessionNotRunnable(
                "후보 선택이 필요한 상태가 아니다 (현재 상태: %s)." % session.status.value)
        proposal_id = payload.get("proposalId")
        reason = payload.get("reason") or "디자이너 선택"
        generations = [Generation.model_validate(g)
                       for g in self.store.list_generations(session.id)]
        winner = next((g for g in generations if g.selectedProposalId == proposal_id), None)
        if winner is None:
            raise KeyError("이 session에 그 제안으로 실행된 후보가 없다: %s" % proposal_id)

        for other in generations:
            if other.parentGenerationId == winner.parentGenerationId:
                other.outcome = (GenerationOutcome.running if other.id == winner.id
                                 else GenerationOutcome.blocked)
                other.selectedBy = "designer" if other.id == winner.id else "none"
                other.selectionReason = (reason if other.id == winner.id
                                         else "선택되지 않은 분기로 보존한다.")
                self.store.update_generation(other)

        session.currentGenerationIndex = winner.index
        session.status = SessionStatus.running_cycle
        session.stopReason = None
        session.stopDetail = None
        session.updatedAt = now_iso()
        self.store.update_session(session)
        engine = self._engine(session)
        engine._current_id = winner.id
        return self._spawn(session, blocking)

    # -- reads ------------------------------------------------------------
    def status(self, session_id: str) -> dict[str, Any]:
        session = self.load(session_id)
        generations = self.store.list_generations(session_id)
        return {
            "session": session.model_dump(mode="json"),
            "adapterMode": session.adapter_mode_label,
            "stopReasonText": (STOP_REASON_TEXT.get(session.stopReason or "")
                               or session.stopDetail),
            "generationCount": len(generations),
            "running": bool(self._threads.get(session_id)
                            and self._threads[session_id].is_alive()),
            "budget": {
                "callBudget": session.callBudget, "callsUsed": session.callsUsed,
                "tokenBudget": session.tokenBudget, "tokensUsed": session.tokensUsed,
                "note": ("계획값과 실제 사용량을 따로 센다. rule 어댑터는 모델을 "
                         "호출하지 않으므로 사용량이 0이다."),
            },
        }

    def detail(self, session_id: str) -> dict[str, Any]:
        session = self.load(session_id)
        generations = self.store.list_generations(session_id)
        out_generations = []
        for row in generations:
            generation = Generation.model_validate(row)
            out_generations.append({
                **row,
                "reviews": self.store.agent_reviews(generation.id),
                "synthesis": (self.store.synthesis(generation.synthesisId)
                              if generation.synthesisId else None),
                "proposals": self.store.proposals(generation.id),
                "policy": (self.sim.policies[generation.policyRevisionId]
                           .model_dump(mode="json")
                           if generation.policyRevisionId in self.sim.policies else None),
            })
        return {
            **self.status(session_id),
            "generations": out_generations,
            "decisions": self.store.decisions_for_session(session_id),
            "fieldPackages": self.store.field_packages(session_id),
            "humanReviews": self.store.human_reviews(session_id),
            "modelCalls": self.store.model_calls(session_id),
            "capabilities": self.capabilities(),
        }

    def list_sessions(self) -> list[dict[str, Any]]:
        return self.store.list_sessions()

    def generation_comparison(self, session_id: str) -> dict[str, Any]:
        """v0 / v1 / v2 side by side, including the branches that were not taken."""
        session = self.load(session_id)
        rows = [Generation.model_validate(g)
                for g in self.store.list_generations(session_id)]
        lineage = []
        for generation in rows:
            lineage.append({
                "id": generation.id, "index": generation.index,
                "label": generation.label,
                "parentGenerationId": generation.parentGenerationId,
                "policyRevisionId": generation.policyRevisionId,
                "outcome": generation.outcome.value,
                "selectedBy": generation.selectedBy,
                "selectionReason": generation.selectionReason,
                "vector": generation.metrics.get("vector", {}),
                "reviewCounts": generation.metrics.get("reviewCounts", {}),
                "requiredViolations": generation.metrics.get("requiredViolations", []),
                "comparedToParent": generation.metrics.get("comparedToParent"),
                "attemptIds": generation.attemptIds,
                "policy": (self.sim.policies[generation.policyRevisionId]
                           .model_dump(mode="json")
                           if generation.policyRevisionId in self.sim.policies else None),
            })
        return {
            "sessionId": session_id,
            "criteria": session.criteriaRevision.model_dump(mode="json"),
            "generations": lineage,
            "initialSnapshotHash": session.initialSnapshotHash,
            "note": ("세대 비교는 같은 초기 하루·같은 자원·같은 외생 사건에서 정책만 바꾼 "
                     "결과다. 입력이 하나라도 다르면 통제 비교로 표시하지 않는다."),
        }

    # -- designer decision & field review ---------------------------------
    def decide(self, session_id: str, *, disposition: str,
               generation_id: str | None, reasons: list[str],
               supported_conditions: list[str], tradeoffs: list[str],
               dissent: list[str], unanswered: list[str],
               alternatives: list[str] | None = None,
               designer_role: str = "researcher",
               build_package: bool = True) -> dict[str, Any]:
        """Record the choice, or the decision to hold. Both are decisions.

        A held session is not a failed one, and the last generation does not
        become the answer by having been last.
        """
        session = self.load(session_id)
        if generation_id is not None and self.store.get_generation(generation_id) is None:
            raise KeyError("unknown generation %s" % generation_id)
        if disposition == "adopt_for_field_review" and generation_id is None:
            raise ValueError("현장 검토로 보내려면 어떤 세대인지 지정해야 한다.")

        package = None
        if build_package and generation_id is not None:
            package = self.build_field_package(session_id, generation_id)

        decision = DesignerDecision(
            id="dec-%s" % uuid.uuid4().hex[:10], sessionId=session_id,
            designerRole=designer_role, chosenGenerationId=generation_id,
            disposition=disposition,  # type: ignore[arg-type]
            alternativesConsidered=alternatives or [
                g["id"] for g in self.store.list_generations(session_id)
                if g["id"] != generation_id],
            reasons=reasons, supportedConditions=supported_conditions,
            tradeoffs=tradeoffs, dissent=dissent, unansweredQuestions=unanswered,
            fieldReviewPackageId=package.id if package else None,
            createdAt=now_iso())
        self.store.save_decision(decision)

        if session.status in (SessionStatus.needs_decision,
                              SessionStatus.ready_for_designer,
                              SessionStatus.stalled,
                              SessionStatus.no_valid_change):
            session.updatedAt = now_iso()
            self.store.update_session(session)
        return {"decision": decision.model_dump(mode="json"),
                "package": package.model_dump(mode="json") if package else None}

    def build_field_package(self, session_id: str,
                            generation_id: str) -> FieldReviewPackage:
        """Three to five short scenes, not a log dump.

        Doc 12 section 11: a revisit shows a person a scene and asks what they
        would actually have done, *before* showing them what the model said.
        """
        session = self.load(session_id)
        row = self.store.get_generation(generation_id)
        if row is None:
            raise KeyError("unknown generation %s" % generation_id)
        generation = Generation.model_validate(row)
        reviews = [AgentReview.model_validate(r)
                   for r in self.store.agent_reviews(generation_id)]
        synthesis_row = (self.store.synthesis(generation.synthesisId)
                         if generation.synthesisId else None)
        synthesis = (ReviewSynthesis.model_validate(synthesis_row)
                     if synthesis_row else None)

        episodes: list[EpisodeCard] = []
        for review in _episode_order(reviews):
            if len(episodes) >= 5:
                break
            anchor = next((item for item in review.items
                           if item.assessment in ("negative", "mixed") and item.eventRefs),
                          None)
            if anchor is None:
                continue
            event = self._find_event(review.attemptId, anchor.eventRefs[0])
            if event is None:
                continue
            seq = int(event["seq"])
            episodes.append(EpisodeCard(
                id="epi-%s-%s" % (generation_id[-8:], review.actorId),
                attemptId=review.attemptId, actorId=review.actorId,
                title="%s · %s" % (review.actorId, anchor.dimension.value),
                fromSeq=max(1, seq - 2), toSeq=seq + 2,
                eventIds=anchor.eventRefs[:4],
                summary=anchor.reason,
                simulatedReviewId=review.id,
                preQuestion=("이런 상황이라면 실제로는 어떻게 하셨을 것 같습니까? "
                             "(모의 반응을 보여 드리기 전에 여쭙습니다)"),
                postQuestion=("모의 반응과 비교해 무엇이 다릅니까? 이 운영안이 실제로 "
                              "가능하겠습니까? 어떤 조건이면 달라집니까?")))

        policy = self.sim.policies.get(generation.policyRevisionId)
        package = FieldReviewPackage(
            id="pkg-%s" % uuid.uuid4().hex[:10], sessionId=session_id,
            generationId=generation_id, coreItem=session.coreItem,
            episodes=episodes,
            policySummary=([policy.label] + list(policy.changes)) if policy else [],
            openQuestions=(synthesis.nextQuestions if synthesis else []),
            dissentToShow=sorted({
                actor for group in (synthesis.issueGroups if synthesis else [])
                for actor in group.dissentingActors}),
            createdAt=now_iso())
        self.store.save_field_package(package)
        return package

    def submit_human_review(self, session_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """The only writer of ``source="human"``.

        Nothing in the automatic loop reaches this method, which is what makes
        "no human data exists until a person submits it" checkable rather than
        merely intended.
        """
        package = self.store.field_package(body["packageId"])
        if package is None:
            raise KeyError("unknown field review package %s" % body["packageId"])
        known = {e["id"] for e in package["episodes"]}
        unknown = [e for e in body.get("selectedEpisodeIds", []) if e not in known]
        if unknown:
            raise ValueError("이 패키지에 없는 장면을 참조한다: %s" % unknown)

        review = HumanReview(
            id="hum-%s" % uuid.uuid4().hex[:10], sessionId=session_id,
            packageId=body["packageId"], reviewerRole=body["reviewerRole"],
            relationshipToActor=body.get("relationshipToActor"),
            actorId=body.get("actorId"),
            selectedEpisodeIds=body.get("selectedEpisodeIds", []),
            elicitation=body["elicitation"],
            responses=body.get("responses", []),
            corrections=body.get("corrections", []),
            agreement=body.get("agreement", "unknown"),
            consentScope=body.get("consentScope", "unknown"),
            submittedAt=now_iso())
        self.store.save_human_review(review)
        return review.model_dump(mode="json")

    def _find_event(self, attempt_id: str, event_id: str) -> dict[str, Any] | None:
        for event in self.store.events(attempt_id):
            if event["id"] == event_id:
                return event
        return None


def _episode_order(reviews: list[AgentReview]) -> list[AgentReview]:
    """Hardest cases first, and never only the residents.

    A package built from the happiest reviews would be a demonstration, not a
    check. The institution's own review is pulled in for the same reason.
    """
    def key(review: AgentReview) -> tuple[int, int, str]:
        negatives = sum(1 for i in review.items if i.assessment == "negative")
        mixed = sum(1 for i in review.items if i.assessment == "mixed")
        return (-negatives, -mixed, review.actorId)

    residents = [r for r in reviews if r.actorRole != "health_staff"]
    institution = [r for r in reviews if r.actorRole == "health_staff"]
    return sorted(residents, key=key) + sorted(institution, key=key)
