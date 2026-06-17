import uuid
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth_middleware import get_current_user
from app.models.user import User
from app.services.auth_service import get_user_by_id
from app.services.channel_service import get_channel_by_id, get_channel_members, get_all_channels
from app.services.presence_service import (
    get_user_presence,
    set_user_presence,
    get_bulk_presence,
)
from app.websocket.manager import broadcast_presence

router = APIRouter()


class StatusUpdate(BaseModel):
    status: str  # online | away | offline


@router.put("/status", response_model=dict)
async def update_status(
    payload: StatusUpdate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Set own presence status and broadcast to all joined channels."""
    if payload.status not in ("online", "away", "offline"):
        raise HTTPException(status_code=400, detail="Status must be 'online', 'away', or 'offline'")

    await set_user_presence(current_user.id, payload.status)

    # Broadcast presence change to all channels the user is a member of
    channels = await get_all_channels(db, current_user.id)
    member_channel_ids = [str(ch["id"]) for ch in channels if ch["is_member"]]
    background_tasks.add_task(
        broadcast_presence, str(current_user.id), payload.status, member_channel_ids
    )

    return {"status": payload.status}


@router.get("/status/{user_id}", response_model=dict)
async def get_status(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get presence status for any user."""
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    presence = await get_user_presence(user_id)
    return {"user_id": str(user_id), "status": presence}


@router.get("/channel/{channel_id}", response_model=list[dict])
async def get_channel_presence(
    channel_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get presence status for all members of a channel."""
    channel = await get_channel_by_id(db, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    members = await get_channel_members(db, channel_id)
    presence_map = await get_bulk_presence([m.id for m in members])

    return [
        {
            "user_id": str(m.id),
            "username": m.username,
            "display_name": m.display_name,
            "avatar_url": m.avatar_url,
            "status": presence_map.get(str(m.id), "offline"),
        }
        for m in members
    ]
