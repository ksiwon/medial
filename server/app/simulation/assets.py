"""The scene pictures, the spoken lines and the village map the exhibition draws and plays.

Both are made ahead of time and kept out of the repository (``local-data/``, git-ignored): the pictures by
``scripts/art.mjs``, the voices by ``scripts/tts_scenes.py``. This module only says which exist and where. A
missing picture or voice is never an error - the screen draws a schematic figure and reads a line in silence -
so an empty folder answers with an empty index.

They are invented illustrations and recordings of pseudonymous residents; none is a real person's likeness
or voice.
"""
from __future__ import annotations

import array
import functools
import json
import math
import os
import re
import wave
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


# The narrator reads several sentences in one recording. The film's "previous" and "next" go a sentence at a time, so it
# has to know where in the recording each sentence begins: the narrator breathes between sentences (about 0.6-0.8 s,
# longer than the 0.2-0.4 s of a comma), and that breath is found in the audio itself rather than guessed from the text.
_SENTENCE_GAP = re.compile(r"(?<=[.?!])\s+")
_BREATH_DB = -38.0  # quieter than this is silence (dB below full scale)
_BREATH_S = 0.45  # a silence this long is a breath between sentences, not a comma
_WINDOW_S = 0.01
_TOLERANCE = 0.22  # a breath further than this share of the recording from where the text says a sentence ends is not that sentence's


def sentences_of(text: str) -> list[str]:
    return [piece for piece in _SENTENCE_GAP.split(text.strip()) if piece]


def _silences(path: Path) -> tuple[float, list[tuple[float, float]]]:
    """The recording's length and its silences (start, end) in seconds: runs of quiet windows at least a breath long."""
    with wave.open(str(path)) as w:
        if w.getsampwidth() != 2:
            return 0.0, []
        rate, channels = w.getframerate(), w.getnchannels()
        samples = array.array("h")
        samples.frombytes(w.readframes(w.getnframes()))
    step = max(int(rate * _WINDOW_S), 1) * channels
    floor = 32768 * 10 ** (_BREATH_DB / 20)
    quiet: list[bool] = []
    for i in range(0, len(samples) - step + 1, step):
        window = samples[i:i + step]
        quiet.append(math.sqrt(sum(v * v for v in window) / len(window)) < floor)
    length = len(samples) / channels / rate
    runs: list[tuple[float, float]] = []
    start: int | None = None
    for i, q in enumerate(quiet + [False]):
        if q and start is None:
            start = i
        elif not q and start is not None:
            a, b = start * _WINDOW_S, i * _WINDOW_S
            if b - a >= _BREATH_S and a > 0.1 and b < length - 0.1:
                runs.append((a, b))
            start = None
    return length, runs


@functools.lru_cache(maxsize=64)
def _sentence_starts(path: str, mtime: float, text: str) -> tuple[float, ...]:
    """Where the second, third ... sentence of the recording begins (seconds into it); empty when there is one sentence
    or the breaths cannot be told from the text (the screen then falls back to the share of the characters)."""
    sentences = sentences_of(text)
    if len(sentences) < 2:
        return ()
    length, runs = _silences(Path(path))
    if length <= 0:
        return ()
    total = sum(len(s) for s in sentences)
    starts: list[float] = []
    before = 0
    for sentence in sentences[:-1]:
        before += len(sentence)
        expected = length * before / total
        near = [r for r in runs if (not starts or r[1] > starts[-1]) and abs((r[0] + r[1]) / 2 - expected) <= _TOLERANCE * length]
        if not near:
            return ()
        a, b = min(near, key=lambda r: abs((r[0] + r[1]) / 2 - expected))
        starts.append(round(max(b - 0.08, a), 2))  # a hair before the voice comes back, so the first syllable is whole
    return tuple(starts)


def voice_index() -> dict[str, dict[str, Any]]:
    """The spoken lines: ``{"speaker|text": {"file", "seconds"}}``. Each line was spoken once ahead of time. The
    narrator's recordings of several sentences also say where each later sentence begins (``marks``, seconds)."""
    folder = voice_dir()
    rows = {line: row for line, row in _manifest(folder, "manifest.json").items() if (folder / row["file"]).exists()}
    for line, row in rows.items():
        if not line.startswith("NARRATOR|"):
            continue
        path = folder / row["file"]
        try:
            marks = _sentence_starts(str(path), path.stat().st_mtime, line.split("|", 1)[1])
        except (wave.Error, OSError, EOFError):
            marks = ()
        if marks:
            rows[line] = {**row, "marks": list(marks)}
    return rows
