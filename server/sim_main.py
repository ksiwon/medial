"""Entry point for the research simulator server.

    python server/sim_main.py            # or: python -m uvicorn app.simulation.api.routes:create_app --factory

Deliberately separate from app/main.py: that server loads Whisper, FAISS and the
triage pipeline, none of which this one needs. Starting this requires no API key.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.simulation.api.routes import create_app  # noqa: E402

app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("MEDIAL_SIM_PORT", 8010)))
