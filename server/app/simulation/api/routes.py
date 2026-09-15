"""HTTP surface for the research simulator.

This module starts with no API key and no model: the default adapters are rules,
and an online adapter can only be chosen when the server process was given a key
(see server/.env.example).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..contracts import ContactStrategy, ENGINE_VERSION
from ..iteration.api import router as iteration_router, set_iteration_service
from ..iteration.service import IterationService
from ..persistence.store import AttemptExists, CommandConflict
from ..service import (
    ForkPrefixMismatch,
    SimulationService,
    UnsupportedPolicyField,
    build_comparison,
)

router = APIRouter(prefix="/api/sim", tags=["simulation"])
_service: SimulationService | None = None


def get_service() -> SimulationService:
    global _service
    if _service is None:
        # The real server reads its model configuration from the environment
        # (server/.env via run.sh). Tests inject a service with no provider.
        from ..agents.provider import ModelProvider, policy_from_env
        provider = ModelProvider.from_env()
        set_service(SimulationService(
            provider=provider if provider.available else None,
            model_policy=policy_from_env(mode="off")))
    return _service  # type: ignore[return-value]


def set_service(service: SimulationService) -> None:
    """Used by tests to inject an in-memory store."""
    global _service
    _service = service
    # The iteration service is built on the same store and the same village, so
    # a test that injects one gets a matching one for the loop rather than a
    # second service quietly pointing at the default database.
    set_iteration_service(IterationService(service))


class CreateAttemptBody(BaseModel):
    policyId: str
    scenarioDeckId: str = "deck-p1-no-response-v1"
    resourceRevisionId: str = "assumed-resources-v1"
    label: str | None = None
    seed: int = 17
    adapter: str = "rule"
    institutionAdapter: str = "rule"


class CommandBody(BaseModel):
    commandId: str = Field(min_length=1)
    name: str
    seq: int | None = None


class RerunBody(BaseModel):
    """Same initial state, edited policy. Not a branch in time."""

    reason: str = Field(min_length=1)
    label: str | None = None
    contactStrategy: ContactStrategy | None = None
    params: dict[str, Any] = Field(default_factory=dict)


class ForkBody(RerunBody):
    """Branch at a point in the parent's log and change the policy there."""

    atSeq: int = Field(ge=1)


class PolicyBody(BaseModel):
    baseId: str
    reason: str = Field(min_length=1)
    label: str | None = None
    contactStrategy: ContactStrategy | None = None
    params: dict[str, Any] = Field(default_factory=dict)


class FindingBody(BaseModel):
    coreItem: str = Field(min_length=1)
    comparedAttemptIds: list[str] = Field(min_length=1)
    observation: str = Field(min_length=1)
    interpretation: str = Field(min_length=1)
    nextChange: str = Field(min_length=1)
    fromPolicyId: str


class ApplyFindingBody(BaseModel):
    attemptId: str
    mode: str = "rerun"
    atSeq: int | None = None
    contactStrategy: ContactStrategy | None = None
    params: dict[str, Any] = Field(default_factory=dict)


@router.get("/health")
def health() -> dict[str, Any]:
    service = get_service()
    from ..iteration.api import get_iteration_service

    model = get_iteration_service().llm.describe()
    return {
        "status": "ok",
        "engineVersion": ENGINE_VERSION,
        "dataSource": service.village.data_source,
        "isSynthetic": service.village.is_synthetic,
        # Say what is actually configured rather than a fixed "none": the loop
        # runs offline by default, and reports honestly when a model is wired.
        "modelCalls": "available" if model["configured"] else "none",
        "model": model,
        "note": ("규칙 어댑터만 쓰면 API 키가 필요 없습니다. 온라인 리뷰·개선 어댑터는 "
                 "서버 환경변수에 키가 있을 때만 선택할 수 있습니다."),
    }


@router.get("/catalog")
def catalog() -> dict[str, Any]:
    return get_service().catalog()


@router.get("/village")
def village() -> dict[str, Any]:
    return get_service().village_payload()


@router.get("/village/map")
def village_map() -> Any:
    """The source's own map raster.

    Served from the git-ignored registry rather than bundled: it is research
    material, so it stays out of the repository and out of the front-end build.
    """
    path = get_service().village.map_image_path()
    if path is None:
        raise HTTPException(
            status_code=404,
            detail=("이 레지스트리에는 원본 지도 래스터가 없다. "
                    "python -m import_village 로 다시 만들면 포함된다."))
    return FileResponse(path, media_type="image/png")


@router.post("/attempts")
def create_attempt(body: CreateAttemptBody) -> dict[str, Any]:
    try:
        return get_service().create_attempt(
            body.policyId, body.scenarioDeckId, body.resourceRevisionId,
            label=body.label, seed=body.seed, adapter=body.adapter,
            institution_adapter=body.institutionAdapter)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/attempts")
