"""오케스트레이터 escalation 단위 테스트 (의존성 없이 순수 파이썬).

실행: python tests/test_orchestration.py   (server/ 디렉토리에서)
또는: pytest tests/test_orchestration.py

임계치는 src/types/health.ts 의 ESCALATION 을 미러링한다. 프론트 IoT 시뮬
(useVitalsSim.ts)이 생성하는 이상치 값이 서버 force 판정과 일치하는지도 검증한다.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.modules import orchestrator as o  # noqa: E402


def _ctx():
    return o.empty_health_context()


def _vital(sys_, dia, hr, steps=300):
    return {"bloodPressure": {"systolic": sys_, "diastolic": dia}, "heartRate": hr, "steps": steps}


CASES = []


def case(name):
    def deco(fn):
        CASES.append((name, fn))
        return fn
    return deco


# ── escalation 매트릭스 ──────────────────────────────────
@case("빈 컨텍스트 → none")
def _():
    assert o.evaluate(_ctx())["level"] == "none"


@case("clue sev2 → force")
def _():
    h = _ctx(); o.add_clue(h, "symptom", 2, "가슴이 답답하고 왼팔 저림")
    assert o.evaluate(h)["level"] == "force"


@case("clue sev1 1개 → none (임계치 미달)")
def _():
    h = _ctx(); o.add_clue(h, "mood", 1, "외롭다")
    assert o.evaluate(h)["level"] == "none"


@case("clue sev1 2개(다른 카테고리) → suggest")
def _():
    h = _ctx(); o.add_clue(h, "mood", 1, "외롭다"); o.add_clue(h, "sleep", 1, "잠 설침")
    assert o.evaluate(h)["level"] == "suggest"


@case("같은 카테고리 sev1 3개 → cap 2 → suggest (score==2)")
def _():
    h = _ctx()
    for i in range(3):
        o.add_clue(h, "mood", 1, f"우울{i}")
    d = o.evaluate(h)
    assert d["level"] == "suggest" and d["score"] == 2, d


@case("경계 바이탈 + sev1 → suggest")
def _():
    h = _ctx(); o.add_vital(h, _vital(150, 95, 88)); o.add_clue(h, "appetite", 1, "입맛 없음")
    assert o.evaluate(h)["level"] == "suggest"


@case("식사 고나트륨 + sev1 → suggest")
def _():
    h = _ctx(); o.add_meal(h, {"flags": ["고나트륨"], "aiSummary": "국이 짜다"}); o.add_clue(h, "mood", 1, "우울")
    assert o.evaluate(h)["level"] == "suggest"


@case("식사 균형 플래그는 점수 없음 → none")
def _():
    h = _ctx(); o.add_meal(h, {"flags": ["균형"], "aiSummary": "균형 잡힌 식사"})
    assert o.evaluate(h)["level"] == "none"


# ── IoT 시뮬(useVitalsSim.ts) 이상치값 ↔ 서버 force 계약 ──
@case("sim htn_crisis 192/124 → force")
def _():
    h = _ctx(); o.add_vital(h, _vital(192, 124, 72))
    assert o.evaluate(h)["level"] == "force"


@case("sim bradycardia 38 → force")
def _():
    h = _ctx(); o.add_vital(h, _vital(128, 78, 38))
    assert o.evaluate(h)["level"] == "force"


@case("sim tachycardia 136 → force")
def _():
    h = _ctx(); o.add_vital(h, _vital(128, 78, 136))
    assert o.evaluate(h)["level"] == "force"


@case("sim hypotension 86 → force")
def _():
    h = _ctx(); o.add_vital(h, _vital(86, 56, 72))
    assert o.evaluate(h)["level"] == "force"


@case("sim 정상 베이스라인 128/78 hr72 → none")
def _():
    h = _ctx(); o.add_vital(h, _vital(128, 78, 72))
    assert o.evaluate(h)["level"] == "none"


# ── 보조: pending_events / mark_injected ─────────────────
@case("injectToChat 이벤트만 pending, mark 후 제외")
def _():
    h = _ctx()
    o.add_event(h, {"id": "a", "injectToChat": True, "title": "독감", "body": "주의"})
    o.add_event(h, {"id": "b", "injectToChat": False, "title": "오일장", "body": "안내"})
    assert [e["id"] for e in o.pending_events(h)] == ["a"]
    o.mark_injected(h, ["a"])
    assert o.pending_events(h) == []


def main():
    passed = failed = 0
    for name, fn in CASES:
        try:
            fn()
            print(f"  PASS  {name}")
            passed += 1
        except AssertionError as e:
            print(f"  FAIL  {name}  -> {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
