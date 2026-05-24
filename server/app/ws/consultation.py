"""/ws/consultation — the main exhibition WebSocket endpoint.

Protocol (matches frontend `useWebSocket.ts` + 기획서 §03c):

  Client → Server
    binary frame                       opus/webm audio chunk
    {"type":"start","case_id":"..."}   session begin
    {"type":"end_turn"}                user is done speaking → run pipeline
    {"type":"reset"}                   clear session

  Server → Client
    {"type":"session_started", ...}
    {"type":"stt_result", "text": ...}
    {"type":"llm_response", "text": ..., "model": ...}
    {"type":"tts_audio", "audio": <base64 wav>}
    {"type":"avatar_video", "video": <base64 mp4>}     (only if AVATAR_MODE=wav2lip)
    {"type":"report_ready", "report": {...}}
    {"type":"emergency", "level":"119"}
    {"type":"error", "message": ...}
"""
from __future__ import annotations
import asyncio
import base64
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config import get_settings
from app.modules.stt import get_stt
from app.modules.tts import get_tts
from app.modules.llm import get_llm
from app.modules.rag_pubmed import get_pubmed_rag
from app.modules.rag_ddxplus import get_ddxplus
from app.modules.avatar import get_avatar
from app.prompts.system_prompt import (
    SYSTEM_PROMPT_TEMPLATE, SESSION_START_GREETING, WELCOME_BACK_GREETING,
    REPORT_PROMPT_TEMPLATE
)
from app.prompts.companion_prompt import (
    COMPANION_PROMPT_TEMPLATE, COMPANION_GREETING, COMPANION_WELCOME_BACK
)
from app.session.manager import Session, archive_visit, recent_visits
from app.session.dashboard_broadcaster import get_broadcaster
from app.modules import orchestrator

router = APIRouter()
log = logging.getLogger(__name__)


def _detect_emergency(text: str, keywords: list[str]) -> bool:
    if not text:
        return False
    lower = text.lower()
    return any(k.lower() in lower for k in keywords)


def _simple_symptom_extract(text: str) -> list[str]:
    """Light heuristic — strip filler, split by punctuation/conjunctions.
    The LLM-based report step does the heavy lifting at session end."""
    if not text:
        return []
    # crude: any noun phrase shorter than 12 chars
    import re
    chunks = re.split(r"[,.\s·]+|이고|이며|그리고|와|과", text)
    return [c.strip() for c in chunks if 1 < len(c.strip()) < 12][:6]


async def _send(ws: WebSocket, payload: dict) -> None:
    try:
        await ws.send_text(json.dumps(payload, ensure_ascii=False))
    except Exception:
        pass


async def _speak(ws: WebSocket, text: str, speed: float | None = None) -> None:
    tts = get_tts()
    audio_b64 = await tts.synthesize_b64(text, speed)
    if audio_b64:
        await _send(ws, {"type": "tts_audio", "audio": audio_b64})
        # Optional Wav2Lip
        avatar = get_avatar()
        if avatar.mode == "wav2lip":
            audio_bytes = base64.b64decode(audio_b64)
            video_b64 = await avatar.render(audio_bytes)
            if video_b64:
                await _send(ws, {"type": "avatar_video", "video": video_b64})


async def _run_llm_turn(session: Session, last_user_text: str, current_turn: int) -> tuple[str, str]:
    settings = get_settings()
    pubmed = get_pubmed_rag()
    ddx = get_ddxplus()

    # Update collected symptoms (light heuristic; refined at report time)
    session.collected_symptoms.extend(_simple_symptom_extract(last_user_text))
    session.collected_symptoms = list(dict.fromkeys(session.collected_symptoms))

    pubmed_hits = pubmed.search(last_user_text) if last_user_text else []
    pubmed_ctx = pubmed.format_context(pubmed_hits)

    next_syms = ddx.next_symptoms(session.collected_symptoms)
    next_ctx = ddx.format_next_symptoms(next_syms)

    prompt = SYSTEM_PROMPT_TEMPLATE.format(
        pubmed_context=pubmed_ctx,
        ddxplus_next_symptoms=next_ctx,
        conversation_history=session.conversation_for_prompt(),
        max_turns=settings.MAX_TURNS,
        current_turn=current_turn,
    )

    llm = get_llm()
    text, model_used = await llm.generate(prompt)
    if not text:
        text = "죄송해요, 잠시 응답이 늦어졌어요. 다시 한 번 말씀해 주시겠어요?"
    return text, model_used


