"""/ws/dashboard — broadcast new reports to the clinic dashboard view."""
from __future__ import annotations
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.session.dashboard_broadcaster import get_broadcaster

router = APIRouter()
log = logging.getLogger(__name__)


@router.websocket("/ws/dashboard")
async def dashboard_ws(websocket: WebSocket) -> None:
    broadcaster = get_broadcaster()
    await broadcaster.connect(websocket)
    try:
        # Keep-alive: dashboard never sends — just receives pushes.
        while True:
            await websocket.receive_text()  # blocks; raises on disconnect
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning(f"Dashboard WS error: {e}")
    finally:
        await broadcaster.disconnect(websocket)
