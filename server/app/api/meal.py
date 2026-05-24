"""POST /api/meal/analyze — 식사 사진을 Gemini 비전으로 분석.

반환 스키마는 프론트 src/types/health.ts 의 MealRecord 와 맞춘다.
키/비전 미가용 시 결정적 스텁으로 폴백(데모가 오프라인에서도 동작).
"""
from __future__ import annotations
import base64
import logging
from typing import Any
from fastapi import APIRouter
from pydantic import BaseModel

from app.modules.llm import get_llm

router = APIRouter()
log = logging.getLogger(__name__)

# health.ts MealFlag 와 동일 집합
_VALID_FLAGS = {"고나트륨", "저단백", "고당", "저섬유", "소량섭취", "균형"}
_VALID_MEALTYPES = {"breakfast", "lunch", "dinner", "snack"}

_MEAL_PROMPT = """이 사진은 한국 농촌 고령자의 식사입니다. 노인 건강(고혈압·당뇨·근감소·영양) 관점에서 간단히 평가하세요.
반드시 아래 JSON만 출력하세요:
{
  "aiSummary": "음식 구성과 영양 한줄평 (예: 흰쌀밥·김치·된장국 — 나트륨 다소 높음)",
  "mealType": "breakfast | lunch | dinner | snack",
  "flags": ["고나트륨", "저단백", "고당", "저섬유", "소량섭취", "균형" 중 해당되는 것만]
}"""


class MealRequest(BaseModel):
    image_b64: str
    mime_type: str = "image/jpeg"
    meal_type: str | None = None  # 클라이언트 힌트(시간대)


def _stub(meal_type: str | None) -> dict[str, Any]:
    return {
        "aiSummary": "사진을 분석할 수 없어 기본값으로 기록했어요. 균형 잡힌 한 끼로 보입니다.",
        "mealType": meal_type if meal_type in _VALID_MEALTYPES else "lunch",
        "flags": ["균형"],
    }


@router.post("/api/meal/analyze")
async def analyze_meal(req: MealRequest) -> dict[str, Any]:
    try:
        image_bytes = base64.b64decode(req.image_b64.split(",")[-1])
    except Exception:
        return _stub(req.meal_type)

    raw, _ = await get_llm().generate_vision(
        _MEAL_PROMPT, image_bytes, req.mime_type, json_mode=True
    )
    parsed = get_llm().extract_json(raw) or {}
    if not parsed:
        return _stub(req.meal_type)

    flags = [f for f in (parsed.get("flags") or []) if f in _VALID_FLAGS] or ["균형"]
    meal_type = parsed.get("mealType")
    if meal_type not in _VALID_MEALTYPES:
        meal_type = req.meal_type if req.meal_type in _VALID_MEALTYPES else "lunch"
    return {
        "aiSummary": parsed.get("aiSummary", "식사를 기록했어요."),
        "mealType": meal_type,
        "flags": flags,
    }
