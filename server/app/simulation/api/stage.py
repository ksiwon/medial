"""The exhibition's two screens, joined: a wall that shows, a tablet that touches.

The wall is a browser that plays the stored record exactly as the single screen
did - it owns the playhead, the timers and every choice's consequence. The
tablet owns nothing: it sends what the visitor pressed and draws what the wall
says it is showing. This module only carries those two things between them.

  tablet --POST /stage/command--> server --SSE "command"--> wall
  wall   --POST /stage/state----> server --SSE "state"----> tablet

Pairing: every run of the server makes one token. The wall (on this machine) reads it
and draws it as a QR code; a tablet that scans it opens the page with the token and
is the one tablet. A press without the token is refused, so another device on the same
network that only knows the address cannot drive the exhibition. A second tablet that
scans the code takes over and the first is told it was released. The token is kept in
memory only and is new every run.

Nothing is stored and nothing here starts a run. A command is a press, not a
research record; the sim version lets these two paths through for that reason
(mode.py), and no other write.
"""
from __future__ import annotations

import asyncio
import ipaddress
import json
import os
import secrets
import socket
from typing import Any, AsyncIterator, Awaitable, Callable, Literal

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/sim/stage", tags=["stage"])

#: What the wall's own browser calls this machine. A tablet reaches it by its network address,
#: so the name it came in by tells the two apart even behind the web server's proxy, which
#: makes every request look like it came from 127.0.0.1 (vite.config.ts forwards the original host).
WALL_HOSTS = ("localhost", "127.0.0.1", "[::1]", "testserver")

Role = Literal["wall", "pad"]

#: What a press can be. The wall refuses to guess at anything else.
COMMANDS = (
    "start", "skipIntro", "openEvent", "line", "skipScene", "toEvaluations", "openResident", "closeResident",
    "toChoose", "choose", "toResult", "week", "home",
)

PING_SECONDS = 8
QUEUE_SIZE = 64
#: Put on a listener's queue to end its stream.
CLOSE = "\0close"


class StageCommand(BaseModel):
    name: Literal[COMMANDS]  # type: ignore[valid-type]
    #: line: -1 or 1.
    value: int | None = None
    #: openEvent: an event id. openResident: an actor id. choose: a request id.
    id: str | None = Field(default=None, max_length=80)


class StageHub:
    """Who is listening, and the last thing the wall said it was showing.

    Two rules keep two screens from tripping over each other:

    * there is one wall and one tablet. A newer one takes over from an older one of the same role and the
      older is told so - a reloaded wall page must not leave a second wall that does every press twice;
    * what must not be lost (being released, the end of a stream) is never dropped to make room: only the
      stream of frames a screen can do without (state, presence) loses its oldest when a listener stalls.
    """

    def __init__(self) -> None:
        self._subs: dict[asyncio.Queue[str], Role] = {}
        self.state: dict[str, Any] | None = None
        self.token = secrets.token_urlsafe(9)

    def accepts(self, token: str | None) -> bool:
        return token is not None and secrets.compare_digest(token, self.token)

    def presence(self) -> dict[str, int]:
        # Counted as who is *current*: a listener that has been told to go is already gone.
        roles = [role for queue, role in self._subs.items() if not self._leaving(queue)]
        return {"wall": roles.count("wall"), "pad": roles.count("pad")}

    @staticmethod
    def _leaving(queue: "asyncio.Queue[str]") -> bool:
        return getattr(queue, "leaving", False)

    def subscribe(self, role: Role) -> asyncio.Queue[str]:
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=QUEUE_SIZE)
        for other, who in list(self._subs.items()):
            if who == role and not self._leaving(other):
                self._release(other, "released" if role == "pad" else "replaced")
        self._subs[queue] = role
        if role == "wall":
            # A new wall knows nothing of what the old one showed; the tablet should not keep drawing it.
            self.state = None
        self._send("presence", self.presence())
        return queue

    @staticmethod
    def _release(queue: "asyncio.Queue[str]", event: str) -> None:
        """Tell a listener it is no longer the one, and end its stream - without ever dropping those frames."""
        queue.leaving = True  # type: ignore[attr-defined]
        while queue.maxsize - queue.qsize() < 2:  # room for both frames, whatever was waiting
            queue.get_nowait()
        queue.put_nowait("event: %s\ndata: {}\n\n" % event)
        queue.put_nowait(CLOSE)

    def unsubscribe(self, queue: asyncio.Queue[str]) -> None:
        role = self._subs.pop(queue, None)
        if role == "wall" and not any(r == "wall" for r in self._subs.values()):
            self.state = None  # nobody is saying what is on screen any more
        self._send("presence", self.presence())

    def _send(self, event: str, data: Any, to: Role | None = None) -> int:
        frame = "event: %s\ndata: %s\n\n" % (event, json.dumps(data, ensure_ascii=False))
        delivered = 0
        for queue, role in list(self._subs.items()):
            if (to is not None and role != to) or self._leaving(queue):
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


