"""Build the PubMed FAISS IVFPQ index.

Pipeline (Week 1 of the exhibition timeline — ~4–6h on H100):
  1. Download MedRAG/pubmed (23.9M snippets) via 🤗 datasets
  2. Embed each snippet (title + content) with MedCPT-Article-Encoder (768-d)
  3. Train FAISS IndexIVFPQ(nlist=4096, m=64, bits=8) on a 1M sample
  4. Add all vectors; write index + parquet metadata to disk

This script saves to:
  PUBMED_INDEX_PATH      (.faiss)
  PUBMED_METADATA_PATH   (.parquet — columns: id, title, content)
"""
from __future__ import annotations
import argparse
import logging
import os
import sys

import numpy as np
import pandas as pd
import torch
from datasets import load_dataset
from tqdm.auto import tqdm
from transformers import AutoModel, AutoTokenizer

# Allow `python scripts/build_pubmed_index.py` from server/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.config import get_settings  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s :: %(message)s")
log = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=256, help="encoder batch size")
    parser.add_argument("--train-sample", type=int, default=1_000_000, help="vectors used for IVFPQ training")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--limit", type=int, default=None, help="override PUBMED_BUILD_LIMIT")
    parser.add_argument("--streaming", action="store_true", help="stream the dataset (saves RAM)")
    args = parser.parse_args()

    settings = get_settings()
    import faiss

    limit = args.limit if args.limit is not None else settings.PUBMED_BUILD_LIMIT
    device = args.device if torch.cuda.is_available() or args.device != "cuda" else "cpu"

    log.info(f"Loading MedRAG/pubmed (streaming={args.streaming}, limit={limit or 'ALL'})...")
    ds = load_dataset("MedRAG/pubmed", split="train", streaming=args.streaming)

    log.info(f"Loading MedCPT encoder on {device}...")
    tok = AutoTokenizer.from_pretrained(settings.PUBMED_ENCODER_MODEL)
    enc = AutoModel.from_pretrained(settings.PUBMED_ENCODER_MODEL).to(device).eval()

    @torch.inference_mode()
    def embed(texts: list[str]) -> np.ndarray:
        batch = tok(texts, padding=True, truncation=True, return_tensors="pt", max_length=512).to(device)
        out = enc(**batch).last_hidden_state[:, 0, :]
        out = torch.nn.functional.normalize(out, dim=-1)
        return out.cpu().numpy().astype("float32")

    # ── First pass: embeddings + metadata ──
    embeddings: list[np.ndarray] = []
    metadata: list[dict] = []
    buf_texts: list[str] = []
    buf_ids: list[str] = []
    buf_titles: list[str] = []

    def flush() -> None:
        if not buf_texts:
            return
        vecs = embed(buf_texts)
        embeddings.append(vecs)
        for i, txt in enumerate(buf_texts):
            metadata.append({"id": buf_ids[i], "title": buf_titles[i], "content": txt[:1200]})
        buf_texts.clear(); buf_ids.clear(); buf_titles.clear()

    log.info("Embedding snippets...")
    for i, row in enumerate(tqdm(ds, total=limit or 23_898_701)):
        if limit and i >= limit:
            break
        title = row.get("title", "") or ""
        content = row.get("content") or row.get("contents") or ""
        body = (title + ". " + content).strip()
        if not body:
            continue
        buf_texts.append(body[:2000])
        buf_ids.append(str(row.get("id", i)))
        buf_titles.append(title[:300])
        if len(buf_texts) >= args.batch_size:
            flush()
    flush()

    if not embeddings:
        log.error("No embeddings produced — aborting.")
        sys.exit(1)

    matrix = np.vstack(embeddings)
    log.info(f"Embedded {matrix.shape[0]} snippets ({matrix.shape[1]}d, {matrix.nbytes/1e9:.2f} GB f32)")

    # ── FAISS IVFPQ ──
    d = matrix.shape[1]
    nlist = settings.PUBMED_IVFPQ_NLIST
    m = settings.PUBMED_IVFPQ_M
    bits = settings.PUBMED_IVFPQ_BITS
    quantizer = faiss.IndexFlatIP(d)
    index = faiss.IndexIVFPQ(quantizer, d, nlist, m, bits, faiss.METRIC_INNER_PRODUCT)

    train_sample = min(args.train_sample, matrix.shape[0])
    rng = np.random.default_rng(42)
    train_idx = rng.choice(matrix.shape[0], size=train_sample, replace=False)
    log.info(f"Training IVFPQ on {train_sample} sample vectors...")
    index.train(matrix[train_idx])
    log.info("Adding all vectors to index...")
    index.add(matrix)
    log.info(f"Index built: ntotal={index.ntotal}")

    os.makedirs(os.path.dirname(settings.PUBMED_INDEX_PATH), exist_ok=True)
    faiss.write_index(index, settings.PUBMED_INDEX_PATH)
    log.info(f"Wrote FAISS index → {settings.PUBMED_INDEX_PATH}")

    df = pd.DataFrame(metadata)
    df.to_parquet(settings.PUBMED_METADATA_PATH, index=False)
    log.info(f"Wrote metadata ({len(df)} rows) → {settings.PUBMED_METADATA_PATH}")
    log.info("Done.")


if __name__ == "__main__":
    main()
