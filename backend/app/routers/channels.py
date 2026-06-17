import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth_middleware import get_current_user
from app.models.user import User
from app.schemas.channel import ChannelCreate, ChannelOut, MemberOut
from app.schemas.user import UserOut
from app.services import channel_service
from app.services.presence_service import get_user_presence

router = APIRouter()


@router.get("/", response_model=list[ChannelOut])
async def list_channels(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all public channels with joined status and member count."""
    channels = await channel_service.get_all_channels(db, current_user.id)
    return [ChannelOut(**ch) for ch in channels]


@router.post("/", response_model=ChannelOut, status_code=status.HTTP_201_CREATED)
async def create_channel(
    payload: ChannelCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    existing = await channel_service.get_channel_by_name(db, payload.name)
    if existing:
        raise HTTPException(status_code=409, detail="Channel name already exists")

    channel = await channel_service.create_channel(
        db,
        name=payload.name,
        description=payload.description,
        is_private=payload.is_private,
        created_by=current_user.id,
    )
    return ChannelOut(
        id=channel.id,
        name=channel.name,
        description=channel.description,
        is_private=channel.is_private,
        created_by=channel.created_by,
        created_at=channel.created_at,
        member_count=1,
        is_member=True,
    )


@router.get("/{channel_id}", response_model=ChannelOut)
async def get_channel(
    channel_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    channel = await channel_service.get_channel_by_id(db, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    members = await channel_service.get_channel_members(db, channel_id)
    is_member = await channel_service.is_member(db, current_user.id, channel_id)

    return ChannelOut(
        id=channel.id,
        name=channel.name,
        description=channel.description,
        is_private=channel.is_private,
        created_by=channel.created_by,
        created_at=channel.created_at,
        member_count=len(members),
        is_member=is_member,
    )


@router.post("/{channel_id}/join", response_model=dict)
async def join_channel(
    channel_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    channel = await channel_service.get_channel_by_id(db, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    if channel.is_private:
        raise HTTPException(status_code=403, detail="Cannot join private channel without invite")

    joined = await channel_service.join_channel(db, current_user.id, channel_id)
    if not joined:
        return {"message": "Already a member"}
    return {"message": "Joined successfully"}


@router.delete("/{channel_id}/leave", response_model=dict)
async def leave_channel(
    channel_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    channel = await channel_service.get_channel_by_id(db, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    left = await channel_service.leave_channel(db, current_user.id, channel_id)
    if not left:
        raise HTTPException(status_code=400, detail="Not a member of this channel")
    return {"message": "Left successfully"}


@router.get("/{channel_id}/members", response_model=list[MemberOut])
async def get_members(
    channel_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    channel = await channel_service.get_channel_by_id(db, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    members = await channel_service.get_channel_members(db, channel_id)

    result = []
    for member in members:
        presence = await get_user_presence(member.id)
        result.append(MemberOut(
            id=member.id,
            username=member.username,
            display_name=member.display_name,
            avatar_url=member.avatar_url,
            presence=presence,
        ))
    return result
