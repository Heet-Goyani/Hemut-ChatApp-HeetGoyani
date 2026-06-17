import uuid
from datetime import datetime
from pydantic import BaseModel


class ShipmentStatusItem(BaseModel):
    tracking_id: str
    status: str
    note: str


class AISummaryContent(BaseModel):
    tldr: str
    key_topics: list[str]
    shipment_status: list[ShipmentStatusItem]
    action_items: list[str]
    alerts: list[str]


class AISummaryResponse(BaseModel):
    channel_id: str
    summary: AISummaryContent
    generated_at: datetime | None = None
    message_count: int | None = None
    time_window_hours: int | None = None
    source: str = "cache"  # "cache" | "database"
