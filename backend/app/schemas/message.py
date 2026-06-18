import uuid
from datetime import datetime
from pydantic import BaseModel, Field
from app.schemas.user import UserOut


class MessageCreate(BaseModel):
    content: str
    message_type: str = "text"
    metadata: dict = {}
    parent_id: uuid.UUID | None = None


class MessageUpdate(BaseModel):
    content: str


class MessageOut(BaseModel):
    id: uuid.UUID
    content: str
    sender_id: uuid.UUID | None
    channel_id: uuid.UUID | None
    recipient_id: uuid.UUID | None
    parent_id: uuid.UUID | None
    reply_count: int = 0
    message_type: str
    metadata: dict = Field(default={}, validation_alias="metadata_")
    is_edited: bool
    created_at: datetime
    updated_at: datetime
    sender: UserOut | None = None

    model_config = {"from_attributes": True, "populate_by_name": True}


class PaginatedMessages(BaseModel):
    messages: list[MessageOut]
    has_more: bool
    next_cursor: str | None
