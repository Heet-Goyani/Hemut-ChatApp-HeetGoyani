"""
WebSocket Connection Manager with Redis Pub/Sub fan-out.

Architecture:
  - Each connected WebSocket is registered by user_id.
  - When a message is posted to a channel, it's published to Redis topic: channel:{channel_id}
  - All connected users who are members of that channel receive the broadcast via their WS.
  - Presence heartbeats refresh the Redis TTL every 20s.

Event types (JSON over WebSocket):
  new_message      — new channel or DM message
  message_edited   — message content updated
  message_deleted  — message removed
  presence_change  — user online/away/offline
  typing_start     — user started typing in a channel/DM
  typing_stop      — user stopped typing
  ai_response      — AI summary complete
  shipment_alert   — flagged shipment notification
  heartbeat_ack    — server acknowledgement of heartbeat ping
"""
import asyncio
import json
import uuid
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.middleware.auth_middleware import get_current_user_ws
from app.services.presence_service import set_user_presence, refresh_presence
from app.services.channel_service import get_all_channels
from app.redis_client import get_redis

websocket_router = APIRouter()

# ── In-process registry ───────────────────────────────────────────
# Maps user_id (str) → set of active WebSocket connections
_connections: dict[str, set[WebSocket]] = defaultdict(set)


def register(user_id: str, ws: WebSocket) -> None:
    _connections[user_id].add(ws)


def unregister(user_id: str, ws: WebSocket) -> None:
    _connections[user_id].discard(ws)
    if not _connections[user_id]:
        del _connections[user_id]


async def send_to_user(user_id: str, payload: dict) -> None:
    """Send a JSON event to all connections of a specific user."""
    dead = set()
    for ws in list(_connections.get(user_id, set())):
        try:
            await ws.send_json(payload)
        except Exception:
            dead.add(ws)
    for ws in dead:
        _connections[user_id].discard(ws)


async def broadcast_to_channel(channel_id: str, payload: dict, exclude_user: str | None = None) -> None:
    """
    Publish an event to Redis so ALL server instances fan it out.
    This is the correct path for channel events.
    """
    redis = await get_redis()
    await redis.publish(f"channel:{channel_id}", json.dumps(payload))


async def broadcast_presence(user_id: str, status: str, channel_ids: list[str]) -> None:
    """Broadcast a presence_change event to all channels the user is a member of."""
    payload = {
        "type": "presence_change",
        "user_id": user_id,
        "status": status,
    }
    redis = await get_redis()
    for channel_id in channel_ids:
        await redis.publish(f"channel:{channel_id}", json.dumps(payload))


# ── Redis subscriber loop ─────────────────────────────────────────
async def _redis_subscriber(user_id: str, channel_ids: list[str], send_queue: asyncio.Queue) -> None:
    """
    Subscribe to all channel topics for this user.
    Puts received messages onto a shared send_queue so a single sender
    task handles all WebSocket writes (prevents concurrent write races).
    """
    redis = await get_redis()
    pubsub = redis.pubsub()

    topics = [f"channel:{cid}" for cid in channel_ids]
    # Also subscribe to the user's personal DM topic
    topics.append(f"user:{user_id}")

    if topics:
        await pubsub.subscribe(*topics)

    try:
        async for raw in pubsub.listen():
            if raw["type"] == "message":
                try:
                    data = json.loads(raw["data"])
                    await send_queue.put(data)
                except Exception:
                    pass
    except asyncio.CancelledError:
        pass
    finally:
        await pubsub.unsubscribe(*topics)
        await pubsub.aclose()


async def _ws_sender(ws: WebSocket, send_queue: asyncio.Queue) -> None:
    """
    Single writer task: drains the send_queue and writes to the WebSocket.
    Running all sends in one task avoids concurrent-write races on the WS.
    """
    try:
        while True:
            payload = await send_queue.get()
            try:
                await ws.send_json(payload)
            except Exception:
                # WS closed — stop sending
                break
            finally:
                send_queue.task_done()
    except asyncio.CancelledError:
        pass


# ── WebSocket endpoint ────────────────────────────────────────────
@websocket_router.websocket("/ws/{user_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    user_id: uuid.UUID,
    token: str = Query(...),
):
    """
    Main WebSocket endpoint.
    URL: ws://localhost:8000/ws/{user_id}?token=<jwt>

    Lifecycle:
      1. Validate JWT → reject if invalid.
      2. Register connection + set presence = online.
      3. Subscribe to all user's channel topics via Redis pub/sub.
         Messages are queued and sent by a dedicated sender task to
         avoid concurrent WebSocket write races.
      4. Receive client events (heartbeat, typing, etc.).
      5. On disconnect: unregister, set presence = offline, broadcast.
    """
    # 1. Validate JWT
    async with AsyncSessionLocal() as db:
        user = await get_current_user_ws(token, db)
        if not user or str(user.id) != str(user_id):
            await websocket.close(code=4001, reason="Unauthorized")
            return

        # Fetch user's channel memberships
        channels = await get_all_channels(db, user.id)
        member_channel_ids = [str(ch["id"]) for ch in channels if ch["is_member"]]

    # 2. Accept + register
    await websocket.accept()
    uid_str = str(user_id)
    register(uid_str, websocket)

    # Set presence online and broadcast
    await set_user_presence(user_id, "online")
    await broadcast_presence(uid_str, "online", member_channel_ids)

    # 3. Shared queue: subscriber → sender (all WS writes in one task)
    send_queue: asyncio.Queue = asyncio.Queue()

    subscriber_task = asyncio.create_task(
        _redis_subscriber(uid_str, member_channel_ids, send_queue)
    )
    sender_task = asyncio.create_task(
        _ws_sender(websocket, send_queue)
    )

    # Send initial connection ack via the queue so it's serialized too
    await send_queue.put({
        "type": "connected",
        "user_id": uid_str,
        "channels": member_channel_ids,
    })

    # 4. Main receive loop
    try:
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=40.0)
            except asyncio.TimeoutError:
                # Client didn't send heartbeat → close
                break

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            await handle_client_event(msg, uid_str, member_channel_ids, send_queue)

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        # 5. Cleanup
        subscriber_task.cancel()
        sender_task.cancel()
        unregister(uid_str, websocket)
        await set_user_presence(user_id, "offline")
        await broadcast_presence(uid_str, "offline", member_channel_ids)


