"""
WebSocket event handlers.

This module provides higher-level helpers that combine DB operations
with WebSocket notifications. REST routers call these after committing
to the DB to trigger real-time fan-out.
"""
import uuid
from sqlalchemy.ext.asyncio import AsyncSession

from app.websocket.manager import (
    notify_new_message,
    notify_message_edited,
    notify_message_deleted,
    notify_dm,
    notify_dm_edited,
    notify_dm_deleted,
    notify_ai_response,
    notify_shipment_alert,
)
from app.schemas.user import UserOut


def _serialize_msg(msg) -> dict:
    """Convert a Message ORM object to a WebSocket-safe dict."""
    return {
        "id": str(msg.id),
        "content": msg.content,
        "sender_id": str(msg.sender_id) if msg.sender_id else None,
        "channel_id": str(msg.channel_id) if msg.channel_id else None,
        "recipient_id": str(msg.recipient_id) if msg.recipient_id else None,
        "parent_id": str(msg.parent_id) if msg.parent_id else None,
        "message_type": msg.message_type,
        "metadata": msg.metadata_ or {},
        "is_edited": msg.is_edited,
        "created_at": msg.created_at.isoformat(),
        "updated_at": msg.updated_at.isoformat(),
        "sender": {
            "id": str(msg.sender.id),
            "username": msg.sender.username,
            "display_name": msg.sender.display_name,
            "avatar_url": msg.sender.avatar_url,
        } if msg.sender else None,
    }


async def on_channel_message_created(channel_id: uuid.UUID, msg) -> None:
    """Called after a new channel message is saved — fans out via WebSocket."""
    await notify_new_message(str(channel_id), _serialize_msg(msg))


async def on_channel_message_edited(channel_id: uuid.UUID, msg) -> None:
    await notify_message_edited(str(channel_id), _serialize_msg(msg))


async def on_channel_message_deleted(channel_id: uuid.UUID, message_id: uuid.UUID) -> None:
    await notify_message_deleted(str(channel_id), str(message_id))


async def on_dm_created(recipient_user_id: uuid.UUID, msg) -> None:
    """Called after a DM is sent — pushes directly to recipient's personal topic."""
    await notify_dm(str(recipient_user_id), _serialize_msg(msg))


async def on_dm_edited(recipient_user_id: uuid.UUID, msg) -> None:
    """Called after a DM is edited — pushes edit to recipient's personal topic."""
    await notify_dm_edited(str(recipient_user_id), _serialize_msg(msg))


async def on_dm_deleted(recipient_user_id: uuid.UUID, message_id: uuid.UUID) -> None:
    """Called after a DM is deleted — pushes delete to recipient's personal topic."""
    await notify_dm_deleted(str(recipient_user_id), str(message_id))


async def on_ai_summary_complete(user_id: uuid.UUID, channel_id: uuid.UUID, summary: dict) -> None:
    """Called when AI summarization finishes — pushes result to requesting user."""
    await notify_ai_response(str(user_id), str(channel_id), summary)


async def on_shipment_flagged(channel_id: uuid.UUID, shipment_data: dict) -> None:
    """Called when a shipment is tagged as flagged — broadcasts alert to channel."""
    await notify_shipment_alert(str(channel_id), shipment_data)
