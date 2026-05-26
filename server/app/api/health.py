"""GET /api/health — server status."""
from __future__ import annotations
import logging
from typing import Any
from fastapi import APIRouter

from app.config import get_settings
from app.modules.rag_pubmed import get_pubmed_rag
from app.modules.rag_ddxplus import get_ddxplus
from app.session.dashboard_broadcaster import get_broadcaster

router = APIRouter()
log = logging.getLogger(__name__)


def _gpu_info() -> dict[str, Any]:
    try:
        import torch
        if not torch.cuda.is_available():
            return {"available": False}
        idx = 0
        return {
            "available": True,
            "name": torch.cuda.get_device_name(idx),
            "mem_allocated_gb": round(torch.cuda.memory_allocated(idx) / 1e9, 2),
            "mem_reserved_gb": round(torch.cuda.memory_reserved(idx) / 1e9, 2),
        }
    except Exception:
        return {"available": False}


@router.get("/api/health")
async def health() -> dict[str, Any]:
    s = get_settings()
    pubmed = get_pubmed_rag()
    ddx = get_ddxplus()
    broadcaster = get_broadcaster()

    stt_label = (
        f"openai/{s.STT_OPENAI_MODEL} (api)" if s.is_notebook
        else f"{s.STT_MODEL_ID} ({s.STT_DEVICE})"
    )
    return {
        "status": "ok",
        "run_mode": s.RUN_MODE,
        "llm_primary": s.LLM_PRIMARY_MODEL,
        "llm_fallback": s.LLM_FALLBACK_MODEL,
        "stt_model": stt_label,
        "tts_model": s.TTS_MODEL,
        "tts_voice": s.TTS_VOICE,
        "avatar_mode": s.AVATAR_MODE,
        "rag": {
            "pubmed_ready": pubmed.is_ready(),
            "pubmed_total": int(pubmed.index.ntotal) if pubmed.is_ready() else 0,
            "ddxplus_ready": ddx.is_ready(),
            "ddxplus_diseases": len(ddx.tree.get("diseases", {})),
        },
        "gpu": _gpu_info(),
        "dashboard_clients": len(broadcaster.clients),
        "google_api_key_set": bool(s.GOOGLE_API_KEY),
        "openai_api_key_set": bool(s.OPENAI_API_KEY),
    }
