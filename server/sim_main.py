"""Entry point for the research simulator server.

    python server/sim_main.py --mode sim     # plays what real ran earlier; no model, no key
    python server/sim_main.py --mode real    # generates as it goes; reads the key from its env

Usually started through ``run-sim`` / ``run-real`` at the repository root, which
also start the screen. The two versions keep separate databases
(``local-data/runs/sim.sqlite3`` and ``real.sqlite3``); see
``app/simulation/mode.py``.

Deliberately separate from app/main.py: that server loads Whisper, FAISS and the
triage pipeline, none of which this one needs.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.simulation.api.routes import create_app  # noqa: E402
from app.simulation.mode import MODES, REAL, database_path, server_mode  # noqa: E402

app = create_app()


def load_env_file(path: Path) -> None:
    """``KEY=value`` lines into the environment, without printing any of them.
    CRLF, comments and surrounding quotes are tolerated; the file is not changed."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.split(" #", 1)[0].strip().strip('"').strip("'")
        if key.strip() and value:
            os.environ.setdefault(key.strip(), value)


def main() -> int:
    parser = argparse.ArgumentParser(description="MEDial research simulator")
    parser.add_argument("--mode", choices=MODES, default=os.environ.get("MEDIAL_MODE") or None,
                        help="sim: 미리 돌려 둔 기록을 재생 · real: 실시간으로 생성")
    args = parser.parse_args()
    if args.mode is None:
        parser.error("--mode sim 또는 --mode real 을 정하세요 (MEDIAL_MODE 로도 됩니다)")
    os.environ["MEDIAL_MODE"] = args.mode
    mode = server_mode()

    if mode == REAL:
        # The key lives in server/.env and only this process reads it. Values
        # already in the environment win, so a test can point elsewhere.
        load_env_file(Path(__file__).resolve().parent / ".env")
        if not os.environ.get("OPENAI_API_KEY"):
            print("real 버전인데 OPENAI_API_KEY 가 없습니다. 규칙 어댑터만 고를 수 있습니다.",
                  file=sys.stderr)
    else:
        # A sim server with nothing to play would come up empty and look broken.
        # Say what to do instead of creating an empty database.
        db = database_path(mode)
        if not db.exists():
            print("sim 버전이 재생할 기록이 없습니다: %s" % db, file=sys.stderr)
            print("real 버전에서 돌린 것을 얼려 두세요: python scripts/freeze_sim.py",
                  file=sys.stderr)
            return 2
        # The sim version never reads a key; drop one that leaked into its
        # environment so nothing below could pick it up by accident.
        os.environ.pop("OPENAI_API_KEY", None)

    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("MEDIAL_SIM_PORT", 8010)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
