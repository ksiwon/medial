"""Which version of the tool this server is: ``sim`` or ``real``.

Two versions, told apart here at the edge instead of by flags scattered through
the engine. The engine, the adapters and the screens do not know which one they
are in; only what this module lets through differs.

* **real** generates as it goes. It reads the model key from its environment,
  runs what the researcher starts - rule or model adapters - and writes every
  run to its own database, ``local-data/runs/real.sqlite3``.
* **sim** plays what real already ran. It never reads a key and never builds a
  model client, and it refuses every request that would start a run or write a
  research record. What it serves is a frozen copy of real's database,
  ``local-data/runs/sim.sqlite3``, made by ``scripts/freeze_sim.py``. The only
  thing that moves is an attempt's playback cursor.

There is no default. A server that silently came up as one of the two would make
"was this generated just now?" unanswerable, which is the whole point of having
two. ``run-sim`` and ``run-real`` set ``MEDIAL_MODE``; so does
``server/sim_main.py --mode``.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

SIM = "sim"
REAL = "real"
MODES = (SIM, REAL)

RUNS_DIR = Path(__file__).resolve().parents[3] / "local-data" / "runs"

#: The one write a sim server accepts: moving an attempt's playback cursor
#: (play, pause, step, seek). It changes where the reader is, not what happened.
_CURSOR_PATH = re.compile(r"^/api/sim/attempts/[^/]+/commands$")
_READS = frozenset({"GET", "HEAD", "OPTIONS"})

SIM_REFUSAL = ("sim 버전은 미리 돌려 둔 기록만 보여 줍니다. 새 실행·수정안 확정·현장 기록은 "
               "real 버전(run-real)에서 합니다.")


class ModeNotSet(RuntimeError):
    """The server was started without saying which version it is."""


def server_mode(env: dict[str, str] | None = None) -> str:
    value = (env if env is not None else os.environ).get("MEDIAL_MODE", "").strip()
    if value not in MODES:
        raise ModeNotSet(
            "MEDIAL_MODE 가 sim 또는 real 이어야 합니다 (지금: %r). run-sim 이나 run-real 로 "
            "띄우거나 python server/sim_main.py --mode sim|real 로 실행하세요." % value)
    return value


def database_path(mode: str, env: dict[str, str] | None = None) -> Path:
    """Each version keeps its own database. ``MEDIAL_SIM_DB`` still wins, so a
    test or the e2e run can point either one somewhere disposable."""
    explicit = (env if env is not None else os.environ).get("MEDIAL_SIM_DB")
    return Path(explicit) if explicit else RUNS_DIR / ("%s.sqlite3" % mode)


def refuses(mode: str, method: str, path: str) -> bool:
    """Whether a sim server turns this request away."""
    if mode != SIM or method.upper() in _READS:
        return False
    return not _CURSOR_PATH.match(path)


__all__ = ["SIM", "REAL", "MODES", "SIM_REFUSAL", "ModeNotSet", "server_mode",
           "database_path", "refuses"]
