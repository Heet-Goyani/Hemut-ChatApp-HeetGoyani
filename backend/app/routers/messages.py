import uuid
from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.middleware.auth_middleware import get_current_user
from app.models.user import User
from app.schemas.message import MessageCreate, MessageOut, MessageUpdate, PaginatedMessages
from app.services import message_service
from app.services.channel_service import get_channel_by_id, is_member
from app.websocket.handlers import (
    on_channel_message_created,
    on_channel_message_edited,
    on_channel_message_deleted,
    on_dm_edited,
    on_dm_deleted,
)

router = APIRouter()


def _serialize_message(msg) -> MessageOut:
    return MessageOut.model_validate(msg)


async def _fire_webhook(tracking_id: str, channel_name: str, sender: str, preview: str):
    """Fire shipment webhook as a background task — never blocks message delivery."""
    if not settings.WEBHOOK_URL:
        return
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(settings.WEBHOOK_URL, json={
                "event": "shipment_tagged",
                "tracking_id": tracking_id,
                "channel": channel_name,
                "sender": sender,
                "message_preview": preview[:200],
                "timestamp": datetime.utcnow().isoformat() + "Z",
            })
    except Exception:
        pass


@router.get("/search", response_model=list[MessageOut])
async def search_messages(
    q: str,
    channel_id: Optional[uuid.UUID] = None,
    dm_user_id: Optional[uuid.UUID] = None,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Search for messages containing the query string, matching user's access scope."""
    if not q.strip():
        return []
    messages = await message_service.search_messages(
        db,
        user_id=current_user.id,
        q=q.strip(),
        channel_id=channel_id,
        dm_user_id=dm_user_id,
        limit=limit,
    )
    return [_serialize_message(m) for m in messages]


@router.get("/channel/{channel_id}", response_model=PaginatedMessages)
async def get_channel_messages(
    channel_id: uuid.UUID,
    before: Optional[datetime] = None,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    channel = await get_channel_by_id(db, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    limit = min(limit, 100)
    messages, has_more = await message_service.get_channel_messages(db, channel_id, limit, before)
    next_cursor = messages[0].created_at.isoformat() if has_more and messages else None
    return PaginatedMessages(
        messages=[_serialize_message(m) for m in messages],
        has_more=has_more,
        next_cursor=next_cursor,
    )


@router.post("/channel/{channel_id}", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
async def post_message(
    channel_id: uuid.UUID,
    payload: MessageCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    channel = await get_channel_by_id(db, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    if not await is_member(db, current_user.id, channel_id):
        raise HTTPException(status_code=403, detail="You are not a member of this channel")

    content = payload.content.strip()
    msg_type = payload.message_type
    metadata = payload.metadata or {}

    if payload.parent_id:
        parent_msg = await message_service.get_message_by_id(db, payload.parent_id)
        if not parent_msg:
            raise HTTPException(status_code=404, detail="Parent message not found")
        if parent_msg.channel_id != channel_id:
            raise HTTPException(status_code=400, detail="Parent message does not belong to this channel")
        if parent_msg.parent_id is not None:
            raise HTTPException(status_code=400, detail="Cannot reply to a thread reply message")

    # Check for slash command
    if content.startswith("/shipment "):
        parts = content.split()
        if len(parts) >= 2:
            tracking_id = parts[1].upper()
            from sqlalchemy import select
            from app.models.shipment import Shipment
            ship_result = await db.execute(select(Shipment).where(Shipment.tracking_id == tracking_id))
            shipment = ship_result.scalar_one_or_none()
            if shipment:
                msg_type = "shipment"
                metadata["shipment"] = {
                    "id": str(shipment.id),
                    "tracking_id": shipment.tracking_id,
                    "po_number": shipment.po_number,
                    "origin": shipment.origin,
                    "destination": shipment.destination,
                    "carrier": shipment.carrier,
                    "status": shipment.status,
                    "eta": shipment.eta.isoformat() if shipment.eta else None,
                    "flagged": shipment.flagged,
                    "contents": shipment.contents,
                }
            else:
                content = f"⚠️ Error: Shipment '{tracking_id}' not found."
                msg_type = "system"

    msg = await message_service.create_channel_message(
        db,
        content=content,
        sender_id=current_user.id,
        channel_id=channel_id,
        message_type=msg_type,
        metadata=metadata,
        parent_id=payload.parent_id,
    )

    # Fan out via WebSocket (background to not block HTTP response)
    background_tasks.add_task(on_channel_message_created, channel_id, msg)

    # Webhook for tracking IDs
    tracking_ids = message_service.extract_tracking_ids([payload.content])
    for tid in tracking_ids:
        background_tasks.add_task(
            _fire_webhook, tid, channel.name, current_user.username, payload.content
        )

    return _serialize_message(msg)


@router.put("/{message_id}", response_model=MessageOut)
async def edit_message(
    message_id: uuid.UUID,
    payload: MessageUpdate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    msg = await message_service.edit_message(db, message_id, current_user.id, payload.content)
    if not msg:
        raise HTTPException(
            status_code=404,
            detail="Message not found or you don't have permission to edit it",
        )
    if msg.channel_id:
        background_tasks.add_task(on_channel_message_edited, msg.channel_id, msg)
    elif msg.recipient_id:
        background_tasks.add_task(on_dm_edited, msg.recipient_id, msg)
    return _serialize_message(msg)


@router.delete("/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(
    message_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Fetch first so we can broadcast the channel_id
    msg = await message_service.get_message_by_id(db, message_id)
    if not msg or msg.sender_id != current_user.id:
        raise HTTPException(
            status_code=404,
            detail="Message not found or you don't have permission to delete it",
        )
    channel_id = msg.channel_id
    recipient_id = msg.recipient_id
    parent_id = msg.parent_id
    deleted = await message_service.delete_message(db, message_id, current_user.id)
    if deleted:
        if channel_id:
            background_tasks.add_task(on_channel_message_deleted, channel_id, message_id, parent_id)
        elif recipient_id:
            background_tasks.add_task(on_dm_deleted, recipient_id, message_id, parent_id)


@router.get("/{message_id}", response_model=MessageOut)
async def get_message(
    message_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    msg = await message_service.get_message_by_id(db, message_id)
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    if msg.channel_id:
        if not await is_member(db, current_user.id, msg.channel_id):
            raise HTTPException(status_code=403, detail="You do not have access to this channel")
    elif msg.recipient_id:
        if current_user.id not in (msg.sender_id, msg.recipient_id):
            raise HTTPException(status_code=403, detail="You do not have access to this DM")

    return _serialize_message(msg)


@router.get("/{message_id}/replies", response_model=list[MessageOut])
async def get_message_replies(
    message_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    msg = await message_service.get_message_by_id(db, message_id)
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    if msg.channel_id:
        if not await is_member(db, current_user.id, msg.channel_id):
            raise HTTPException(status_code=403, detail="You do not have access to this channel")
    elif msg.recipient_id:
        if current_user.id not in (msg.sender_id, msg.recipient_id):
            raise HTTPException(status_code=403, detail="You do not have access to this DM")

    replies = await message_service.get_message_replies(db, message_id)
    return [_serialize_message(r) for r in replies]
