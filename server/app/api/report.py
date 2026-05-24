"""POST /api/report — manual report generation from a posted transcript."""
from __future__ import annotations
import json
import logging
from typing import Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.modules.llm import get_llm
from app.modules.rag_ddxplus import get_ddxplus
from app.prompts.system_prompt import REPORT_PROMPT_TEMPLATE

router = APIRouter()
log = logging.getLogger(__name__)


class TurnIn(BaseModel):
    role: str
    text: str


class ReportRequest(BaseModel):
    session_id: str
    conversation: list[TurnIn]


@router.post("/api/report")
async def make_report(req: ReportRequest) -> dict[str, Any]:
    if not req.conversation:
        raise HTTPException(status_code=400, detail="empty conversation")

    history = "\n".join(f"[{t.role.upper()}] {t.text}" for t in req.conversation)
    # crude symptom pull
    symptoms: list[str] = []
    for t in req.conversation:
        if t.role == "user":
            symptoms.extend(t.text.split())
    ddx = get_ddxplus()
    differential = ddx.differential_diagnosis(symptoms[:30])

    prompt = REPORT_PROMPT_TEMPLATE.format(
        conversation_history=history,
        ddxplus_top_diseases=json.dumps(differential, ensure_ascii=False),
    )
    raw, model = await get_llm().generate(prompt, json_mode=True)
    parsed = get_llm().extract_json(raw) or {}

    return {
        "chief_complaint": parsed.get("chief_complaint", "(미확인)"),
        "symptoms": parsed.get("symptoms", []),
        "ddx": parsed.get("ddx") or differential[:3],
        "medications": parsed.get("medications", []),
        "triage": parsed.get("triage", "routine"),
        "questions": parsed.get("questions", []),
        "model": model,
        "session_id": req.session_id,
    }
