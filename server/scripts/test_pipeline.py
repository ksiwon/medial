"""Tiny end-to-end smoke test:
  prompt a fake user message → LLM → JSON report.
Run with:  python scripts/test_pipeline.py
"""
from __future__ import annotations
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.modules.llm import get_llm
from app.modules.rag_ddxplus import get_ddxplus
from app.prompts.system_prompt import SYSTEM_PROMPT_TEMPLATE, REPORT_PROMPT_TEMPLATE


async def main() -> None:
    ddx = get_ddxplus()
    llm = get_llm()

    user_text = "어제부터 가슴이 답답하고 왼쪽 팔이 저려요."
    syms = ["chest pain", "pain radiating to left arm"]
    next_syms = ddx.next_symptoms(syms)
    print("DDXPlus next-symptom hints:", next_syms)

    prompt = SYSTEM_PROMPT_TEMPLATE.format(
        pubmed_context="(PubMed 인덱스 미적재 — 테스트 환경)",
        ddxplus_next_symptoms=ddx.format_next_symptoms(next_syms),
        conversation_history=f"[USER] {user_text}",
        max_turns=5,
        current_turn=1,
    )

    print("\n--- LLM call (turn 1) ---")
    text, model = await llm.generate(prompt)
    print(f"[{model}] {text}")

    print("\n--- Report generation ---")
    differential = ddx.differential_diagnosis(syms)
    report_prompt = REPORT_PROMPT_TEMPLATE.format(
        conversation_history=f"[USER] {user_text}",
        ddxplus_top_diseases=json.dumps(differential, ensure_ascii=False),
    )
    raw, _ = await llm.generate(report_prompt, json_mode=True)
    print(raw)


if __name__ == "__main__":
    asyncio.run(main())