async def _run_companion_turn(session: Session, last_user_text: str) -> tuple[str, list[dict], list[str], str]:
    """일상 말동무 턴. 단일 구조화 호출로 (reply, clues, inject_event_ids)를 받는다."""
    hc = session.health_context
    prompt = COMPANION_PROMPT_TEMPLATE.format(
        context_summary=orchestrator.summarize_context(hc),
        pending_events=orchestrator.format_events_for_prompt(orchestrator.pending_events(hc)),
        conversation_history=session.conversation_for_prompt(),
        last_user_text=last_user_text or "(말 없음)",
    )
    llm = get_llm()
    raw, model_used = await llm.generate(prompt, json_mode=True)
    parsed = llm.extract_json(raw) or {}
    reply = (parsed.get("reply") or "").strip()
    if not reply:
        reply = "그러셨군요. 오늘도 들려주셔서 고마워요. 더 하고 싶은 이야기 있으세요?"
    clues = parsed.get("clues") or []
    inject_ids = parsed.get("inject_event_ids") or []
    return reply, clues, inject_ids, model_used


_VALID_CATEGORIES = {"symptom", "mood", "sleep", "appetite", "medication", "mobility", "social"}


def _ingest_clues(session: Session, clues: list[dict]) -> None:
    for c in clues:
        cat = c.get("category")
        if cat not in _VALID_CATEGORIES:
            continue
        try:
            sev = int(c.get("severity", 0))
        except (TypeError, ValueError):
            sev = 0
        sev = max(0, min(2, sev))
        orchestrator.add_clue(session.health_context, cat, sev, c.get("text", ""))
        if cat == "symptom" and c.get("text"):
            session.collected_symptoms.append(c["text"])
    session.collected_symptoms = list(dict.fromkeys(session.collected_symptoms))


# 거절 직후 재제안 쿨다운 (force escalation은 제외 — 응급/위기는 무조건 통과).
TRIAGE_DECLINE_COOLDOWN_SEC = 5 * 60  # 5분


async def _maybe_escalate(websocket: WebSocket, session: Session) -> None:
    """companion 모드에서만 평가. force → 즉시 triage 전환, suggest → 동의 요청."""
    if session.mode != "companion":
        return
    decision = orchestrator.evaluate(session.health_context)
    level = decision["level"]
    if level == "force":
        # 갑작스러운 전환을 부드럽게 — 대화에 설명 멘트를 먼저 띄운다.
        transition = "어르신, 방금 건강 신호가 조금 걱정돼서요. 잠깐 몇 가지만 여쭤볼게요."
        session.add_ai(transition)
        await _send(websocket, {
            "type": "llm_response", "text": transition,
            "turn": 0, "max_turns": get_settings().MAX_TURNS, "model": "system",
        })
        await _speak(websocket, transition, session.tts_speed)
        session.mode = "triage"
        session.triage_turns = 0
        session.triage_suggested = False
        await _send(websocket, {
            "type": "mode_switch", "mode": "triage",
            "reason": "; ".join(decision["reasons"])[:120],
        })
    elif level == "suggest" and not session.triage_suggested:
        # 최근에 거절했다면 잠시 다시 묻지 않는다(거절-재제안 루프 방지).
        import time as _t
        if session.last_declined_at and _t.time() - session.last_declined_at < TRIAGE_DECLINE_COOLDOWN_SEC:
            return
        session.triage_suggested = True
        await _send(websocket, {
            "type": "triage_suggested",
            "reason": "; ".join(decision["reasons"])[:120],
        })