#: How often a quiet stream looks to see whether the other end is still there. The server does not find out
#: that a browser went away by itself (a closed laptop, a dropped wifi, an iPad that slept send nothing), and a
#: stream nobody listens to must not go on counting as "the wall" or "the tablet" - the next screen to come
#: would be told it was replaced, and the one that is gone would still be said to be there.
WATCH_SECONDS = 1.0


async def frames(role: Role, h: StageHub | None = None, gone: Callable[[], Awaitable[bool]] | None = None) -> AsyncIterator[str]:
    """The stream for one listener. `gone` says whether the browser has left; without it only a release ends the stream."""
    h = h or hub
    queue = h.subscribe(role)
    quiet = 0.0
    step = min(WATCH_SECONDS, PING_SECONDS)
    try:
        yield "retry: 1000\n\n"
        yield "event: presence\ndata: %s\n\n" % json.dumps(h.presence())
        if role == "pad" and h.state is not None:
            yield "event: state\ndata: %s\n\n" % json.dumps(h.state, ensure_ascii=False)
        while True:
            try:
                frame = await asyncio.wait_for(queue.get(), step)
            except asyncio.TimeoutError:
                if gone is not None and await gone():
                    return
                quiet += step
                if quiet >= PING_SECONDS:
                    quiet = 0.0
                    # A named event, not a comment: the page can see it, and tell a quiet line from a dead one.
                    yield "event: ping\ndata: {}\n\n"
                continue
            quiet = 0.0
            if frame == CLOSE:
                return
            yield frame
    finally:
        h.unsubscribe(queue)


#: Ranges that only mean something inside this machine (VirtualBox host-only, Docker, WSL, link-local):
#: a tablet cannot reach them, so a QR code must never carry one.
_INSIDE = tuple(ipaddress.ip_network(n) for n in (
    "192.168.56.0/24", "192.168.99.0/24", "172.17.0.0/16", "172.18.0.0/16", "172.20.0.0/14", "169.254.0.0/16"))


def lan_addresses() -> list[str]:
    """The addresses a tablet on the same network could use to reach this machine, best guess first.

    The default route's own address comes first (the interface the machine actually reaches the network
    through); others follow. `MEDIAL_LAN_HOST` overrides everything, for a machine with an odd network.
    """
    forced = os.environ.get("MEDIAL_LAN_HOST", "").strip()
    if forced:
        return [forced]
    found: list[str] = []
    try:  # no packet is sent: connecting a UDP socket only picks the outgoing interface
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("10.255.255.255", 1))
            found.append(probe.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.append(info[4][0])
    except OSError:
        pass
    out: list[str] = []
    for text in found:
        ip = ipaddress.ip_address(text)
        if ip.is_private and not ip.is_loopback and not any(ip in net for net in _INSIDE) and text not in out:
            out.append(text)
    return out


def _from_this_machine(request: Request) -> bool:
    """Whether the wall's own browser is asking: it opened this machine as `localhost`."""
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").rsplit(":", 1)[0]
    if host.startswith("[") and not host.endswith("]"):  # an IPv6 literal lost its closing bracket to the split
        host += "]"
    return host in WALL_HOSTS


def _need_token(token: str | None) -> None:
    if not hub.accepts(token):
        raise HTTPException(status_code=403, detail="QR 코드를 다시 스캔해 주세요.")


@router.get("/pairing")
async def pairing(request: Request) -> dict[str, Any]:
    """The token, for the wall's own browser to draw as a QR code. Never for a tablet."""
    if not _from_this_machine(request):
        raise HTTPException(status_code=403, detail="이 주소는 전시 화면이 있는 기계에서만 읽습니다.")
    return {"token": hub.token, "addresses": lan_addresses(), **hub.presence()}


@router.get("/check")
async def check(token: str | None = None) -> dict[str, Any]:
    """Whether this tablet's code is still good: a dropped stream and a refused code look the same to a browser."""
    _need_token(token)
    return {"ok": True}


@router.get("/events")
async def events(request: Request, role: Role = Query(...), token: str | None = None) -> StreamingResponse:
    if role == "pad":
        _need_token(token)
    elif not _from_this_machine(request):
        raise HTTPException(status_code=403, detail="모니터 화면은 이 기계에서만 엽니다.")
    return StreamingResponse(
        frames(role, gone=request.is_disconnected), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/command")
async def command(body: StageCommand, token: str | None = None) -> dict[str, Any]:
    _need_token(token)
    return {"delivered": hub.command(body)}


@router.post("/state")
async def state(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    if not _from_this_machine(request):
        raise HTTPException(status_code=403, detail="모니터 화면만 상태를 알립니다.")
    return {"delivered": hub.publish_state(body)}
