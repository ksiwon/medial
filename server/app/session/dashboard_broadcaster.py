"""Singleton fan-out for /ws/dashboard subscribers."""
from __future__ import annotations
import asyncio
import json
import logging
from typing import Optional
from fastapi import WebSocket

log = logging.getLogger(__name__)


class DashboardBroadcaster:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self.clients.add(ws)
        log.info(f"Dashboard client connected (total={len(self.clients)})")

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self.clients.discard(ws)
        log.info(f"Dashboard client disconnected (total={len(self.clients)})")

    async def broadcast(self, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False)
        dead: list[WebSocket] = []
        async with self._lock:
            targets = list(self.clients)
        for ws in targets:
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self.clients.discard(ws)


_broadcaster: Optional[DashboardBroadcaster] = None

def get_broadcaster() -> DashboardBroadcaster:
    global _broadcaster
    if _broadcaster is None:
        _broadcaster = DashboardBroadcaster()
    return _broadcaster
