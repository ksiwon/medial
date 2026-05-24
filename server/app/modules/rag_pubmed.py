"""PubMed RAG retriever using FAISS IVFPQ + MedCPT query encoder.

Index + metadata are produced by `scripts/build_pubmed_index.py`.
Load them once at startup, query at request time (~5 ms on H100).
"""
from __future__ import annotations
import logging
import os
from typing import List, Optional

import numpy as np
import torch
from transformers import AutoModel, AutoTokenizer

from app.config import get_settings

log = logging.getLogger(__name__)


class PubMedRAG:
    def __init__(self) -> None:
        s = get_settings()
        self.top_k = s.PUBMED_TOP_K
        self.index = None
        self.metadata = None
        self.tokenizer = None
        self.encoder = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self._load()

    def _load(self) -> None:
        s = get_settings()
        idx_path = s.PUBMED_INDEX_PATH
        meta_path = s.PUBMED_METADATA_PATH
        if not os.path.exists(idx_path) or not os.path.exists(meta_path):
            log.warning(
                "PubMed FAISS index not found (run scripts/build_pubmed_index.py). "
                "Returning empty context for now."
            )
            return
        try:
            import faiss
            self.index = faiss.read_index(idx_path)
            self.index.nprobe = s.PUBMED_IVFPQ_NPROBE
            log.info(f"PubMed FAISS index loaded: ntotal={self.index.ntotal}, nprobe={self.index.nprobe}")
        except Exception as e:
            log.exception(f"FAISS load failed: {e}")
            return

        try:
            import pandas as pd
            self.metadata = pd.read_parquet(meta_path)
            log.info(f"PubMed metadata loaded: {len(self.metadata)} rows")
        except Exception as e:
            log.exception(f"Metadata load failed: {e}")
            self.index = None
            return

        try:
            self.tokenizer = AutoTokenizer.from_pretrained(s.PUBMED_QUERY_ENCODER_MODEL)
            self.encoder = AutoModel.from_pretrained(s.PUBMED_QUERY_ENCODER_MODEL).to(self.device).eval()
            log.info(f"PubMed query encoder loaded: {s.PUBMED_QUERY_ENCODER_MODEL}")
        except Exception as e:
            log.exception(f"Query encoder load failed: {e}")
            self.index = None

    def is_ready(self) -> bool:
        return self.index is not None and self.encoder is not None

    @torch.inference_mode()
    def _encode(self, queries: List[str]) -> np.ndarray:
        assert self.tokenizer and self.encoder
        enc = self.tokenizer(queries, padding=True, truncation=True, return_tensors="pt", max_length=64).to(self.device)
        out = self.encoder(**enc).last_hidden_state[:, 0, :]
        # MedCPT uses inner-product → L2 normalize
        out = torch.nn.functional.normalize(out, dim=-1)
        return out.cpu().numpy().astype("float32")

    def search(self, query: str, k: Optional[int] = None) -> List[dict]:
        if not self.is_ready():
            return []
        k = k or self.top_k
        try:
            q_emb = self._encode([query])
            scores, idxs = self.index.search(q_emb, k)
            results: List[dict] = []
            for score, idx in zip(scores[0].tolist(), idxs[0].tolist()):
                if idx < 0 or idx >= len(self.metadata):
                    continue
                row = self.metadata.iloc[idx]
                results.append({
                    "id": str(row.get("id", idx)),
                    "title": str(row.get("title", "")),
                    "content": str(row.get("content", row.get("contents", "")))[:1200],
                    "score": float(score),
                })
            return results
        except Exception as e:
            log.exception(f"PubMed search failed: {e}")
            return []

    def format_context(self, hits: List[dict]) -> str:
        if not hits:
            return "(PubMed 인덱스가 준비되지 않았습니다.)"
        lines = []
        for i, h in enumerate(hits, 1):
            title = h.get("title") or "(no title)"
            snippet = h.get("content") or ""
            lines.append(f"[{i}] {title}\n{snippet}")
        return "\n\n".join(lines)


_rag: Optional[PubMedRAG] = None

def get_pubmed_rag() -> PubMedRAG:
    global _rag
    if _rag is None:
        _rag = PubMedRAG()
    return _rag
