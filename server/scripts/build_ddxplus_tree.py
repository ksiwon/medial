"""Build the DDXPlus symptom-tree JSON used by app/modules/rag_ddxplus.py.

Input (download from figshare manually and place under data_cache/ddxplus/):
  release_evidences.json
  release_conditions.json
  release_train_patients.csv (or release_test_patients.csv — either works)

Output:
  app/data/ddxplus_tree.json  — disease → {symptoms: {name: prior}}

The prior for each (disease, symptom) is the empirical frequency of
that evidence appearing in the train split for that pathology.
"""
from __future__ import annotations
import argparse
import ast
import json
import logging
import os
import sys
from collections import defaultdict

import pandas as pd
from tqdm.auto import tqdm

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.config import get_settings  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s :: %(message)s")
log = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidences", default="./data_cache/ddxplus/release_evidences.json")
    parser.add_argument("--conditions", default="./data_cache/ddxplus/release_conditions.json")
    parser.add_argument("--patients", default="./data_cache/ddxplus/release_train_patients.csv")
    args = parser.parse_args()

    settings = get_settings()

    log.info(f"Loading evidences from {args.evidences}")
    with open(args.evidences, "r", encoding="utf-8") as f:
        evidences = json.load(f)
    log.info(f"  {len(evidences)} evidence codes")

    log.info(f"Loading conditions from {args.conditions}")
    with open(args.conditions, "r", encoding="utf-8") as f:
        conditions = json.load(f)
    log.info(f"  {len(conditions)} conditions")

    log.info(f"Loading patients from {args.patients}")
    df = pd.read_csv(args.patients)
    log.info(f"  {len(df)} patient rows · columns: {list(df.columns)}")

    # column names follow the DDXPlus README
    sex_col = "SEX" if "SEX" in df.columns else "sex"
    age_col = "AGE" if "AGE" in df.columns else "age"
    path_col = "PATHOLOGY"
    evid_col = "EVIDENCES"

    disease_counts: dict[str, int] = defaultdict(int)
    sym_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    log.info("Counting evidence frequencies per disease...")
    for _, row in tqdm(df.iterrows(), total=len(df)):
        disease = str(row.get(path_col, "")).strip()
        if not disease:
            continue
        raw_ev = row.get(evid_col, "[]")
        try:
            ev_list = ast.literal_eval(raw_ev) if isinstance(raw_ev, str) else (raw_ev or [])
        except Exception:
            ev_list = []
        disease_counts[disease] += 1
        for code in ev_list:
            # codes look like "E_55" or "E_55_@_V_88"
            base = code.split("_@_")[0] if isinstance(code, str) else str(code)
            evid = evidences.get(base, {})
            name = evid.get("question_en") or evid.get("name") or base
            name = name.strip()
            if not name:
                continue
            sym_counts[disease][name] += 1

    tree = {"diseases": {}, "symptom_index": defaultdict(list)}
    for disease, total in disease_counts.items():
        sym_map = {
            name: round(cnt / total, 3)
            for name, cnt in sym_counts[disease].items()
        }
        tree["diseases"][disease] = {"symptoms": sym_map}
        for name in sym_map:
            tree["symptom_index"][name].append(disease)
    tree["symptom_index"] = dict(tree["symptom_index"])

    os.makedirs(os.path.dirname(settings.DDXPLUS_TREE_PATH), exist_ok=True)
    with open(settings.DDXPLUS_TREE_PATH, "w", encoding="utf-8") as f:
        json.dump(tree, f, ensure_ascii=False, indent=2)
    log.info(f"Wrote tree → {settings.DDXPLUS_TREE_PATH}")
    log.info(f"  {len(tree['diseases'])} diseases, {len(tree['symptom_index'])} unique symptoms")


if __name__ == "__main__":
    main()
