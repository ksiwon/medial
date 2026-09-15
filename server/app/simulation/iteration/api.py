"""HTTP surface for the iteration loop.

Mounted under the same app as the attempt API. No key is read here and none is
ever returned: :meth:`LlmClient.describe` reports whether a model is configured
and which id, never the secret.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..decks.registry import ITERATION_START_POLICY
from ..persistence.iteration_store import ArtifactExists
from ..persistence.store import CommandConflict
from .service import IterationService, SessionNotRunnable

router = APIRouter(prefix="/api/sim/iteration", tags=["iteration"])

_service: IterationService | None = None


def get_iteration_service() -> IterationService:
    if _service is None:
        # Build it lazily from the same simulation service the rest of the API
        # uses, the way `get_service()` does. Wiring used to happen only inside
        # `set_service()`, so on a cold server every iteration endpoint answered
        # 503 until something touched /api/sim/* first - including the session
        # listing, which is how a researcher counts sessions.
        from ..api.routes import get_service  # imported here: routes imports us

        get_service()
    if _service is None:  # pragma: no cover - get_service always wires one
        raise HTTPException(status_code=503, detail="iteration service not configured")
    return _service


def set_iteration_service(service: IterationService | None) -> None:
    global _service
    _service = service


class CreateSessionBody(BaseModel):
    label: str = Field(min_length=1)
    coreItem: str = Field(min_length=1)
    basePolicyId: str = ITERATION_START_POLICY
    developmentDeckRefs: list[str] = Field(min_length=1)
    resourceRevisionId: str
    evaluationDeckRefs: list[str] = Field(default_factory=list)
    maxGenerations: int = Field(default=3, ge=1, le=10)
    maxChangeSetsPerGeneration: int = Field(default=2, ge=1, le=4)
    callBudget: int = Field(default=0, ge=0)
    tokenBudget: int = Field(default=0, ge=0)
    mode: str = "controlled_iteration"
    control: str = "bounded_auto"
    behaviourAdapter: str = "rule"
    reviewAdapter: str = "rule"
    improvementAdapter: str = "rule"


class CommandBody(BaseModel):
    commandId: str = Field(min_length=1)
    name: str
    payload: dict[str, Any] = Field(default_factory=dict)
    #: Tests and scripted demos run the loop inline; the UI does not, so that a
    #: long model-backed run does not hold the request open.
    blocking: bool = False


class DecisionBody(BaseModel):
    disposition: str
    generationId: str | None = None
    reasons: list[str] = Field(default_factory=list)
    supportedConditions: list[str] = Field(default_factory=list)
    tradeoffs: list[str] = Field(default_factory=list)
    dissent: list[str] = Field(default_factory=list)
    unansweredQuestions: list[str] = Field(default_factory=list)
    designerRole: str = "researcher"


class HumanReviewBody(BaseModel):
    """A real person's submission. Nothing else may write ``source="human"``."""

    packageId: str
    reviewerRole: str
    elicitation: str
    relationshipToActor: str | None = None
    actorId: str | None = None
    selectedEpisodeIds: list[str] = Field(default_factory=list)
    responses: list[dict[str, Any]] = Field(default_factory=list)
    corrections: list[dict[str, Any]] = Field(default_factory=list)
    agreement: str = "unknown"
    consentScope: str = "unknown"
    # -- the staged protocol (26번 C06)
    respondentId: str | None = None
    respondentRole: str = "self"
    subjectActorId: str | None = None
    episodeId: str | None = None
    reviewItemRefs: list[str] = Field(default_factory=list)
    responseStage: str = "pre_disclosure"
    disclosureRecordId: str | None = None
    correspondence: str | None = None
    correctionTarget: str | None = None
    reason: str = ""
    responseKind: str = "resident_response"


class DisclosureBody(BaseModel):
    """Recording that a respondent has now seen the simulated evaluation."""

    packageId: str
    episodeId: str
    respondentId: str
    disclosedBy: str = "researcher"
    shownReviewIds: list[str] = Field(default_factory=list)


@router.get("/capabilities")
def capabilities() -> dict[str, Any]:
    return get_iteration_service().capabilities()


@router.get("/sessions")
def list_sessions() -> dict[str, Any]:
    service = get_iteration_service()
    return {"sessions": service.list_sessions(),
            "startPolicyId": ITERATION_START_POLICY,
            "capabilities": service.capabilities()}


@router.post("/sessions")
def create_session(body: CreateSessionBody) -> dict[str, Any]:
    service = get_iteration_service()
    try:
        session = service.create_session(
            label=body.label, core_item=body.coreItem,
            base_policy_id=body.basePolicyId,
            development_decks=body.developmentDeckRefs,
            resource_id=body.resourceRevisionId,
            evaluation_decks=body.evaluationDeckRefs,
            max_generations=body.maxGenerations,
            max_change_sets=body.maxChangeSetsPerGeneration,
            call_budget=body.callBudget, token_budget=body.tokenBudget,
            mode=body.mode,
            control=body.control, behaviour_adapter=body.behaviourAdapter,
            review_adapter=body.reviewAdapter,
            improvement_adapter=body.improvementAdapter)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return service.detail(session.id)


@router.get("/sessions/{session_id}")
def session_detail(session_id: str) -> dict[str, Any]:
    try:
        return get_iteration_service().detail(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SessionNotRunnable as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/status")
def session_status(session_id: str) -> dict[str, Any]:
    try:
        return get_iteration_service().status(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SessionNotRunnable as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/generations")
def generations(session_id: str) -> dict[str, Any]:
    try:
        return get_iteration_service().generation_comparison(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SessionNotRunnable as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/commands")
def command(session_id: str, body: CommandBody) -> dict[str, Any]:
    service = get_iteration_service()
    try:
        return service.command(session_id, body.commandId, body.name, body.payload,
                               blocking=body.blocking)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CommandConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SessionNotRunnable as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/decision")
def decide(session_id: str, body: DecisionBody) -> dict[str, Any]:
    service = get_iteration_service()
    try:
        return service.decide(
            session_id, disposition=body.disposition,
            generation_id=body.generationId, reasons=body.reasons,
            supported_conditions=body.supportedConditions,
            tradeoffs=body.tradeoffs, dissent=body.dissent,
            unanswered=body.unansweredQuestions, designer_role=body.designerRole)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/field-package/{generation_id}")
def build_package(session_id: str, generation_id: str) -> dict[str, Any]:
    try:
        return get_iteration_service().build_field_package(
            session_id, generation_id).model_dump(mode="json")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/human-reviews")
def submit_human_review(session_id: str, body: HumanReviewBody) -> dict[str, Any]:
    """The only route that creates ``source="human"`` data.

    It is reachable only from a person filling in the field-review form; nothing
    in the automatic loop calls it, and no example submission is seeded.
    """
    service = get_iteration_service()
    try:
        return service.submit_human_review(session_id, body.model_dump())
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ArtifactExists as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/sessions/{session_id}/disclosures")
def record_disclosure(session_id: str, body: DisclosureBody) -> dict[str, Any]:
    """The hinge of the field protocol: before this, the answer is independent.

    Refused when this respondent has no pre-disclosure answer for the episode,
    because the comparison the study rests on would then have nothing to
    compare against.
    """
    service = get_iteration_service()
    try:
        return service.record_disclosure(session_id, body.model_dump())
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/sessions/{session_id}/human-reviews")
def list_human_reviews(session_id: str) -> dict[str, Any]:
    service = get_iteration_service()
    return {"humanReviews": service.store.human_reviews(session_id),
            "note": "실제 사람이 제출한 것만 들어 있다. 예시 제출을 만들지 않는다."}
