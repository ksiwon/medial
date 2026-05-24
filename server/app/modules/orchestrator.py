"""MEDial 2.0 오케스트레이터 — 4종 신호(바이탈·식사·대화단서·커뮤니티)를
누적하고 companion → triage 전환(escalation)을 판정한다.

임계치는 프론트 src/types/health.ts 의 ESCALATION 을 미러링한다(단일 소스는 TS).
바이탈: NEWS2(저혈압·서맥/빈맥) + 2017 ACC/AHA(고혈압 위기) 결합.
누적 suggest=2 는 GDS-SF ≥2/5 (CareCall, 한국 농촌 고령자) 정착.
※ 가정 단발 측정 트리아지로 검증된 임계치가 아닌 연구 데모 휴리스틱.
"""
from __future__ import annotations
import time
from typing import Any

# ── ESCALATION (health.ts 미러) ──────────────────────────
VITAL = {
    "systolic": {"forceHigh": 180, "warnHigh": 140, "warnLow": 110, "forceLow": 90},
    "diastolic": {"forceHigh": 120, "warnHigh": 90},
    "heartRate": {"forceHigh": 130, "warnHigh": 110, "warnLow": 50, "forceLow": 40},
}
SCORES = {"clueSeverity1": 1, "vitalWarn": 1, "mealFlag": 1}
PER_CATEGORY_CAP = 2
SUGGEST_THRESHOLD = 2
WINDOW_MS = 1000 * 60 * 60 * 24


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

    # force: clue severity 2 (윈도우 내)
    for c in hc["clues"]:
        if c["severity"] >= 2 and now - c["timestamp"] <= WINDOW_MS:
            return {"level": "force", "score": 99,
                    "reasons": [f"응급 단서: {c.get('text') or c['category']}"]}

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