async def _build_report(session: Session) -> dict:
    settings = get_settings()
    ddx = get_ddxplus()
    differential = ddx.differential_diagnosis(session.collected_symptoms)

    prompt = REPORT_PROMPT_TEMPLATE.format(
        conversation_history=session.conversation_for_prompt(),
        ddxplus_top_diseases=json.dumps(differential, ensure_ascii=False),
    )
    llm = get_llm()
    raw, _ = await llm.generate(prompt, json_mode=True)
    parsed = llm.extract_json(raw) or {}

    # Fill blanks from heuristics
    report = {
        "chief_complaint": parsed.get("chief_complaint", "(미확인)"),
        "symptoms": parsed.get("symptoms", session.collected_symptoms[:8]),
        "ddx": parsed.get("ddx") or differential[:3],
        "medications": parsed.get("medications", []),
        "triage": parsed.get("triage", "routine"),
        "questions": parsed.get("questions") or _pair_qa(session),
        "timestamp": int(session.started_at * 1000),
        "sessionCode": session.session_code,
    }
    return report


def _pair_qa(session: Session) -> list[dict]:
    """Fallback Q/A pairing from transcript."""
    pairs: list[dict] = []
    turns = session.transcript
    for i, t in enumerate(turns):
        if t.role == "ai" and i + 1 < len(turns) and turns[i + 1].role == "user":
            pairs.append({"question": t.text, "answer": turns[i + 1].text})
    return pairs


