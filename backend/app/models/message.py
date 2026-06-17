import uuid
from datetime import datetime
from sqlalchemy import String, Text, Boolean, DateTime, ForeignKey, func, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.database import Base


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    sender_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True
    )
    channel_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("channels.id"), nullable=True, index=True
    )
    recipient_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("messages.id"), nullable=True
    )
    message_type: Mapped[str] = mapped_column(
        String(20), default="text"
    )  # 'text' | 'shipment' | 'ai' | 'system'
    metadata_: Mapped[dict] = mapped_column(
        "metadata", JSONB, default=dict, server_default="{}"
    )
    is_edited: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    sender: Mapped["User"] = relationship(  # noqa: F821
        "User", foreign_keys=[sender_id], back_populates="sent_messages"
    )
    recipient: Mapped["User | None"] = relationship(  # noqa: F821
        "User", foreign_keys=[recipient_id]
    )
    channel: Mapped["Channel | None"] = relationship(  # noqa: F821
        "Channel", back_populates="messages"
    )
    replies: Mapped[list["Message"]] = relationship(
        "Message", foreign_keys=[parent_id]
    )

    __table_args__ = (
        Index("idx_messages_channel_id", "channel_id"),
        Index("idx_messages_created_at", "created_at"),
    )
