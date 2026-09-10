"""Read the raw declarations out of the source simulator HTML.

Nothing here interprets the data; it only lifts the literals so that
normalize.py can apply the documented baseline/overlay split with provenance.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .jsvalue import parse_declaration

# The map raster is a multi-hundred-kilobyte data: URI. We never carry it around.
_DATA_URI = re.compile(r'data:image/[a-z]+;base64,[A-Za-z0-9+/=]+')

DECLARATIONS = ("MAP", "ROUTES", "PATROL", "PLACE", "HOME", "GROUP", "QCOL", "QORDER", "P", "AMB", "EV")


@dataclass(frozen=True)
class SourceFile:
    path: Path
    sha256: str
    bytes: int

    def as_dict(self) -> dict[str, Any]:
        return {"name": self.path.name, "sha256": self.sha256, "bytes": self.bytes}


def read_source(path: Path) -> tuple[str, SourceFile]:
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    text = raw.decode("utf-8")
    meta = SourceFile(path=path, sha256=digest, bytes=len(raw))
    return text, meta


def extract(path: Path) -> tuple[dict[str, Any], SourceFile]:
    text, meta = read_source(path)
    # The map raster is the source's own drawing of the coastline, the houses
    # and the fields. It is the thing to restore on screen rather than redraw,
    # so it is lifted out here and written to the git-ignored registry - never
    # into the repository, and never parsed as part of the MAP literal.
    raster = _DATA_URI.search(text)
    map_image = raster.group(0).split(",", 1)[1] if raster else None
    text = _DATA_URI.sub("<omitted-raster>", text)
    out: dict[str, Any] = {}
    for name in DECLARATIONS:
        out[name] = parse_declaration(text, name)
    out["_orientationQuote"] = _orientation_quote(text)
    out["_speeds"] = _speeds(text)
    out["_mapImageB64"] = map_image
    return out, meta


def _orientation_quote(text: str) -> str | None:
    """The source states its own map orientation in prose; we quote it verbatim."""
    m = re.search(r"지도는 북쪽이[^<]*", text)
    return m.group(0).strip() if m else None


def _speeds(text: str) -> dict[str, float]:
    m = re.search(r"const WALK\s*=\s*([0-9.]+)\s*,\s*DRIVE\s*=\s*([0-9.]+)\s*,\s*BOAT\s*=\s*([0-9.]+)", text)
    if not m:
        raise ValueError("WALK/DRIVE/BOAT constants not found in source")
    return {
        "walkMPerMin": float(m.group(1)),
        "driveMPerMin": float(m.group(2)),
        "boatMPerMin": float(m.group(3)),
    }
