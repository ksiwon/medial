"""GET /api/visits — recent visit history for DR3 continuity.

Returns the last N archived visits so the LiveIdleScreen can render
"이전 방문" cards à la the existing HomeScreen mock.
"""
from __future__ import annotations
from typing import Any
from fastapi import APIRouter, Query

from app.session.manager import recent_visits

router = APIRouter()


@router.get("/api/visits")
async def list_visits(limit: int = Query(default=5, ge=1, le=20)) -> dict[str, Any]:
    visits = recent_visits(limit=limit)
    return {"visits": visits, "total": len(visits)}