# ─────────────────────────────────────────────────────────────
@router.websocket("/ws/consultation")
async def consultation_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    settings = get_settings()
    broadcaster = get_broadcaster()
    session = Session()
    log.info(f"Session {session.session_id} ({session.session_code}) started.")

    await _send(websocket, {
        "type": "session_started",
        "session_id": session.session_id,
        "session_code": session.session_code,
    })

    try:
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break

            # Binary frame → buffer audio
            if "bytes" in msg and msg["bytes"] is not None:
                session.buffer_chunk(msg["bytes"])
                continue

            # Text frame → control JSON
            text = msg.get("text")
            if not text:
                continue
            try:
                cmd = json.loads(text)
            except json.JSONDecodeError:
                continue
            ctype = cmd.get("type")

            if ctype == "start":
                session.case_id = cmd.get("case_id", "free_input")
                session.mode = cmd.get("mode") or "triage"
                # DR3: if prior visit exists, greet with continuity reference.
                previous = recent_visits(limit=1)
                last_chief = previous[0].get("chief_complaint") if previous else None
                if session.mode == "companion":
                    greeting = (COMPANION_WELCOME_BACK.format(last_chief=last_chief)
                                if last_chief else COMPANION_GREETING)
                elif last_chief:
                    greeting = WELCOME_BACK_GREETING.format(last_chief=last_chief)
                else:
                    greeting = SESSION_START_GREETING
                session.add_ai(greeting)
                await _send(websocket, {
                    "type": "llm_response",
                    "text": greeting,
                    "turn": session.turn_count,
                    "max_turns": settings.MAX_TURNS,
                    "model": "system",
                    "is_returning_visit": bool(previous),
                })
                await _speak(websocket, greeting, session.tts_speed)

            elif ctype == "reset":
                session.reset()
                await _send(websocket, {"type": "session_reset"})

            elif ctype == "end_turn":
                # Decode buffered webm/opus → numpy → Whisper
                audio_chunks = session.take_audio()
                stt = get_stt()
                pcm = stt.decode_webm_chunks(audio_chunks)
                user_text = stt.transcribe(pcm) if pcm is not None else ""
                if not user_text:
                    await _send(websocket, {
                        "type": "error",
                        "message": "음성이 인식되지 않았어요. 다시 말씀해 주세요.",
                    })
                    continue

                session.add_user(user_text)
                await _send(websocket, {"type": "stt_result", "text": user_text})

                # Emergency check before LLM
                if _detect_emergency(user_text, settings.emergency_keyword_list):
                    await _send(websocket, {"type": "emergency", "level": "119"})
                    session.finished = True
                    continue

                # ── Companion(일상 말동무) 턴 ──
                if session.mode == "companion":
                    reply, clues, inject_ids, model = await _run_companion_turn(session, user_text)
                    session.add_ai(reply)
                    _ingest_clues(session, clues)
                    orchestrator.mark_injected(session.health_context, inject_ids)
                    await _send(websocket, {
                        "type": "llm_response", "text": reply,
                        "turn": 0, "max_turns": settings.MAX_TURNS,
                        "model": model, "mode": "companion",
                    })
                    await _speak(websocket, reply, session.tts_speed)
                    await _maybe_escalate(websocket, session)
                    continue

                # ── Triage(상담) 턴 ──
                reply, model = await _run_llm_turn(session, user_text, session.triage_turns + 1)
                session.add_ai(reply)
                session.triage_turns += 1
                await _send(websocket, {
                    "type": "llm_response",
                    "text": reply,
                    "turn": session.triage_turns,
                    "max_turns": settings.MAX_TURNS,
                    "model": model,
                })
                await _speak(websocket, reply, session.tts_speed)

                # Max-turn → build & push report
                if session.triage_turns >= settings.MAX_TURNS:
                    report = await _build_report(session)
                    session.report = report
                    # DR3: persist this visit so next session can reference it.
                    archive_visit({
                        "session_code": session.session_code,
                        "started_at": session.started_at,
                        "chief_complaint": report.get("chief_complaint", ""),
                        "symptoms": report.get("symptoms", []),
                        "triage": report.get("triage", "routine"),
                    })
                    await _send(websocket, {"type": "report_ready", "report": report})
                    await broadcaster.broadcast({"type": "new_report", "report": report})
                    session.finished = True

            elif ctype == "finish":
                # User-requested early report generation
                report = await _build_report(session)
                session.report = report
                archive_visit({
                    "session_code": session.session_code,
                    "started_at": session.started_at,
                    "chief_complaint": report.get("chief_complaint", ""),
                    "symptoms": report.get("symptoms", []),
                    "triage": report.get("triage", "routine"),
                })
                await _send(websocket, {"type": "report_ready", "report": report})
                await broadcaster.broadcast({"type": "new_report", "report": report})
                session.finished = True

            elif ctype == "signal_vital":
                # IoT 시뮬 바이탈 주입 (P4) → 즉시 escalation 평가
                v = cmd.get("vital")
                if isinstance(v, dict):
                    orchestrator.add_vital(session.health_context, v)
                    await _maybe_escalate(websocket, session)

            elif ctype == "signal_meal":
                # 식사 분석 결과 주입 (P4)
                m = cmd.get("meal")
                if isinstance(m, dict):
                    orchestrator.add_meal(session.health_context, m)
                    await _maybe_escalate(websocket, session)

            elif ctype == "signal_event":
                # 커뮤니티/보건소 공지 주입 (P5) — 다음 companion 턴에 언급 후보
                e = cmd.get("event")
                if isinstance(e, dict):
                    orchestrator.add_event(session.health_context, e)

            elif ctype == "consent_triage":
                # 사용자가 상담 제안을 수락 → triage 전환
                session.mode = "triage"
                session.triage_turns = 0
                session.triage_suggested = False
                await _send(websocket, {"type": "mode_switch", "mode": "triage", "reason": "user_consent"})

            elif ctype == "decline_triage":
                # 사용자가 거절 → companion 유지, 누적 신호 초기화로 재알림 방지.
                # 단발 식사 플래그도 함께 비워 "방금 거절했는데 또 권한다" 어색함을 방지.
                # 바이탈은 그대로 (상태이므로) — 단 5분 쿨다운으로 즉시 재제안은 막는다.
                import time as _t
                session.triage_suggested = False
                session.last_declined_at = _t.time()
                session.health_context["clues"] = []
                session.health_context["meals"] = []

            elif ctype == "set_tts_speed":
                # 어르신 음성 속도 조절 (느리게 선호, P4)
                try:
                    session.tts_speed = max(0.5, min(2.0, float(cmd.get("speed"))))
                except (TypeError, ValueError):
                    pass

            elif ctype == "set_mode":
                # 상담 완료 후 일상 대화로 복귀 등 명시적 모드 전환
                new_mode = cmd.get("mode")
                if new_mode in ("companion", "triage"):
                    session.mode = new_mode
                    session.triage_suggested = False
                    if new_mode == "companion":
                        session.triage_turns = 0
                        # 재진입 직후 즉시 재-escalation 방지
                        session.health_context["clues"] = []
                    await _send(websocket, {"type": "mode_switch", "mode": new_mode, "reason": "set_mode"})

    except WebSocketDisconnect:
        log.info(f"Session {session.session_id} disconnected.")
    except Exception as e:
        log.exception(f"WS error: {e}")
        await _send(websocket, {"type": "error", "message": str(e)})
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
