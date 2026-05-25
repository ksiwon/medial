"""MEDial 3.0 오케스트레이터 — 4종 신호(바이탈·식사·대화단서·커뮤니티)를
누적하고 companion → triage 전환(escalation)을 판정한다.

임계치는 프론트와 공유하는 단일 소스 `src/config/escalation.json` 에서 로드한다
(과거엔 health.ts 와 여기에 값을 손으로 복제 → 드리프트=사고 위험으로 단일화).
바이탈: NEWS2(저혈압·서맥/빈맥) + 2017 ACC/AHA(고혈압 위기) 결합.
누적 suggest=2 는 GDS-SF ≥2/5 (CareCall, 한국 농촌 고령자) 정착.
※ 가정 단발 측정 트리아지로 검증된 임계치가 아닌 연구 데모 휴리스틱.
"""
from __future__ import annotations
import json
import os
import time
from pathlib import Path
from typing import Any


# ── ESCALATION (단일 소스: src/config/escalation.json) ────
def _load_escalation() -> dict:
    """프론트·서버가 공유하는 단일 JSON을 읽는다. 없으면 fail-loud
    (안전 임계치를 조용히 복제/대체하지 않는다)."""
    override = os.environ.get("MEDIAL_ESCALATION_PATH")
    path = Path(override) if override else (
        Path(__file__).resolve().parents[3] / "src" / "config" / "escalation.json"
    )
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        raise RuntimeError(
            f"escalation.json을 불러올 수 없습니다({path}). 단일 소스 파일이 없으면 "
            f"임계치를 임의로 추정하지 않습니다. MEDIAL_ESCALATION_PATH로 경로를 "
            f"지정하거나 repo 레이아웃(src/config/escalation.json)을 확인하세요. 원인: {e}"
        ) from e


_ESC = _load_escalation()
VITAL = _ESC["vital"]
SCORES = _ESC["scores"]
PER_CATEGORY_CAP = _ESC["perCategoryCap"]
SUGGEST_THRESHOLD = _ESC["suggestThreshold"]
WINDOW_MS = _ESC["windowMs"]


# ── 독립 red-flag backstop (B3) ──────────────────────────
# LLM이 단서 severity 라벨을 잘못(특히 과소) 매겨도, 오케스트레이터가 단서 텍스트를
# 직접 스캔해 응급 신호를 잡는 defense-in-depth. severity 자기평가 단일 의존을 보완.
# 미탐(응급 놓침)이 과탐보다 위험하므로, 고특이도 패턴 위주로 두되 애매하면 잡는다.
# 고른 패턴: ACS(흉통+팔/턱)·호흡곤란·의식저하/실신·뇌졸중(편측 마비·언어/시야).
RED_FLAG_TERMS = (
    "흉통", "가슴통증", "가슴이 아", "가슴 아", "왼팔", "왼쪽 팔", "턱이 아", "턱 통증",
    "호흡곤란", "숨이 차", "숨쉬기 힘", "숨을 못", "의식", "쓰러", "기절",
    "안 보여", "안보여", "말이 안", "말을 못", "반신", "편마비", "마비",
)
_RF_NEGATION = ("없", "않", "아니", "괜찮", "안 아", "안아")


def contains_red_flag(text: str) -> bool:
    """단서 텍스트에 응급 red-flag 표현이 있는지(부정/취소·띄어쓰기 변이 보정)."""
    if not text:
        return False
    lower = " ".join(text.lower().split())
    compact = lower.replace(" ", "")
    for term in RED_FLAG_TERMS:
        t = term.lower()
        tc = t.replace(" ", "")
        idx = lower.find(t)
        if idx != -1:
            after = lower[idx + len(t): idx + len(t) + 6]
        else:
            idx = compact.find(tc)
            if idx == -1:
                continue
            after = compact[idx + len(tc): idx + len(tc) + 5]
        if any(c in after for c in _RF_NEGATION):
            continue
        return True
    return False


def empty_health_context() -> dict:
    return {"vitals": [], "meals": [], "clues": [], "events": [], "lastUpdated": _now_ms()}


def _now_ms() -> int:
    return int(time.time() * 1000)


# ── 신호 추가 ────────────────────────────────────────────
def add_clue(hc: dict, category: str, severity: int, text: str = "") -> None:
    hc["clues"].append({
        "timestamp": _now_ms(), "category": category,
        "severity": int(severity), "text": text,
    })
    hc["lastUpdated"] = _now_ms()


def add_vital(hc: dict, reading: dict) -> None:
    reading.setdefault("timestamp", _now_ms())
    hc["vitals"].append(reading)
    hc["lastUpdated"] = _now_ms()


def add_meal(hc: dict, meal: dict) -> None:
    meal.setdefault("timestamp", _now_ms())
    hc["meals"].append(meal)
    hc["lastUpdated"] = _now_ms()


def add_event(hc: dict, event: dict) -> None:
    event.setdefault("timestamp", _now_ms())
    event.setdefault("injected", False)
    hc["events"].append(event)
    hc["lastUpdated"] = _now_ms()


def latest_vital(hc: dict) -> dict | None:
    return hc["vitals"][-1] if hc["vitals"] else None


