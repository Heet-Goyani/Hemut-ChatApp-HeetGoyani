import uuid
from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel


class ShipmentOut(BaseModel):
    id: uuid.UUID
    tracking_id: str
    po_number: str | None
    origin: str | None
    destination: str | None
    carrier: str | None
    status: str | None
    eta: datetime | None
    weight_kg: Decimal | None
    contents: str | None
    flagged: bool
    notes: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ShipmentCreate(BaseModel):
    tracking_id: str
    po_number: str | None = None
    origin: str | None = None
    destination: str | None = None
    carrier: str | None = None
    status: str | None = None
    eta: datetime | None = None
    weight_kg: Decimal | None = None
    contents: str | None = None
    flagged: bool = False
    notes: str | None = None