# ── Client event handler ──────────────────────────────────────────
async def handle_client_event(
    msg: dict,
    user_id: str,
    member_channel_ids: list[str],
    send_queue: asyncio.Queue,
) -> None:
    """Route incoming client WebSocket messages to the right handler."""
    event_type = msg.get("type")

    if event_type == "heartbeat":
        # Refresh presence TTL
        try:
            await refresh_presence(uuid.UUID(user_id))
        except Exception:
            pass
        # Ack back to client
        await send_queue.put({"type": "heartbeat_ack"})

    elif event_type == "typing_start":
        channel_id = msg.get("channel_id")
        dm_user_id = msg.get("dm_user_id")
        if channel_id and channel_id in member_channel_ids:
            redis = await get_redis()
            await redis.publish(f"channel:{channel_id}", json.dumps({
                "type": "typing_start",
                "user_id": user_id,
                "channel_id": channel_id,
            }))
        elif dm_user_id:
            redis = await get_redis()
            await redis.publish(f"user:{dm_user_id}", json.dumps({
                "type": "typing_start",
                "user_id": user_id,
                "is_dm": True,
            }))

    elif event_type == "typing_stop":
        channel_id = msg.get("channel_id")
        dm_user_id = msg.get("dm_user_id")
        if channel_id and channel_id in member_channel_ids:
            redis = await get_redis()
            await redis.publish(f"channel:{channel_id}", json.dumps({
                "type": "typing_stop",
                "user_id": user_id,
                "channel_id": channel_id,
            }))
        elif dm_user_id:
            redis = await get_redis()
            await redis.publish(f"user:{dm_user_id}", json.dumps({
                "type": "typing_stop",
                "user_id": user_id,
                "is_dm": True,
            }))

    elif event_type == "presence_update":
        status = msg.get("status", "online")
        if status in ("online", "away", "offline"):
            try:
                await set_user_presence(uuid.UUID(user_id), status)
                await broadcast_presence(user_id, status, member_channel_ids)
            except Exception:
                pass


# ── Helpers used by REST routers ──────────────────────────────────
async def notify_new_message(channel_id: str, message_data: dict) -> None:
    """Called by messages router after a new message is created."""
    await broadcast_to_channel(channel_id, {
        "type": "new_message",
        "channel_id": channel_id,
        "message": message_data,
    })


async def notify_message_edited(channel_id: str, message_data: dict) -> None:
    await broadcast_to_channel(channel_id, {
        "type": "message_edited",
        "channel_id": channel_id,
        "message": message_data,
    })


async def notify_message_deleted(channel_id: str, message_id: str, parent_id: str | None = None) -> None:
    await broadcast_to_channel(channel_id, {
        "type": "message_deleted",
        "channel_id": channel_id,
        "message_id": message_id,
        "parent_id": parent_id,
    })


async def notify_dm(recipient_user_id: str, message_data: dict) -> None:
    """Push a DM directly to recipient's personal Redis topic."""
    redis = await get_redis()
    await redis.publish(f"user:{recipient_user_id}", json.dumps({
        "type": "new_message",
        "is_dm": True,
        "message": message_data,
    }))


async def notify_dm_edited(recipient_user_id: str, message_data: dict) -> None:
    """Push DM edit directly to recipient's personal Redis topic."""
    redis = await get_redis()
    await redis.publish(f"user:{recipient_user_id}", json.dumps({
        "type": "message_edited",
        "is_dm": True,
        "message": message_data,
    }))


async def notify_dm_deleted(recipient_user_id: str, message_id: str, parent_id: str | None = None) -> None:
    """Push DM delete directly to recipient's personal Redis topic."""
    redis = await get_redis()
    await redis.publish(f"user:{recipient_user_id}", json.dumps({
        "type": "message_deleted",
        "is_dm": True,
        "message_id": message_id,
        "parent_id": parent_id,
    }))


async def notify_ai_response(user_id: str, channel_id: str, summary: dict) -> None:
    """Push AI summary result to requesting user's personal topic."""
    redis = await get_redis()
    await redis.publish(f"user:{user_id}", json.dumps({
        "type": "ai_response",
        "channel_id": channel_id,
        "summary": summary,
    }))


async def notify_shipment_alert(channel_id: str, shipment_data: dict) -> None:
    """Broadcast a shipment alert to a channel."""
    await broadcast_to_channel(channel_id, {
        "type": "shipment_alert",
        "channel_id": channel_id,
        "shipment": shipment_data,
    })
