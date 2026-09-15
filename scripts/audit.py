"""Run the three simulator checks and write .run/audit/ (gitignored).

    python scripts/audit.py             # knobs + stability (rule adapter, no key)
    python scripts/audit.py 40          # stability over 40 days instead of 20

Reads the latest scripts/llm_repeat.py and scripts/llm_iteration.py outputs
for the model-side counts; run those first if you want them fresh. Prints the
tables the research note quotes and the versions they were made under.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
sys.stdout.reconfigure(encoding="utf-8")

from app.simulation.audit import (  # noqa: E402
    MEASURES, dead_knobs, knob_effects, shadow_summary, stability,
    synthesis_misclassification, synthesis_sheet, table_disagreement)
from app.simulation.contracts import ENGINE_VERSION  # noqa: E402
from app.simulation.policies.llm_policy import PROMPT_REVISION  # noqa: E402
from app.simulation.village import load_village  # noqa: E402

DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 20
OUT = ROOT / ".run" / "audit"
OUT.mkdir(parents=True, exist_ok=True)
SYN = ROOT / "fixtures" / "synthetic"
village = load_village(str(SYN / "village.synthetic.json"))
personas = str(SYN / "personas.synthetic.json")
P1 = ["policy-A-v1", "policy-B-v1", "policy-C-v1", "policy-D-v1"]
P9 = ["policy-T-A-v1", "policy-T-B-v1"]
stamp = time.strftime("%Y%m%d-%H%M%S")
versions = {"engine": ENGINE_VERSION, "prompt": PROMPT_REVISION,
            "village": village.content_hash, "stamp": stamp}
print("engine %s · prompt %s · village %s" % (ENGINE_VERSION, PROMPT_REVISION,
                                             village.content_hash))

# ------------------------------------------------------------------ 1. knobs
print("\n== 1. 노브마다: 바꾸면 로그가 달라지는가 (seed 17, env-v3-fixed)")
rows = (knob_effects(village, personas, P1, ["deck-p1-no-response-v1"])
        + knob_effects(village, personas, P9, ["deck-p9-transport-v1"]))
knobs = sorted({r["knob"] for r in rows}, key=list(dict.fromkeys(r["knob"] for r in rows)).index)
policies = list(dict.fromkeys((r["deck"], r["policy"], r["strategy"]) for r in rows))
print("%-30s" % "" + "".join("%-9s" % p[1].replace("policy-", "").replace("-v1", "")
                             for p in policies))
for knob in knobs:
    cells = []
    for deck, policy, _ in policies:
        r = next(x for x in rows if x["knob"] == knob and x["policy"] == policy and x["deck"] == deck)
        cells.append("%-9s" % ("달라짐" if r["logChanged"] else
                               "-" if r["logChanged"] is None else "같음"))
    print("%-30s%s" % (knob, "".join(cells)))
print("dead knobs:", dead_knobs(rows) or "없음")

# -------------------------------------------------------------- 2. stability
seeds = list(range(1, DAYS + 1))
print("\n== 2. %d일에 걸쳐 (env-v3, 시각 ±10분)" % DAYS)
stab = {}
for deck, ids in (("deck-p1-no-response-v1", P1), ("deck-p9-transport-v1", P9)):
    s = stability(village, personas, ids, deck, seeds)
    stab[deck] = s
    print("--", deck)
    for key, (label, _get, _dir) in MEASURES.items():
        rank = s["ranking"][key]
        cells = " | ".join("%s %s~%s (중앙 %s%s)" % (
            p.replace("policy-", "").replace("-v1", ""),
            s["summary"][p][key]["min"], s["summary"][p][key]["max"],
            s["summary"][p][key]["median"],
            ", 미해결 %d일" % s["summary"][p][key]["censored"]
            if s["summary"][p][key]["censored"] else "") for p in ids)
        print("  %-22s %s\n%25s중앙값 순서 %s · %d/%d일 유지" % (
            label, cells, "", (" ≥ " if rank["direction"] == "higher" else " ≤ ").join(
                x.replace("policy-", "").replace("-v1", "") for x in rank["orderByMedian"]),
            rank["heldOnDays"], rank["ofDays"]))
    for p in ids:
        print("  %-14s 결과 %s · 경로 %s" % (p, s["summary"][p]["outcomes"], s["summary"][p]["paths"]))

# ------------------------------------------------ 3. model residents, synthesis
print("\n== 3. 모델 주민 vs 거절 표 · 종합의 분류")
repeat_files = sorted((ROOT / ".run" / "llm-repeat").glob("runs-*.json"))
disagreement = None
if repeat_files:
    runs = [r for f in repeat_files for r in json.loads(f.read_text(encoding="utf-8"))]
    disagreement = table_disagreement(runs)
    print("  모델 머리 아래 (llm_repeat, %d파일 %d실행): 표 판정이 붙은 답 %d건 중 다름 %d건" % (
        len(repeat_files), disagreement["runs"], disagreement["answersWithVerdict"],
        disagreement["disagreements"]))
    for c in disagreement["cases"]:
        print("    %s #%d %s 모델=%s 표=%s(%s) — %s" % (
            c["policy"], c["run"], c["actor"], c["model"], c["table"], c["rule"], c["utterance"]))
else:
    print("  llm_repeat 결과가 없다 (scripts/llm_repeat.py 먼저)")

shadow_files = sorted((ROOT / ".run" / "llm-shadow").glob("shadow-*.json"))
shadow = None
if shadow_files:
    shadow_rows = [r for f in shadow_files for r in json.loads(f.read_text(encoding="utf-8"))]
    shadow = shadow_summary(shadow_rows)
    print("  규칙 마을을 그림자로 (llm_shadow, %d파일): 질문 %d건 중 다름 %d건 (%.0f%%)" % (
        len(shadow_files), shadow["questions"], shadow["disagreements"], 100 * (shadow["rate"] or 0)))
    for key, cell in shadow["byVerdict"].items():
        print("    표=%-32s %d건 물음, %d건 다름 · 모델은 %s" % (
            key, cell["asked"], cell["differ"], cell["modelSaid"]))
else:
    print("  llm_shadow 결과가 없다 (scripts/llm_shadow.py 먼저)")

session_files = sorted((ROOT / ".run" / "llm-iteration").glob("session-*.json"))
sheet, misfiled = [], None
if session_files:
    detail = json.loads(session_files[-1].read_text(encoding="utf-8"))
    sheet_path = OUT / ("synthesis-labels-%s.json" % detail["session"]["id"])
    if sheet_path.exists():
        sheet = json.loads(sheet_path.read_text(encoding="utf-8"))
    else:
        sheet = synthesis_sheet(detail)
        sheet_path.write_text(json.dumps(sheet, ensure_ascii=False, indent=1), encoding="utf-8")
    misfiled = synthesis_misclassification(sheet)
    draft = synthesis_misclassification(sheet, "draftLabel")
    print("  %s: 항목 %d개 · 사람 라벨 %d개 → 오분류 %s · AI 초안 라벨 %d개 → 오분류 %s" % (
        session_files[-1].name, len(sheet), misfiled["labelled"],
        misfiled["misfiled"] if misfiled["labelled"] else "라벨 없음",
        draft["labelled"], draft["misfiled"] if draft["labelled"] else "라벨 없음"))
    print("  라벨 파일:", sheet_path)
else:
    print("  llm_iteration 결과가 없다 (scripts/llm_iteration.py 먼저)")

report = {"versions": versions, "knobs": rows, "deadKnobs": dead_knobs(rows),
          "stability": stab, "tableDisagreement": disagreement, "shadow": shadow,
          "synthesis": {"sheetSize": len(sheet), "human": misfiled,
                        "draft": synthesis_misclassification(sheet, "draftLabel") if sheet else None}}
(OUT / ("audit-%s.json" % stamp)).write_text(
    json.dumps(report, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
print("\nwritten:", OUT / ("audit-%s.json" % stamp))