def list_attempts() -> dict[str, Any]:
    return {"attempts": [r["attempt"] for r in get_service().store.list_attempts()]}


@router.get("/attempts/{attempt_id}")
def get_attempt(attempt_id: str) -> dict[str, Any]:
    try:
        return get_service().get_attempt(attempt_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/attempts/{attempt_id}/events")
def get_events(attempt_id: str, after: int = 0) -> dict[str, Any]:
    service = get_service()
    if service.store.get_attempt(attempt_id) is None:
        raise HTTPException(status_code=404, detail="unknown attempt")
    return {"events": service.events(attempt_id, after=after)}


@router.get("/attempts/{attempt_id}/observations")
def get_observations(attempt_id: str, actorId: str | None = None) -> dict[str, Any]:
    service = get_service()
    if service.store.get_attempt(attempt_id) is None:
        raise HTTPException(status_code=404, detail="unknown attempt")
    return {"observations": service.observations(attempt_id, actorId),
            "note": "actorId를 주면 그 행위자가 실제로 볼 수 있었던 것만 반환한다."}


@router.get("/attempts/{attempt_id}/snapshot")
def snapshot(attempt_id: str, atMs: int | None = Query(default=None),
             seq: int | None = Query(default=None)) -> dict[str, Any]:
    """``seq`` is the authoritative cursor; ``atMs`` is kept for the map scrub."""
    if atMs is None and seq is None:
        raise HTTPException(status_code=400, detail="snapshot needs seq or atMs")
    try:
        return get_service().snapshot(attempt_id, at_ms=atMs, seq=seq)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/attempts/{attempt_id}/commands")
def command(attempt_id: str, body: CommandBody) -> dict[str, Any]:
    try:
        return get_service().command(attempt_id, body.commandId, body.name, body.seq)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except CommandConflict as exc:
        # 409, not 200 with somebody else's result: the same commandId with
        # different arguments is a client bug, not a duplicate.
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _changes(body: Any) -> dict[str, Any]:
    changes: dict[str, Any] = {"params": body.params}
    if body.contactStrategy is not None:
        changes["contactStrategy"] = body.contactStrategy
    if getattr(body, "label", None):
        changes["label"] = body.label
    return changes


@router.post("/attempts/{attempt_id}/rerun")
def rerun(attempt_id: str, body: RerunBody) -> dict[str, Any]:
    try:
        return get_service().rerun_attempt(attempt_id, _changes(body), body.reason,
                                           body.label)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except UnsupportedPolicyField as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/attempts/{attempt_id}/fork")
def fork(attempt_id: str, body: ForkBody) -> dict[str, Any]:
    try:
        return get_service().fork_attempt(attempt_id, body.atSeq, _changes(body),
                                          body.reason, body.label)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except UnsupportedPolicyField as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ForkPrefixMismatch as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except AttemptExists as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/policies")
def list_policies() -> dict[str, Any]:
    return {"policies": get_service().list_policies()}


@router.post("/policies")
def create_policy(body: PolicyBody) -> dict[str, Any]:
    """Edit a policy. Unsupported conditions are refused, never stored."""
    try:
        revision = get_service().create_policy(body.baseId, _changes(body), body.reason,
                                               label=body.label)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except UnsupportedPolicyField as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return revision.model_dump(mode="json")


@router.get("/personas")
def personas() -> dict[str, Any]:
    """Compiled profiles and evidence cards. Names and quotes never leave the
    local source file, so nothing here can carry them."""
    return get_service().personas_payload()


@router.get("/findings")
def list_findings() -> dict[str, Any]:
    return {"findings": get_service().list_findings()}


@router.post("/findings")
def create_finding(body: FindingBody) -> dict[str, Any]:
    return get_service().create_finding(
        body.coreItem, body.comparedAttemptIds, body.observation,
        body.interpretation, body.nextChange, body.fromPolicyId)


@router.post("/findings/{finding_id}/apply")
def apply_finding(finding_id: str, body: ApplyFindingBody) -> dict[str, Any]:
    """Turn a finding into the next revision and the next attempt."""
    try:
        return get_service().apply_finding(
            finding_id, body.attemptId, _changes(body), mode=body.mode,
            at_seq=body.atSeq)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except UnsupportedPolicyField as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ForkPrefixMismatch as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/compare")
def compare(ids: str = Query(..., description="comma separated attempt ids")) -> dict[str, Any]:
    wanted = [i for i in ids.split(",") if i]
    if len(wanted) < 2:
        raise HTTPException(status_code=400, detail="compare needs at least two attempts")
    try:
        return build_comparison(get_service(), wanted)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def create_app() -> FastAPI:
    app = FastAPI(title="MEDial research simulator", version=ENGINE_VERSION)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)
    app.include_router(iteration_router)
    return app
