"""FastAPI entry point — wires routers and lifespan hooks."""
from __future__ import annotations
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.ws.consultation import router as consultation_router
from app.ws.dashboard import router as dashboard_router
from app.api.report import router as report_router
from app.api.health import router as health_router
from app.api.visits import router as visits_router
from app.api.meal import router as meal_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s :: %(message)s",
)
log = logging.getLogger("medial")


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    log.info("─" * 60)
    log.info(f"MEDial server starting — mode={s.RUN_MODE}  LLM={s.LLM_PRIMARY_MODEL}")
    if s.is_notebook:
        log.info(f"STT=openai/{s.STT_OPENAI_MODEL} (API)  — 로컬 Whisper 스킵")
    else:
        log.info(f"STT={s.STT_MODEL_ID} on {s.STT_DEVICE}")
    log.info(f"TTS={s.TTS_MODEL}/{s.TTS_VOICE}  Avatar={s.AVATAR_MODE}")
    log.info("─" * 60)
    # Eager-load modules at startup to fail fast.
    # 노트북 모드: Whisper 로컬 모델 없음 → get_stt()가 가볍게 완료됨.
    try:
        from app.modules.stt import get_stt
        from app.modules.tts import get_tts
        from app.modules.llm import get_llm
        from app.modules.rag_pubmed import get_pubmed_rag
        from app.modules.rag_ddxplus import get_ddxplus
        from app.modules.avatar import get_avatar
        get_pubmed_rag()
        get_ddxplus()
        get_tts()
        get_llm()
        get_avatar()
        get_stt()   # notebook: OpenAI client init (~즉시) / gpu_server: Whisper 로드 (~7 s)
    except Exception as e:
        log.exception(f"Startup load failed (some modules unavailable): {e}")
    log.info("Server ready.")
    yield
    log.info("Server stopping.")


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title="MEDial Live Demo Server",
        description="WebSocket + REST backend for the MEDial CHI '27 exhibition.",
        version="1.0.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(consultation_router)
    app.include_router(dashboard_router)
    app.include_router(report_router)
    app.include_router(health_router)
    app.include_router(visits_router)
    app.include_router(meal_router)
    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    s = get_settings()
    uvicorn.run(
        "app.main:app",
        host=s.HOST,
        port=s.PORT,
        reload=s.RELOAD,
        log_level=s.LOG_LEVEL,
    )
