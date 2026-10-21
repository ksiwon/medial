"""HTTP surface of the exhibition server.

It reads. What the screens show - the week, its scenes, the residents' evaluations and the requests that came of
them - was written and checked ahead of time (``fixtures/week/``, see ``week.py``), and the pictures and the
spoken lines were made ahead of time too (``assets.py``). Nothing here runs a model or starts a run, and the only
writes a request may make are the two relays of the two screens (``stage.py``): a press from the tablet and the
wall's account of what it shows. Every other write is refused in one place, before any route runs, so no new
endpoint can forget it.
"""
from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from ..assets import art_dir, art_index, village_map, village_map_file, voice_dir, voice_index
from ..week import WeekError, load_week
from .stage import router as stage_router

router = APIRouter(prefix="/api/sim", tags=["exhibition"])

#: The two writes the server accepts: relays of a press and of the wall's state. Neither is a research record.
_RELAY = re.compile(r"^/api/sim/stage/(command|state)$")
_READS = frozenset({"GET", "HEAD", "OPTIONS"})
REFUSAL = "이 서버는 미리 만들어 둔 기록만 보여 줍니다. 새로 만들려면 scripts/gen_week_*.py 를 쓰세요."


@router.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "reads": "fixtures/week", "modelCalls": "none"}


@router.get("/week")
def week() -> dict[str, Any]:
    """The week the exhibition reads (see ``week.py``), joined and checked once."""
    try:
        return load_week()
    except WeekError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.get("/village/art")
def art() -> dict[str, Any]:
    """Which scene pictures exist. The screen draws a schematic figure for any name missing here."""
    return {"names": sorted(art_index())}


@router.get("/village/art/{name}")
def art_file(name: str) -> Any:
    index = art_index()
    if name not in index:
        raise HTTPException(status_code=404, detail="이 그림은 없다: %s" % name)
    return FileResponse(art_dir() / index[name], media_type="image/webp", headers=REVALIDATE)


# The recordings and pictures are renumbered and redrawn between runs under the same names: a browser that kept the old
# file by its date would play the old voice under the new caption. no-cache makes it ask first (the file answers 304 when it is unchanged).
REVALIDATE = {"Cache-Control": "no-cache"}


@router.get("/village/map")
def village() -> dict[str, Any]:
    """Where the places and homes are, for the scene's map column (``assets.village_map``)."""
    return village_map()


@router.get("/village/map.png")
def village_map_png() -> Any:
    path = village_map_file()
    if path is None:
        raise HTTPException(status_code=404, detail="마을 지도 파일이 없다 (local-data/normalized)")
    return FileResponse(path, media_type="image/png", headers=REVALIDATE)


@router.get("/village/voice")
def voices() -> dict[str, Any]:
    """The spoken lines: which line has a recording and how long it is. A line missing here is read in silence."""
    return {"lines": voice_index()}


@router.get("/village/voice/{file}")
def voice_file(file: str) -> Any:
    if file not in {row["file"] for row in voice_index().values()}:
        raise HTTPException(status_code=404, detail="이 음성은 없다: %s" % file)
    return FileResponse(voice_dir() / file, media_type="audio/wav", headers=REVALIDATE)


class ReadsOnly:
    """The one write rule, as plain ASGI rather than ``@app.middleware("http")``: that wraps the body and the
    response, and a live stream (api/stage.py) must never see its listener's disconnect swallowed. This looks only at
    the method and the path and passes the rest through untouched."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] == "http" and scope["method"] not in _READS and not _RELAY.match(scope["path"]):
            await JSONResponse(status_code=403, content={"detail": REFUSAL})(scope, receive, send)
            return
        await self.app(scope, receive, send)


def create_app() -> FastAPI:
    app = FastAPI(title="Desimer exhibition server", version="5")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(ReadsOnly)
    app.include_router(router)
    app.include_router(stage_router)
    return app
