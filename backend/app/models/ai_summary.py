import uuid
from datetime import datetime
from sqlalchemy import Text, Integer, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class AISummary(Base):
    __tablename__ = "ai_summaries"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    channel_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("channels.id"), nullable=True, index=True
    )
    summary_text: Mapped[str] = mapped_column(Text, nullable=False)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    message_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    time_window_hours: Mapped[int] = mapped_column(Integer, default=24)

    # Relationships
    channel: Mapped["Channel | None"] = relationship(  # noqa: F821
        "Channel", back_populates="ai_summaries"
    )
