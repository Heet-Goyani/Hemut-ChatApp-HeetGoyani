import re
import uuid
from datetime import datetime, timezone
from sqlalchemy import select, and_, or_, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.message import Message
from app.models.user import User

TRACKING_ID_PATTERN = re.compile(r"SHIP-\d{4}-\d{3}")


def extract_tracking_ids(texts: list[str]) -> list[str]:
    """Extract all unique SHIP-YYYY-NNN tracking IDs from a list of text."""
    found = set()
    for text in texts:
        found.update(TRACKING_ID_PATTERN.findall(text))
    return list(found)


async def get_channel_messages(
    db: AsyncSession,
    channel_id: uuid.UUID,
    limit: int = 50,
    before: datetime | None = None,
) -> tuple[list[Message], bool]:
    """Fetch paginated messages for a channel. Returns (messages, has_more)."""
    query = (
        select(Message)
        .options(selectinload(Message.sender))
        .where(Message.channel_id == channel_id)
        .order_by(desc(Message.created_at))
        .limit(limit + 1)
    )
    if before:
        query = query.where(Message.created_at < before)

    result = await db.execute(query)
    rows = result.scalars().all()

    has_more = len(rows) > limit
    messages = list(reversed(rows[:limit]))  # oldest first for display
    return messages, has_more


async def create_channel_message(
    db: AsyncSession,
    content: str,
    sender_id: uuid.UUID,
    channel_id: uuid.UUID,
    message_type: str = "text",
    metadata: dict | None = None,
) -> Message:
    msg = Message(
        content=content,
        sender_id=sender_id,
        channel_id=channel_id,
        message_type=message_type,
        metadata_=metadata or {},
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    # Reload with sender
    result = await db.execute(
        select(Message).options(selectinload(Message.sender)).where(Message.id == msg.id)
    )
    return result.scalar_one()


async def get_message_by_id(db: AsyncSession, message_id: uuid.UUID) -> Message | None:
    result = await db.execute(
        select(Message).options(selectinload(Message.sender)).where(Message.id == message_id)
    )
    return result.scalar_one_or_none()


async def edit_message(
    db: AsyncSession, message_id: uuid.UUID, sender_id: uuid.UUID, new_content: str
) -> Message | None:
    msg = await get_message_by_id(db, message_id)
    if not msg or msg.sender_id != sender_id:
        return None
    msg.content = new_content
    msg.is_edited = True
    await db.commit()
    await db.refresh(msg)
    return msg


async def delete_message(
    db: AsyncSession, message_id: uuid.UUID, sender_id: uuid.UUID
) -> bool:
    msg = await get_message_by_id(db, message_id)
    if not msg or msg.sender_id != sender_id:
        return False
    await db.delete(msg)
    await db.commit()
    return True


# ── DM helpers ─────────────────────────────────────────────────────

async def create_dm_message(
    db: AsyncSession,
    content: str,
    sender_id: uuid.UUID,
    recipient_id: uuid.UUID,
) -> Message:
    msg = Message(
        content=content,
        sender_id=sender_id,
        recipient_id=recipient_id,
        channel_id=None,
        message_type="text",
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    result = await db.execute(
        select(Message).options(selectinload(Message.sender)).where(Message.id == msg.id)
    )
    return result.scalar_one()


async def get_dm_history(
    db: AsyncSession,
    user_a: uuid.UUID,
    user_b: uuid.UUID,
    limit: int = 50,
    before: datetime | None = None,
) -> tuple[list[Message], bool]:
    """Get DM history between two users."""
    query = (
        select(Message)
        .options(selectinload(Message.sender))
        .where(
            and_(
                Message.channel_id == None,  # noqa: E711
                or_(
                    and_(Message.sender_id == user_a, Message.recipient_id == user_b),
                    and_(Message.sender_id == user_b, Message.recipient_id == user_a),
                ),
            )
        )
        .order_by(desc(Message.created_at))
        .limit(limit + 1)
    )
    if before:
        query = query.where(Message.created_at < before)

    result = await db.execute(query)
    rows = result.scalars().all()
    has_more = len(rows) > limit
    messages = list(reversed(rows[:limit]))
    return messages, has_more


async def get_dm_conversations(
    db: AsyncSession, user_id: uuid.UUID
) -> list[dict]:
    """
    Get all DM conversations for a user:
    returns a list of {user, last_message} pairs.
    """
    # Get all DM messages where user is sender or recipient
    result = await db.execute(
        select(Message)
        .options(selectinload(Message.sender), selectinload(Message.recipient))
        .where(
            and_(
                Message.channel_id == None,  # noqa: E711
                or_(Message.sender_id == user_id, Message.recipient_id == user_id),
            )
        )
        .order_by(desc(Message.created_at))
    )
    all_msgs = result.scalars().all()

    seen_users: dict[uuid.UUID, dict] = {}
    for msg in all_msgs:
        other_id = msg.recipient_id if msg.sender_id == user_id else msg.sender_id
        if other_id and other_id not in seen_users:
            other_user = msg.recipient if msg.sender_id == user_id else msg.sender
            seen_users[other_id] = {
                "user_id": other_id,
                "user": other_user,
                "last_message": msg,
            }

    return list(seen_users.values())
