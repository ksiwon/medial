"""Centralised pydantic-settings config — loads from .env."""
from __future__ import annotations
from functools import lru_cache
from typing import List
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ── Server ─────────────────────────────────────────
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    RELOAD: bool = False
    LOG_LEVEL: str = "info"
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:4173"

    # ── Gemini ─────────────────────────────────────────
    GOOGLE_API_KEY: str = ""
    LLM_PRIMARY_MODEL: str = "gemini-3.5-flash"
    LLM_FALLBACK_MODEL: str = "gemini-3.1-flash-lite"
    LLM_TIMEOUT_SECONDS: float = 6.0   # thinking off 시 ~1.5s, 변동 여유 포함
    LLM_MAX_OUTPUT_TOKENS: int = 1024  # 리포트 JSON 트렁케이션 방지
    LLM_TEMPERATURE: float = 0.6

    # ── STT ────────────────────────────────────────────
    STT_MODEL_ID: str = "openai/whisper-large-v3-turbo"
    STT_DEVICE: str = "cuda"
    STT_DTYPE: str = "float16"
    STT_LANGUAGE: str = "ko"
    STT_INITIAL_PROMPT: str = "의료 증상 상담."
    STT_VAD_ENABLED: bool = True

    # ── TTS (OpenAI) ───────────────────────────────────
    OPENAI_API_KEY: str = ""
    TTS_MODEL: str = "gpt-4o-mini-tts"
    TTS_VOICE: str = "coral"
    TTS_SPEED: float = 0.9
    TTS_RESPONSE_FORMAT: str = "wav"
    TTS_INSTRUCTIONS: str = (
        "You are MEDI, a warm Korean female doctor speaking gently to elderly "
        "villagers in Korean. Speak slowly and clearly with a caring, empathetic "
        "tone. Pronounce Korean naturally; avoid stiff or robotic delivery."
    )

    # ── PubMed RAG ─────────────────────────────────────
    PUBMED_INDEX_PATH: str = "./data_cache/pubmed_ivfpq.faiss"
    PUBMED_METADATA_PATH: str = "./data_cache/pubmed_metadata.parquet"
    PUBMED_ENCODER_MODEL: str = "ncbi/MedCPT-Article-Encoder"
    PUBMED_QUERY_ENCODER_MODEL: str = "ncbi/MedCPT-Query-Encoder"
    PUBMED_TOP_K: int = 3
    PUBMED_IVFPQ_NLIST: int = 4096
    PUBMED_IVFPQ_M: int = 64
    PUBMED_IVFPQ_BITS: int = 8
    PUBMED_IVFPQ_NPROBE: int = 16
    PUBMED_BUILD_LIMIT: int = 0

    # ── DDXPlus RAG ────────────────────────────────────
    DDXPLUS_TREE_PATH: str = "./app/data/ddxplus_tree.json"
    DDXPLUS_KR_PATH: str = "./app/data/ddxplus_kr.json"
    DDXPLUS_TOP_K: int = 3

    # ── Avatar ─────────────────────────────────────────
    AVATAR_MODE: str = "css"   # css | wav2lip
    WAV2LIP_CHECKPOINT_PATH: str = "./data_cache/wav2lip_gan.pth"
    WAV2LIP_FACE_IMAGE_PATH: str = "./data_cache/medi_face.jpg"
    WAV2LIP_FPS: int = 25
    WAV2LIP_RESOLUTION: int = 512

    # ── Session ────────────────────────────────────────
    MAX_TURNS: int = 5
    SESSION_TIMEOUT_SECONDS: int = 600
    EMERGENCY_KEYWORDS: str = "흉통,가슴통증,왼팔,왼쪽팔,턱통증,호흡곤란,의식없,쓰러,안보여,말이 안나와,반신불수"

    FFMPEG_BINARY: str = ""

    # ── helpers ────────────────────────────────────────
    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def emergency_keyword_list(self) -> List[str]:
        return [k.strip() for k in self.EMERGENCY_KEYWORDS.split(",") if k.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
