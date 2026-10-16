"""The exhibition's two screens, joined: a wall that shows, a tablet that touches.

The wall is a browser that plays the stored record exactly as the single screen
did - it owns the playhead, the timers and every choice's consequence. The
tablet owns nothing: it sends what the visitor pressed and draws what the wall
says it is showing. This module only carries those two things between them.

  tablet --POST /stage/command--> server --SSE "command"--> wall
  wall   --POST /stage/state----> server --SSE "state"----> tablet

Nothing is stored and nothing here starts a run. A command is a press, not a
research record; the sim version lets these two paths through for that reason
(mode.py), and no other write.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator, Literal

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/sim/stage", tags=["stage"])

Role = Literal["wall", "pad"]

#: What a press can be. The wall refuses to guess at anything else.
COMMANDS = (
    "start", "skipIntro", "togglePlay", "skipScene", "seek", "commit",
    "readEvaluations", "evalPage", "evalOpen", "evalClose", "evalIssues", "openScene",
    "goImprove", "choose", "closing", "home",
)

PING_SECONDS = 15
QUEUE_SIZE = 64


class StageCommand(BaseModel):
    name: Literal[COMMANDS]  # type: ignore[valid-type]
    #: seek: milliseconds into the day. evalPage: -1 or 1.
    value: int | None = None
    #: evalOpen: an actor id. openScene: an event id. choose: a generation id.
    id: str | None = Field(default=None, max_length=80)


class StageHub:
    """Who is listening, and the last thing the wall said it was showing."""

    def __init__(self) -> None:
        self._subs: dict[asyncio.Queue[str], Role] = {}
        self.state: dict[str, Any] | None = None

    def presence(self) -> dict[str, int]:
        roles = list(self._subs.values())
        return {"wall": roles.count("wall"), "pad": roles.count("pad")}

    def subscribe(self, role: Role) -> asyncio.Queue[str]:
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=QUEUE_SIZE)
        self._subs[queue] = role
        self._send("presence", self.presence())
        return queue

    def unsubscribe(self, queue: asyncio.Queue[str]) -> None:
        self._subs.pop(queue, None)
        self._send("presence", self.presence())

    def _send(self, event: str, data: Any, to: Role | None = None) -> int:
        frame = "event: %s\ndata: %s\n\n" % (event, json.dumps(data, ensure_ascii=False))
        delivered = 0
        for queue, role in list(self._subs.items()):
            if to is not None and role != to:
                continue
            if queue.full():  # a stalled listener loses its oldest frame, not the others' time
                queue.get_nowait()
            queue.put_nowait(frame)
            delivered += 1
        return delivered

    def command(self, body: StageCommand) -> int:
        return self._send("command", body.model_dump(exclude_none=True), to="wall")

    def publish_state(self, state: dict[str, Any]) -> int:
        self.state = state
        return self._send("state", state, to="pad")


hub = StageHub()


async def frames(role: Role, h: StageHub | None = None) -> AsyncIterator[str]:
    h = h or hub
    queue = h.subscribe(role)
    try:
        yield "retry: 1000\n\n"
        yield "event: presence\ndata: %s\n\n" % json.dumps(h.presence())
        if role == "pad" and h.state is not None:
            yield "event: state\ndata: %s\n\n" % json.dumps(h.state, ensure_ascii=False)
        while True:
            try:
                yield await asyncio.wait_for(queue.get(), PING_SECONDS)
            except asyncio.TimeoutError:
                yield ": ping\n\n"
    finally:
        h.unsubscribe(queue)


@router.get("/events")
async def events(role: Role = Query(...)) -> StreamingResponse:
    return StreamingResponse(
        frames(role), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/command")
async def command(body: StageCommand) -> dict[str, Any]:
    return {"delivered": hub.command(body)}


@router.post("/state")
async def state(body: dict[str, Any]) -> dict[str, Any]:
    return {"delivered": hub.publish_state(body)}
