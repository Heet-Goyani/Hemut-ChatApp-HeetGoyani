import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth_middleware import get_current_user
from app.models.user import User
from app.schemas.message import MessageCreate, MessageOut, PaginatedMessages
from app.services import message_service
from app.services.auth_service import get_user_by_id
from app.websocket.handlers import on_dm_created

router = APIRouter()


def _serialize_message(msg) -> MessageOut:
    return MessageOut.model_validate(msg)


@router.get("/conversations", response_model=list[dict])
async def list_conversations(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all DM conversations with last message preview."""
    conversations = await message_service.get_dm_conversations(db, current_user.id)
    result = []
    for conv in conversations:
        user = conv["user"]
        last_msg = conv["last_message"]
        result.append({
            "user_id": str(conv["user_id"]),
            "user": {
                "id": str(user.id),
                "username": user.username,
                "display_name": user.display_name,
                "avatar_url": user.avatar_url,
            },
            "last_message": {
                "content": last_msg.content[:100],
                "created_at": last_msg.created_at.isoformat(),
            },
        })
    return result


@router.get("/{user_id}", response_model=PaginatedMessages)
async def get_dm_history(
    user_id: uuid.UUID,
    before: Optional[datetime] = None,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get paginated DM history with another user."""
    other_user = await get_user_by_id(db, user_id)
    if not other_user:
        raise HTTPException(status_code=404, detail="User not found")

    limit = min(limit, 100)
    messages, has_more = await message_service.get_dm_history(
        db, current_user.id, user_id, limit, before
    )
    next_cursor = messages[0].created_at.isoformat() if has_more and messages else None
    return PaginatedMessages(
        messages=[_serialize_message(m) for m in messages],
        has_more=has_more,
        next_cursor=next_cursor,
    )


@router.post("/{user_id}", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
async def send_dm(
    user_id: uuid.UUID,
    payload: MessageCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Send a direct message to another user."""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot send DM to yourself")

    other_user = await get_user_by_id(db, user_id)
    if not other_user:
        raise HTTPException(status_code=404, detail="User not found")

    content = payload.content.strip()
    msg_type = "text"
    metadata = {}

    if payload.parent_id:
        parent_msg = await message_service.get_message_by_id(db, payload.parent_id)
        if not parent_msg:
            raise HTTPException(status_code=404, detail="Parent message not found")
        is_dm_match = (
            parent_msg.channel_id is None and
            ((parent_msg.sender_id == current_user.id and parent_msg.recipient_id == user_id) or
             (parent_msg.sender_id == user_id and parent_msg.recipient_id == current_user.id))
        )
        if not is_dm_match:
            raise HTTPException(status_code=400, detail="Parent message does not belong to this DM thread")
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

    msg = await message_service.create_dm_message(
        db,
        content=content,
        sender_id=current_user.id,
        recipient_id=user_id,
        message_type=msg_type,
        metadata=metadata,
        parent_id=payload.parent_id,
    )

    # Push to recipient's personal WebSocket topic
    background_tasks.add_task(on_dm_created, user_id, msg)

    return _serialize_message(msg)
