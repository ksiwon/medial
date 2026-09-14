"""Application service around the iteration engine.

The engine is a state machine; this is what starts it, stops it, keeps one
running per session, and turns the stored records into the payloads the screens
read.

The automatic part stops after drafting and mechanically validating Change Sets.
Only a researcher-confirmed Change Set may create and execute a MEDial revision.
"""
from __future__ import annotations

import threading
import uuid
from typing import Any

from pydantic import ValidationError

from ..decks.registry import DECKS, RESOURCE_SETS
from .contracts import (
    AgentReview,
    ChangeSet,
    ChangeSetConfirmation,
    ChangeSetValidation,
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
from .evaluation_metrics import DEFAULT_CRITERIA
from .validation import (
    SUPPORTED_QUESTS,
    SUPPORTED_RULE_FIELDS,
    SUPPORTED_TASKS,
    validate_change_set,
)


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
            "supportedQuestIds": sorted(SUPPORTED_QUESTS),
            "supportedTaskIds": sorted(SUPPORTED_TASKS),
            "supportedRuleFields": sorted(SUPPORTED_RULE_FIELDS),
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
                       max_generations: int = 3, max_change_sets: int = 2,
                       call_budget: int = 0, token_budget: int = 0,
                       criteria: CriteriaRevision | None = None,
                       mode: str = "controlled_iteration",
                       control: str = "bounded_auto",
                       behaviour_adapter: str = "rule",
                       review_adapter: str = "rule",
                       improvement_adapter: str = "rule") -> IterationSession:
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
            maxGenerations=max_generations, maxChangeSetsPerGeneration=max_change_sets,
            callBudget=call_budget, tokenBudget=token_budget,
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
        try:
            return IterationSession.model_validate(row)
        except ValidationError as exc:
            raise SessionNotRunnable(
                "이 세션은 폐기된 MEDial 반복 형식이라 현재 화면에서 열 수 없다. "
                "원본 기록은 보존되어 있으며 새 Quest/Task Change Set 세션을 시작해야 한다."
            ) from exc

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
        elif name == "confirm_change_set":
            result = self._confirm_change_set(session, payload, blocking=blocking)
        elif name == "save_researcher_change_set":
            result = self._save_researcher_change_set(session, payload)
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

    def _confirm_change_set(self, session: IterationSession, payload: dict[str, Any],
                            blocking: bool) -> dict[str, Any]:
        """Grant execution authority to one validated Change Set."""
        if session.status is not SessionStatus.awaiting_confirmation:
            raise SessionNotRunnable(
                "Change Set 확인을 기다리는 상태가 아니다 (현재 상태: %s)." % session.status.value)
        change_set_id = payload.get("changeSetId")
        reason = str(payload.get("reason") or "").strip()
        if not reason:
            raise ValueError("Change Set을 확정한 연구자 이유를 입력해야 한다.")
        generation = next((Generation.model_validate(row)
                           for row in self.store.list_generations(session.id)
                           if row["index"] == session.currentGenerationIndex
                           and row["outcome"] != GenerationOutcome.blocked.value), None)
        if generation is None:
            raise KeyError("현재 Quest 실행 기록을 찾지 못했다.")
        change_sets = [ChangeSet.model_validate(row)
                       for row in self.store.change_sets(generation.id)]
        chosen = next((item for item in change_sets if item.id == change_set_id), None)
        if chosen is None:
            raise KeyError("현재 주민 평가에서 나온 Change Set이 아니다: %s" % change_set_id)
        if chosen.validationStatus is not ChangeSetValidation.valid:
            raise ValueError("기계 검증을 통과한 Change Set만 확정할 수 있다.")
        if chosen.confirmationStatus is not ChangeSetConfirmation.draft:
            raise ValueError("이미 처리된 Change Set이다.")
        confirmed_at = now_iso()
        for item in change_sets:
            status = (ChangeSetConfirmation.confirmed if item.id == chosen.id
                      else ChangeSetConfirmation.declined
                      if item.validationStatus is ChangeSetValidation.valid
                      else item.confirmationStatus)
            self.store.update_change_set(item.model_copy(update={
                "confirmationStatus": status,
                "confirmationReason": reason if item.id == chosen.id else "",
                "confirmedAt": confirmed_at if item.id == chosen.id else None,
            }))
        session.status = SessionStatus.executing_revision
        session.stopReason = None
        session.stopDetail = None
        session.updatedAt = now_iso()
        self.store.update_session(session)
        engine = self._engine(session)
        engine._current_id = generation.id
        return self._spawn(session, blocking)

    def _save_researcher_change_set(
        self, session: IterationSession, payload: dict[str, Any]
    ) -> dict[str, Any]:
        """Save a researcher-authored revision without mutating its source draft."""
        if session.status is not SessionStatus.awaiting_confirmation:
            raise SessionNotRunnable(
                "Change Set 확인을 기다리는 상태에서만 직접 수정할 수 있다 "
                "(현재 상태: %s)." % session.status.value)
        generation = next((Generation.model_validate(row)
                           for row in self.store.list_generations(session.id)
                           if row["index"] == session.currentGenerationIndex), None)
        if generation is None:
            raise KeyError("현재 Quest 실행 기록을 찾지 못했다.")
        change_sets = [ChangeSet.model_validate(row)
                       for row in self.store.change_sets(generation.id)]
        template_id = str(payload.get("templateChangeSetId") or "")
        template = next((item for item in change_sets if item.id == template_id), None)
        if template is None:
            raise KeyError("현재 주민 평가의 Change Set 초안이 아니다: %s" % template_id)
        if template.validationStatus is not ChangeSetValidation.valid:
            raise ValueError("검증된 Change Set을 바탕으로만 직접 작성할 수 있다.")

        label = str(payload.get("label") or "").strip()
        mechanism = str(payload.get("mechanism") or "").strip()
        if not label or not mechanism:
            raise ValueError("연구자 Change Set의 이름과 변경 원리를 모두 입력해야 한다.")
        after_rules = payload.get("afterRules") or []
        binding_values = payload.get("bindingValues") or {}
        changes = []
        for index, change in enumerate(template.changes):
            after_rule = (str(after_rules[index]).strip()
                          if index < len(after_rules) else change.afterRule)
            bindings = [binding.model_copy(update={
                "after": binding_values.get(binding.key, binding.after),
            }) for binding in change.executionBindings]
            changes.append(change.model_copy(update={
                "afterRule": after_rule,
                "executionBindings": bindings,
            }))

        authored = template.model_copy(update={
            "id": "cs-researcher-%s" % uuid.uuid4().hex[:10],
            "label": label,
            "mechanism": mechanism,
            "changes": changes,
            "expectedEffects": list(payload.get("expectedEffects") or []),
            "possibleRegressions": list(payload.get("possibleRegressions") or []),
            "watchNext": list(payload.get("watchNext") or []),
            "author": "researcher_hypothesis",
            "validationStatus": ChangeSetValidation.pending,
            "validationErrors": [],
            "confirmationStatus": ChangeSetConfirmation.draft,
            "confirmationReason": "",
            "confirmedAt": None,
            "resultingPolicyRevisionId": None,
            "resultingAttemptId": None,
            "adapter": "rule",
            "model": None,
            "createdAt": now_iso(),
            "changeHash": "",
        })
        policy = self.sim.policies[generation.policyRevisionId].model_dump(mode="json")
        checked = validate_change_set(
            authored,
            policy=policy,
            capabilities=tuple(SUPPORTED_CAPABILITIES),
            applied_change_hashes=set(self.store.session_applied_change_hashes(session.id)),
        )
        if checked.validationStatus is not ChangeSetValidation.valid:
            raise ValueError("직접 작성한 Change Set을 실행할 수 없다: "
                             + "; ".join(checked.validationErrors))

        source_id = str(payload.get("sourceChangeSetId") or "")
        if source_id:
            source = next((item for item in change_sets if item.id == source_id), None)
            if source is None:
                raise KeyError("수정 원본 Change Set을 찾지 못했다: %s" % source_id)
            self.store.update_change_set(source.model_copy(update={
                "confirmationStatus": ChangeSetConfirmation.superseded,
                "confirmationReason": "연구자 수정본 %s로 대체" % checked.id,
            }))
        self.store.save_change_sets(generation.id, [checked])
        generation.changeSetIds.append(checked.id)
        self.store.update_generation(generation)
        return {"changeSet": checked.model_dump(mode="json")}

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
                "changeSets": self.store.change_sets(generation.id),
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
        active: list[dict[str, Any]] = []
        for row in self.store.list_sessions():
            try:
                IterationSession.model_validate(row)
            except ValidationError:
                continue
            active.append(row)
        return active

    def generation_comparison(self, session_id: str) -> dict[str, Any]:
        """Confirmed MEDial revisions side by side; unexecuted drafts are not generations."""
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
                "confirmedBy": generation.confirmedBy,
                "confirmationReason": generation.confirmationReason,
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

        if session.status in (SessionStatus.ready_for_designer,
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
