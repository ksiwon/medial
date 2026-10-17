"""Entry point of the exhibition server.

    python server/sim_main.py

It only reads: the week in ``fixtures/week/`` and the pictures and voices in ``local-data/``. It never calls a
model and never reads a key - the dialogues and evaluations were written ahead of time by
``scripts/gen_week_dialogue.py`` and ``scripts/gen_week_evaluations.py``, which are the only things that do.
Usually started through ``run-exhibition`` at the repository root, which also starts the screen.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.simulation.api.routes import create_app  # noqa: E402

app = create_app()


def main() -> int:
    import uvicorn

    # 127.0.0.1 unless told otherwise: the API is only for the screens on this machine. The two-screen
    # exhibition reaches it through the web server's proxy.
    uvicorn.run(app, host=os.environ.get("MEDIAL_SIM_HOST", "127.0.0.1"),
                port=int(os.environ.get("MEDIAL_SIM_PORT", 8020)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
