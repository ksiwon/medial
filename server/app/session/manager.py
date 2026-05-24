"""Per-WebSocket session state + persistent visit history (DR3 continuity)."""
from __future__ import annotations
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

from app.modules.orchestrator import empty_health_context


# ── Process-wide visit log (DR3: persistent record across sessions) ──
# The exhibition runs in a single process; sessions are pinned to the
# patient terminal. For a single-tablet demo this is enough. For a
# multi-tenant deployment, swap in Redis or a database.
_VISIT_LOG: list[dict] = []
_VISIT_LOG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "data_cache", "visit_log.json"
)


def _load_visit_log() -> None:
    global _VISIT_LOG
    try:
        if os.path.exists(_VISIT_LOG_PATH):
            with open(_VISIT_LOG_PATH, "r", encoding="utf-8") as f:
                _VISIT_LOG = json.load(f)
    except Exception:
        _VISIT_LOG = []


def _save_visit_log() -> None:
    try:
        os.makedirs(os.path.dirname(_VISIT_LOG_PATH), exist_ok=True)
        with open(_VISIT_LOG_PATH, "w", encoding="utf-8") as f:
            json.dump(_VISIT_LOG[-50:], f, ensure_ascii=False)
    except Exception:
        pass


def archive_visit(record: dict) -> None:
    _VISIT_LOG.append(record)
    _save_visit_log()


def recent_visits(limit: int = 3) -> list[dict]:
    if not _VISIT_LOG:
        _load_visit_log()
    return list(reversed(_VISIT_LOG[-limit:]))


# Initialise log at import time
_load_visit_log()


@dataclass
class Turn:
    role: str  # "ai" | "user"
    text: str
    timestamp: float = field(default_factory=time.time)


@dataclass
class Session:
    session_id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    session_code: str = field(default_factory=lambda: f"PT-{uuid.uuid4().hex[:5].upper()}")
    started_at: float = field(default_factory=time.time)
    case_id: str = "free_input"
    # 'triage'(상담/기존 라이브) | 'companion'(일상 말동무, MEDial 3.0)
    mode: str = "triage"
    turn_count: int = 0           # 전체 AI 턴
    triage_turns: int = 0         # triage 모드 진입 후의 턴 (MAX_TURNS 게이팅·진행바)
    transcript: list[Turn] = field(default_factory=list)
    collected_symptoms: list[str] = field(default_factory=list)
    health_context: dict = field(default_factory=empty_health_context)
    triage_suggested: bool = False
    # 사용자가 마지막으로 상담 제안을 거절한 시각. 이 시각 이후 일정 시간 동안은
    # 새 suggest를 띄우지 않아 "거절했는데 또 권한다" 어색함을 막는다(force는 별개).
    last_declined_at: float = 0.0
    tts_speed: Optional[float] = None   # 어르신 음성 속도(느리게); None=설정 기본값
    audio_buffer: list[bytes] = field(default_factory=list)
    report: Optional[dict] = None
    finished: bool = False

    # ── transcript helpers ──────────────────────────────
    def add_user(self, text: str) -> None:
        self.transcript.append(Turn(role="user", text=text))

    def add_ai(self, text: str) -> None:
        self.transcript.append(Turn(role="ai", text=text))
        self.turn_count += 1

    def reset(self) -> None:
        self.turn_count = 0
        self.triage_turns = 0
        self.mode = "triage"
        self.transcript.clear()
        self.collected_symptoms.clear()
        self.health_context = empty_health_context()
        self.triage_suggested = False
        self.last_declined_at = 0.0
        self.audio_buffer.clear()
        self.report = None
        self.finished = False

    def conversation_for_prompt(self) -> str:
        return "\n".join(
            f"[{t.role.upper()}] {t.text}" for t in self.transcript[-20:]
        ) or "(아직 대화 없음)"

    def buffer_chunk(self, chunk: bytes) -> None:
        self.audio_buffer.append(chunk)

    def take_audio(self) -> list[bytes]:
        buf = self.audio_buffer
        self.audio_buffer = []
        return buf