# ── 바이탈 밴드 판정 ─────────────────────────────────────
def _vital_level(v: dict) -> tuple[str, list[str]]:
    """('force'|'warn'|'none', reasons)."""
    reasons: list[str] = []
    level = "none"
    bp = v.get("bloodPressure") or {}
    sys_, dia = bp.get("systolic"), bp.get("diastolic")
    hr = v.get("heartRate")

    def bump(new: str) -> None:
        nonlocal level
        if new == "force" or (new == "warn" and level == "none"):
            level = new

    if sys_ is not None:
        if sys_ >= VITAL["systolic"]["forceHigh"] or sys_ <= VITAL["systolic"]["forceLow"]:
            bump("force"); reasons.append(f"수축기 {sys_}")
        elif sys_ >= VITAL["systolic"]["warnHigh"] or sys_ <= VITAL["systolic"]["warnLow"]:
            bump("warn"); reasons.append(f"수축기 {sys_}")
    if dia is not None:
        if dia >= VITAL["diastolic"]["forceHigh"]:
            bump("force"); reasons.append(f"이완기 {dia}")
        elif dia >= VITAL["diastolic"]["warnHigh"]:
            bump("warn"); reasons.append(f"이완기 {dia}")
    if hr is not None:
        if hr >= VITAL["heartRate"]["forceHigh"] or hr <= VITAL["heartRate"]["forceLow"]:
            bump("force"); reasons.append(f"심박 {hr}")
        elif hr >= VITAL["heartRate"]["warnHigh"] or hr <= VITAL["heartRate"]["warnLow"]:
            bump("warn"); reasons.append(f"심박 {hr}")
    return level, reasons


# ── 종합 판정 ────────────────────────────────────────────
def evaluate(hc: dict) -> dict:
    """{'level': 'none'|'suggest'|'force', 'score': int, 'reasons': [...]}"""
    now = _now_ms()
    reasons: list[str] = []

    # force: clue severity 2 (LLM 판정, 윈도우 내)
    for c in hc["clues"]:
        if c["severity"] >= 2 and now - c["timestamp"] <= WINDOW_MS:
            return {"level": "force", "score": 99,
                    "reasons": [f"응급 단서: {c.get('text') or c['category']}"]}

    # force: 독립 red-flag backstop (B3) — LLM severity와 무관하게 단서 텍스트 직접 스캔.
    # LLM이 응급을 과소 라벨링해도 여기서 잡아 미탐을 줄인다(defense-in-depth).
    for c in hc["clues"]:
        if now - c["timestamp"] <= WINDOW_MS and contains_red_flag(c.get("text", "")):
            return {"level": "force", "score": 99,
                    "reasons": [f"독립 red-flag 감지: {c.get('text') or c['category']}"]}

    # force/warn: 최근 바이탈
    vlevel, vreasons = ("none", [])
    v = latest_vital(hc)
    if v is not None:
        vlevel, vreasons = _vital_level(v)
        if vlevel == "force":
            return {"level": "force", "score": 99, "reasons": ["바이탈 위기: " + ", ".join(vreasons)]}

    # 누적 점수
    score = 0
    # clue severity1 — 카테고리당 상한
    per_cat: dict[str, int] = {}
    for c in hc["clues"]:
        if c["severity"] == 1 and now - c["timestamp"] <= WINDOW_MS:
            cat = c["category"]
            if per_cat.get(cat, 0) < PER_CATEGORY_CAP:
                per_cat[cat] = per_cat.get(cat, 0) + SCORES["clueSeverity1"]
                reasons.append(f"{cat} 신호")
    score += sum(per_cat.values())
    # 경계 바이탈
    if vlevel == "warn":
        score += SCORES["vitalWarn"]; reasons.append("경계 바이탈: " + ", ".join(vreasons))
    # 식사 플래그 (균형 제외) — 최대 cap
    meal_pts = 0
    for m in hc["meals"]:
        if now - m.get("timestamp", now) <= WINDOW_MS:
            flags = [f for f in m.get("flags", []) if f != "균형"]
            if flags and meal_pts < PER_CATEGORY_CAP:
                meal_pts += SCORES["mealFlag"]; reasons.append("식사: " + ", ".join(flags))
    score += meal_pts

    level = "suggest" if score >= SUGGEST_THRESHOLD else "none"
    return {"level": level, "score": score, "reasons": reasons}


# ── 프롬프트용 요약/이벤트 ───────────────────────────────
def summarize_context(hc: dict) -> str:
    lines: list[str] = []
    v = latest_vital(hc)
    if v:
        bp = v.get("bloodPressure") or {}
        parts = []
        if bp.get("systolic"):
            parts.append(f"혈압 {bp.get('systolic')}/{bp.get('diastolic')}")
        if v.get("heartRate"):
            parts.append(f"심박 {v['heartRate']}")
        if v.get("steps") is not None:
            parts.append(f"오늘 걸음 {v['steps']}보")
        if parts:
            lines.append("· " + ", ".join(parts))
    if hc["meals"]:
        m = hc["meals"][-1]
        lines.append(f"· 최근 식사: {m.get('aiSummary', '')}")
    if not lines:
        return "(아직 수집된 신호 없음)"
    return "\n".join(lines)


def pending_events(hc: dict) -> list[dict]:
    return [e for e in hc["events"]
            if e.get("injectToChat") and not e.get("injected")]


def format_events_for_prompt(events: list[dict]) -> str:
    if not events:
        return "(전할 소식 없음)"
    out = []
    for e in events:
        src = "보건소" if e.get("source") == "health_center" else "동네"
        out.append(f"- [{e.get('id')}] ({src}) {e.get('title')}: {e.get('body', '')}")
    return "\n".join(out)


def mark_injected(hc: dict, event_ids: list[str]) -> None:
    ids = set(event_ids or [])
    for e in hc["events"]:
        if e.get("id") in ids:
            e["injected"] = True
