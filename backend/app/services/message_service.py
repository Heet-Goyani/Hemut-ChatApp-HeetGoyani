import re
import uuid
from datetime import datetime, timezone
from sqlalchemy import select, and_, or_, desc, func
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
        .where(Message.parent_id == None)  # noqa: E711
        .order_by(desc(Message.created_at))
        .limit(limit + 1)
    )
    if before:
        query = query.where(Message.created_at < before)

    result = await db.execute(query)
    rows = result.scalars().all()

    has_more = len(rows) > limit
    messages = list(reversed(rows[:limit]))  # oldest first for display
    await attach_reply_counts(db, messages)
    return messages, has_more


async def create_channel_message(
    db: AsyncSession,
    content: str,
    sender_id: uuid.UUID,
    channel_id: uuid.UUID,
    message_type: str = "text",
    metadata: dict | None = None,
    parent_id: uuid.UUID | None = None,
) -> Message:
    msg = Message(
        content=content,
        sender_id=sender_id,
        channel_id=channel_id,
        message_type=message_type,
        metadata_=metadata or {},
        parent_id=parent_id,
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
    msg = result.scalar_one_or_none()
    if msg:
        await attach_reply_counts(db, [msg])
    return msg


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
    message_type: str = "text",
    metadata: dict | None = None,
    parent_id: uuid.UUID | None = None,
) -> Message:
    msg = Message(
        content=content,
        sender_id=sender_id,
        recipient_id=recipient_id,
        channel_id=None,
        message_type=message_type,
        metadata_=metadata or {},
        parent_id=parent_id,
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
                Message.parent_id == None,  # noqa: E711
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
    await attach_reply_counts(db, messages)
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


async def search_messages(
    db: AsyncSession,
    user_id: uuid.UUID,
    q: str,
    channel_id: uuid.UUID | None = None,
    dm_user_id: uuid.UUID | None = None,
    limit: int = 50,
) -> list[Message]:
    """Search messages containing query term, restricted to user's membership scope."""
    from app.models.membership import Membership

    if channel_id:
        # Check membership of the target channel
        member_check = await db.execute(
            select(Membership).where(
                Membership.user_id == user_id,
                Membership.channel_id == channel_id
            )
        )
        if not member_check.scalar_one_or_none():
            return []

        query = (
            select(Message)
            .options(selectinload(Message.sender))
            .where(
                Message.channel_id == channel_id,
                Message.content.ilike(f"%{q}%")
            )
            .order_by(desc(Message.created_at))
            .limit(limit)
        )
    elif dm_user_id:
        # Search specifically in a 1:1 DM thread
        query = (
            select(Message)
            .options(selectinload(Message.sender))
            .where(
                and_(
                    Message.channel_id == None,  # noqa: E711
                    or_(
                        and_(Message.sender_id == user_id, Message.recipient_id == dm_user_id),
                        and_(Message.sender_id == dm_user_id, Message.recipient_id == user_id)
                    ),
                    Message.content.ilike(f"%{q}%")
                )
            )
            .order_by(desc(Message.created_at))
            .limit(limit)
        )
    else:
        # Global search: channels user belongs to OR personal DMs
        channels_query = await db.execute(
            select(Membership.channel_id).where(Membership.user_id == user_id)
        )
        joined_channel_ids = [row[0] for row in channels_query.all()]

        query = (
            select(Message)
            .options(selectinload(Message.sender))
            .where(
                and_(
                    or_(
                        Message.channel_id.in_(joined_channel_ids),
                        Message.sender_id == user_id,
                        Message.recipient_id == user_id
                    ),
                    Message.content.ilike(f"%{q}%")
                )
            )
            .order_by(desc(Message.created_at))
            .limit(limit)
        )

    result = await db.execute(query)
    # Return sorted by created_at ascending or descending?
    # Usually history is oldest-first for chat logs, but search is newest-first. Let's return reversed oldest-first.
    rows = result.scalars().all()
    messages = list(reversed(rows))
    await attach_reply_counts(db, messages)
    return messages


async def attach_reply_counts(db: AsyncSession, messages: list[Message]) -> None:
    """Fetch reply count for a list of messages and attach it dynamically as an attribute."""
    if not messages:
        return
    msg_ids = [msg.id for msg in messages]
    query = (
        select(Message.parent_id, func.count(Message.id))
        .where(Message.parent_id.in_(msg_ids))
        .group_by(Message.parent_id)
    )
    result = await db.execute(query)
    counts = {parent_id: count for parent_id, count in result.all()}
    for msg in messages:
        msg.reply_count = counts.get(msg.id, 0)


async def get_message_replies(db: AsyncSession, message_id: uuid.UUID) -> list[Message]:
    """Fetch all replies in a thread ordered by created_at ascending."""
    result = await db.execute(
        select(Message)
        .options(selectinload(Message.sender))
        .where(Message.parent_id == message_id)
        .order_by(Message.created_at)
    )
    return list(result.scalars().all())

