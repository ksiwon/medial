"""The scene pictures, the spoken lines and the village map the exhibition draws and plays.

Both are made ahead of time and kept out of the repository (``local-data/``, git-ignored): the pictures by
``scripts/art.mjs``, the voices by ``scripts/tts_scenes.py``. This module only says which exist and where. A
missing picture or voice is never an error - the screen draws a schematic figure and reads a line in silence -
so an empty folder answers with an empty index.

They are invented illustrations and recordings of pseudonymous residents; none is a real person's likeness
or voice.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]


def art_dir() -> Path:
    return Path(os.environ.get("MEDIAL_ART_DIR") or REPO_ROOT / "local-data" / "art")


def voice_dir() -> Path:
    return Path(os.environ.get("MEDIAL_VOICE_DIR") or REPO_ROOT / "local-data" / "audio" / "gemini-3.8-flash-tts")


def _manifest(folder: Path, name: str) -> dict[str, Any]:
    path = folder / name
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def art_index() -> dict[str, str]:
    """Scene pictures: ``{name: file}``. One background per place and one layer per person and pose."""
    folder = art_dir()
    return {name: row["file"] for name, row in _manifest(folder, "index.json").items() if (folder / row["file"]).exists()}


def village_dir() -> Path:
    return Path(os.environ.get("MEDIAL_VILLAGE_DIR") or REPO_ROOT / "local-data" / "normalized")


def village_map() -> dict[str, Any]:
    """The village as the scene's map column draws it: where the places and the homes are, the patrol route, and
    how to stand the source's own raster north-up. Read from the git-ignored registry (``village.v1.json``); the
    raster is served beside it (``village_map_file``) and never bundled. Without the registry the column says the
    map is missing - it never draws an invented village."""
    folder = village_dir()
    data = _manifest(folder, "village.v1.json")
    if not data:
        return {"available": False}
    image = data.get("mapImage") or None
    raster = None
    if image and (folder / image["file"]).exists():
        raster = {"width": image["sourceWidthPx"], "height": image["sourceHeightPx"], "matrix": image["northUpMatrix"]}
    xy = lambda p: {"x": p["x"], "y": p["y"]}  # noqa: E731
    return {
        "available": True,
        "viewBox": data["geometry"]["viewBox"],
        "raster": raster,
        "places": {key: xy(p) for key, p in data["places"].items()},
        "homes": {key: xy(h) for key, h in data["homes"].items()},
        "patrol": data.get("patrol", []),
    }


def village_map_file() -> Path | None:
    folder = village_dir()
    image = _manifest(folder, "village.v1.json").get("mapImage")
    path = folder / image["file"] if image else None
    return path if path and path.exists() else None


def voice_index() -> dict[str, dict[str, Any]]:
    """The spoken lines: ``{"speaker|text": {"file", "seconds"}}``. Each line was spoken once ahead of time."""
    folder = voice_dir()
    return {line: row for line, row in _manifest(folder, "manifest.json").items() if (folder / row["file"]).exists()}
