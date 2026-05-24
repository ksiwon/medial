"""DDXPlus symptom-tree retriever.

DDXPlus contains 1.3M synthetic patients across 49 pathologies,
characterised by symptoms and antecedents. Rather than dense retrieval,
we use a **rule-based symptom tree**:

  preprocessed tree (built by scripts/build_ddxplus_tree.py):
    {
      "diseases": {
        "Pneumonia": {
          "symptoms": {"cough": 0.92, "fever": 0.88, ...},
          "antecedents": {"smoker": 0.4, ...},
        },
        ...
      },
      "symptom_index": {"cough": ["Pneumonia", "Bronchitis", ...], ...}
    }

At runtime we:
  1. Map current collected symptoms → top-k matching diseases (Jaccard / score)
  2. For each matched disease, identify the highest-prior missing symptom
  3. Return that symptom as "next-question hint"
"""
from __future__ import annotations
import json
import logging
import os
from typing import Optional

from app.config import get_settings

log = logging.getLogger(__name__)


class DDXPlusRAG:
    def __init__(self) -> None:
        s = get_settings()
        self.top_k = s.DDXPLUS_TOP_K
        self.tree: dict = {}
        self.kr: dict = {}
        self._load(s.DDXPLUS_TREE_PATH, s.DDXPLUS_KR_PATH)

    def _load(self, tree_path: str, kr_path: str) -> None:
        if os.path.exists(tree_path):
            try:
                with open(tree_path, "r", encoding="utf-8") as f:
                    self.tree = json.load(f)
                log.info(f"DDXPlus tree loaded: {len(self.tree.get('diseases', {}))} diseases")
            except Exception as e:
                log.exception(f"DDXPlus tree load failed: {e}")
        else:
            log.warning(f"DDXPlus tree not found at {tree_path} (run scripts/build_ddxplus_tree.py)")

        if os.path.exists(kr_path):
            try:
                with open(kr_path, "r", encoding="utf-8") as f:
                    self.kr = json.load(f)
            except Exception:
                self.kr = {}

    def is_ready(self) -> bool:
        return bool(self.tree.get("diseases"))

    def to_kr(self, name: str) -> str:
        return self.kr.get(name, name)

    def rank_diseases(self, collected_symptoms: list[str]) -> list[tuple[str, float]]:
        """Score each disease by overlap of collected symptoms."""
        if not collected_symptoms or not self.is_ready():
            return []
        ranked: list[tuple[str, float]] = []
        sym_set = set(s.lower().strip() for s in collected_symptoms)
        for disease, profile in self.tree["diseases"].items():
            sym_map = profile.get("symptoms", {})
            if not sym_map:
                continue
            overlap = sum(sym_map[s] for s in sym_map if s.lower() in sym_set)
            if overlap > 0:
                # Normalise by total weight to avoid favouring "wide" diseases
                total = sum(sym_map.values()) or 1.0
                ranked.append((disease, overlap / total))
        ranked.sort(key=lambda x: -x[1])
        return ranked[: self.top_k]

    def next_symptoms(self, collected_symptoms: list[str], limit: int = 5) -> list[dict]:
        """Return missing symptoms with priority across top-k diseases."""
        ranked = self.rank_diseases(collected_symptoms)
        if not ranked:
            return []
        sym_set = set(s.lower().strip() for s in collected_symptoms)
        suggestions: dict[str, float] = {}
        for disease, score in ranked:
            sym_map = self.tree["diseases"][disease].get("symptoms", {})
            for sym, prior in sym_map.items():
                if sym.lower() in sym_set:
                    continue
                suggestions[sym] = max(suggestions.get(sym, 0.0), prior * score)
        sorted_syms = sorted(suggestions.items(), key=lambda x: -x[1])
        return [{"symptom": s, "score": round(p, 3)} for s, p in sorted_syms[:limit]]

    def differential_diagnosis(self, collected_symptoms: list[str]) -> list[dict]:
        ranked = self.rank_diseases(collected_symptoms)
        if not ranked:
            return []
        total = sum(s for _, s in ranked) or 1.0
        return [
            {
                "name": self.to_kr(disease),
                "name_en": disease,
                "probability": int(round(score / total * 100)),
            }
            for disease, score in ranked
        ]

    def format_next_symptoms(self, next_syms: list[dict]) -> str:
        if not next_syms:
            return "(증상 트리가 비어있어 추가 단서가 없습니다.)"
        return "\n".join(
            f"- {self.to_kr(s['symptom'])} (priority {s['score']})"
            for s in next_syms
        )


_ddx: Optional[DDXPlusRAG] = None

def get_ddxplus() -> DDXPlusRAG:
    global _ddx
    if _ddx is None:
        _ddx = DDXPlusRAG()
    return _ddx
