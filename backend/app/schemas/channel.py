import uuid
from datetime import datetime
from pydantic import BaseModel, field_validator


class ChannelCreate(BaseModel):
    name: str
    description: str | None = None
    is_private: bool = False

    @field_validator("name")
    @classmethod
    def name_valid(cls, v: str) -> str:
        v = v.lower().replace(" ", "-")
        if len(v) < 2 or len(v) > 100:
            raise ValueError("Channel name must be 2–100 characters")
        return v


class ChannelOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    is_private: bool
    created_by: uuid.UUID | None
    created_at: datetime
    member_count: int = 0
    is_member: bool = False
    last_read_at: datetime | None = None

    model_config = {"from_attributes": True}


class MemberOut(BaseModel):
    id: uuid.UUID
    username: str
    display_name: str | None
    avatar_url: str | None
    presence: str = "offline"  # online | away | offline

    model_config = {"from_attributes": True}
