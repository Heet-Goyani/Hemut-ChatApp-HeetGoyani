import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth_middleware import get_current_user
from app.models.shipment import Shipment
from app.models.user import User
from app.schemas.shipment import ShipmentOut

router = APIRouter()


@router.get("/", response_model=list[ShipmentOut])
async def list_shipments(
    status: str | None = None,
    flagged: bool | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all shipments with optional status/flagged filters."""
    query = select(Shipment).order_by(Shipment.created_at.desc())
    if status:
        query = query.where(Shipment.status == status)
    if flagged is not None:
        query = query.where(Shipment.flagged == flagged)

    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{tracking_id}", response_model=ShipmentOut)
async def get_shipment(
    tracking_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a shipment by tracking ID (e.g. SHIP-2024-001)."""
    result = await db.execute(
        select(Shipment).where(Shipment.tracking_id == tracking_id.upper())
    )
    shipment = result.scalar_one_or_none()
    if not shipment:
        raise HTTPException(status_code=404, detail=f"Shipment '{tracking_id}' not found")
    return shipment


@router.post("/seed", response_model=dict, status_code=status.HTTP_201_CREATED)
async def seed_shipments(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Seed 20 mock shipments (dev only). Safe to call multiple times — skips existing."""
    from datetime import datetime, timedelta, timezone
    from decimal import Decimal
    import random

    now = datetime.now(timezone.utc)
    carriers = ["DHL Express", "FedEx Freight", "Maersk Line", "UPS Freight", "DTDC", "Blue Dart"]
    statuses = ["in_transit", "delayed", "delivered", "pending"]
    origins = ["Mumbai", "Delhi", "Chennai", "Kolkata", "Dubai", "Singapore", "Rotterdam"]
    destinations = ["Rotterdam", "Los Angeles", "New York", "London", "Dubai", "Singapore", "Sydney"]
    contents_list = [
        "Electronic Components", "Automotive Parts", "Pharmaceutical Supplies",
        "Textile Products", "Food Grade Materials", "Industrial Equipment",
        "Medical Devices", "Chemical Raw Materials", "Consumer Electronics", "Agricultural Products",
    ]

    seeded = 0
    for i in range(1, 21):
        tracking_id = f"SHIP-2024-{i:03d}"
        existing = await db.execute(
            select(Shipment).where(Shipment.tracking_id == tracking_id)
        )
        if existing.scalar_one_or_none():
            continue

        shipment = Shipment(
            tracking_id=tracking_id,
            po_number=f"PO-{2024000 + i}",
            origin=origins[i % len(origins)],
            destination=destinations[(i + 2) % len(destinations)],
            carrier=carriers[i % len(carriers)],
            status=statuses[i % len(statuses)],
            eta=now + timedelta(days=random.randint(-5, 30)),
            weight_kg=Decimal(str(round(random.uniform(100, 5000), 2))),
            contents=contents_list[i % len(contents_list)],
            flagged=(statuses[i % len(statuses)] == "delayed" and i % 3 == 0),
            notes=f"Priority: {'HIGH' if i % 5 == 0 else 'NORMAL'}",
        )
        db.add(shipment)
        seeded += 1

    await db.commit()
    return {"message": f"Seeded {seeded} shipments", "total": 20}
