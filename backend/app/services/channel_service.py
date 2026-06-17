import uuid
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.channel import Channel
from app.models.membership import Membership
from app.models.user import User


async def get_all_channels(db: AsyncSession, current_user_id: uuid.UUID) -> list[dict]:
    """Return all public channels with member_count and is_member flag."""
    result = await db.execute(
        select(Channel).where(Channel.is_private == False).order_by(Channel.name)  # noqa: E712
    )
    channels = result.scalars().all()

    # Fetch memberships for current user in one query
    membership_result = await db.execute(
        select(Membership.channel_id).where(Membership.user_id == current_user_id)
    )
    user_channel_ids = {row[0] for row in membership_result.all()}

    # Fetch member counts
    count_result = await db.execute(
        select(Membership.channel_id, func.count(Membership.id).label("cnt"))
        .group_by(Membership.channel_id)
    )
    count_map = {row[0]: row[1] for row in count_result.all()}

    return [
        {
            **{col: getattr(ch, col) for col in ["id", "name", "description", "is_private", "created_by", "created_at"]},
            "member_count": count_map.get(ch.id, 0),
            "is_member": ch.id in user_channel_ids,
        }
        for ch in channels
    ]


async def get_channel_by_id(db: AsyncSession, channel_id: uuid.UUID) -> Channel | None:
    result = await db.execute(select(Channel).where(Channel.id == channel_id))
    return result.scalar_one_or_none()


async def get_channel_by_name(db: AsyncSession, name: str) -> Channel | None:
    result = await db.execute(select(Channel).where(Channel.name == name.lower()))
    return result.scalar_one_or_none()


async def create_channel(
    db: AsyncSession, name: str, description: str | None, is_private: bool, created_by: uuid.UUID
) -> Channel:
    channel = Channel(
        name=name.lower(),
        description=description,
        is_private=is_private,
        created_by=created_by,
    )
    db.add(channel)
    await db.flush()

    # Auto-join creator
    membership = Membership(user_id=created_by, channel_id=channel.id)
    db.add(membership)
    await db.commit()
    await db.refresh(channel)
    return channel


async def join_channel(db: AsyncSession, user_id: uuid.UUID, channel_id: uuid.UUID) -> bool:
    """Returns True if joined, False if already a member."""
    existing = await db.execute(
        select(Membership).where(
            and_(Membership.user_id == user_id, Membership.channel_id == channel_id)
        )
    )
    if existing.scalar_one_or_none():
        return False
    membership = Membership(user_id=user_id, channel_id=channel_id)
    db.add(membership)
    await db.commit()
    return True


async def leave_channel(db: AsyncSession, user_id: uuid.UUID, channel_id: uuid.UUID) -> bool:
    """Returns True if left, False if not a member."""
    result = await db.execute(
        select(Membership).where(
            and_(Membership.user_id == user_id, Membership.channel_id == channel_id)
        )
    )
    membership = result.scalar_one_or_none()
    if not membership:
        return False
    await db.delete(membership)
    await db.commit()
    return True


async def get_channel_members(db: AsyncSession, channel_id: uuid.UUID) -> list[User]:
    """Return all users who are members of the channel."""
    result = await db.execute(
        select(User)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.channel_id == channel_id)
        .order_by(User.username)
    )
    return list(result.scalars().all())


async def is_member(db: AsyncSession, user_id: uuid.UUID, channel_id: uuid.UUID) -> bool:
    result = await db.execute(
        select(Membership).where(
            and_(Membership.user_id == user_id, Membership.channel_id == channel_id)
        )
    )
    return result.scalar_one_or_none() is not None
