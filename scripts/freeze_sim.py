"""Freeze what the real version ran into the database the sim version plays.

    python scripts/freeze_sim.py             # real.sqlite3 -> sim.sqlite3
    python scripts/freeze_sim.py --replace   # overwrite an existing sim copy

The sim version shows exactly what this copies and nothing else: every session,
attempt, review and Change Set that real had at this moment, with the model
answers already in them. It is a copy, not a link - running more in real changes
nothing in sim until this is run again.

A session that is still running is refused rather than copied half-way; a sim
server cannot finish it, so it would sit there looking stuck.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

from app.simulation.iteration.contracts import RUNNING_STATES, SessionStatus  # noqa: E402
from app.simulation.mode import REAL, SIM, database_path  # noqa: E402

ACTIVE = {s.value for s in RUNNING_STATES} - {SessionStatus.created.value}


def summary(db: sqlite3.Connection) -> dict[str, int]:
    rows = [json.loads(r[0]) for r in db.execute("SELECT session_json FROM iteration_sessions")]
    generated = [r for r in rows if "llm" in (r.get("behaviourAdapter"), r.get("institutionAdapter"),
                                              r.get("reviewAdapter"), r.get("improvementAdapter"))]
    return {
        "sessions": len(rows),
        "modelSessions": len(generated),
        "attempts": db.execute("SELECT count(*) FROM attempts").fetchone()[0],
        # Village calls (head, residents, institutions) and loop calls (reviews,
        # synthesis, improvement) are kept in two tables.
        "modelCalls": sum(db.execute("SELECT count(*) FROM %s" % t).fetchone()[0]
                          for t in ("attempt_model_calls", "model_calls")),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--replace", action="store_true", help="이미 있는 sim 기록을 덮어쓴다")
    args = parser.parse_args()

    source, target = database_path(REAL, {}), database_path(SIM, {})
    if not source.exists():
        print("real 버전의 기록이 없습니다: %s — run-real 로 먼저 돌리세요." % source)
        return 2

    real = sqlite3.connect("file:%s?mode=ro" % source.as_posix(), uri=True)
    running = [(r[0], r[1]) for r in real.execute("SELECT id, status FROM iteration_sessions")
               if r[1] in ACTIVE]
    if running:
        print("아직 돌고 있는 세션이 있어 얼리지 않습니다 (끝나거나 멈춘 뒤 다시):")
        for sid, status in running:
            print("  %s  %s" % (sid, status))
        return 1

    if target.exists():
        old = sqlite3.connect("file:%s?mode=ro" % target.as_posix(), uri=True)
        before = summary(old)
        old.close()
        if not args.replace:
            print("sim 기록이 이미 있습니다: %s" % target)
            print("  지금 sim: 세션 %(sessions)d (모델 생성 %(modelSessions)d) · 실행 %(attempts)d"
                  % before)
            print("덮어쓰려면 --replace")
            return 1

    target.parent.mkdir(parents=True, exist_ok=True)
    frozen = sqlite3.connect(target)
    real.backup(frozen)
    after = summary(frozen)
    frozen.close()
    real.close()
    print("얼렸습니다: %s → %s" % (source.name, target))
    print("  세션 %(sessions)d (모델 생성 %(modelSessions)d) · 실행 %(attempts)d · "
          "기록된 모델 호출 %(modelCalls)d" % after)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
