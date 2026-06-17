"""
Seed script — populates demo data in the database.
Run from backend/ directory: python -m scripts.seed

Creates:
  - 5 demo users (alice, bob, charlie, diana, evan) — password: Demo1234!
  - 7 channels (general, route-east, route-west, warehouse-mumbai,
                warehouse-delhi, dispatch, incidents)
  - All users joined to #general and #dispatch
  - 20 mock shipments with realistic logistics data
  - 15-20 seed messages referencing shipments
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import random

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.config import settings
from app.database import Base
from app.models.user import User
from app.models.channel import Channel
from app.models.membership import Membership
from app.models.message import Message
from app.models.shipment import Shipment
from app.services.auth_service import hash_password

engine = create_async_engine(settings.DATABASE_URL, echo=True)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


DEMO_USERS = [
    {"username": "alice", "email": "alice@hemut-chat.dev", "display_name": "Alice Chen"},
    {"username": "bob", "email": "bob@hemut-chat.dev", "display_name": "Bob Patel"},
    {"username": "charlie", "email": "charlie@hemut-chat.dev", "display_name": "Charlie Okafor"},
    {"username": "diana", "email": "diana@hemut-chat.dev", "display_name": "Diana Müller"},
    {"username": "evan", "email": "evan@hemut-chat.dev", "display_name": "Evan Torres"},
]

DEMO_CHANNELS = [
    {"name": "general", "description": "General announcements and discussions"},
    {"name": "route-east", "description": "East coast shipping routes and updates"},
    {"name": "route-west", "description": "West coast shipping routes and updates"},
    {"name": "warehouse-mumbai", "description": "Mumbai warehouse operations"},
    {"name": "warehouse-delhi", "description": "Delhi warehouse operations"},
    {"name": "dispatch", "description": "Dispatch coordination and scheduling"},
    {"name": "incidents", "description": "Incident reports and emergency communications"},
]

CARRIERS = ["DHL Express", "FedEx Freight", "Maersk Line", "UPS Freight", "DTDC", "Blue Dart"]
STATUSES = ["in_transit", "delayed", "delivered", "pending"]
ORIGINS = ["Mumbai", "Delhi", "Chennai", "Kolkata", "Dubai", "Singapore", "Rotterdam"]
DESTINATIONS = ["Rotterdam", "Los Angeles", "New York", "London", "Dubai", "Singapore", "Sydney"]
CONTENTS_LIST = [
    "Electronic Components", "Automotive Parts", "Pharmaceutical Supplies",
    "Textile Products", "Food Grade Materials", "Industrial Equipment",
    "Medical Devices", "Chemical Raw Materials", "Consumer Electronics",
    "Agricultural Products",
]

now = datetime.now(timezone.utc)

SEED_MESSAGES = [
    ("general", "alice", "Good morning team! Quick reminder: all shipments flagged as DELAYED need to be reviewed by EOD."),
    ("route-east", "bob", "Update on SHIP-2024-001: shipment cleared Dubai customs, now in transit to Rotterdam. ETA Jan 20."),
    ("route-east", "charlie", "Anyone have visibility on SHIP-2024-003? DHL hasn't updated the tracker in 48 hours."),
    ("route-east", "diana", "SHIP-2024-003 is stuck at Singapore port due to documentation issues. I'm on it."),
    ("route-west", "evan", "SHIP-2024-007 arrived at LA port ahead of schedule. Warehouse team notified."),
    ("warehouse-mumbai", "alice", "Capacity at Mumbai is at 87%. We need to move SHIP-2024-012 out by Thursday."),
    ("warehouse-mumbai", "bob", "Confirmed — SHIP-2024-012 loading scheduled for Wednesday morning."),
    ("warehouse-delhi", "charlie", "Delhi warehouse received SHIP-2024-015 today. All items checked, no damage reported."),
    ("dispatch", "diana", "Dispatch schedule for this week: SHIP-2024-017, SHIP-2024-018, SHIP-2024-019 going out Monday."),
    ("dispatch", "evan", "Carrier for SHIP-2024-017 confirmed as DHL Express. Pickup at 0900."),
    ("incidents", "alice", "⚠️ INCIDENT: SHIP-2024-005 — temperature breach detected in refrigerated container. Contents at risk."),
    ("incidents", "bob", "On it. Contacting carrier now for SHIP-2024-005. Emergency rerouting to nearest cold storage."),
    ("route-east", "charlie", "SHIP-2024-001 — Just spoke to Rotterdam port, they're ready to receive. No delays expected."),
    ("general", "diana", "Reminder: please tag shipment IDs in your messages so the AI can track them properly."),
    ("dispatch", "evan", "SHIP-2024-020 paperwork complete. Ready for dispatch tomorrow."),
    ("route-west", "alice", "Weather alert: Storm system approaching LA. SHIP-2024-008 and SHIP-2024-009 may be delayed."),
    ("warehouse-mumbai", "bob", "SHIP-2024-002 unloaded successfully. QC check passed. Moving to storage bay 4."),
    ("incidents", "charlie", "Update on SHIP-2024-005: carrier has arranged emergency cold storage. Contents salvaged."),
    ("general", "diana", "Weekly summary: 12 shipments delivered on time, 3 delayed, 1 incident resolved. Good week overall."),
    ("route-east", "evan", "New shipment SHIP-2024-004 added to route-east. Origin: Singapore, Destination: Rotterdam. Dep. Jan 18."),
]


async def seed():
    print("Creating database tables...")
    async with engine.begin() as conn:
        from app.models import user, channel, message, shipment, membership, ai_summary  # noqa
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        print("Seeding users...")
        user_map: dict[str, User] = {}
        for u in DEMO_USERS:
            user = User(
                username=u["username"],
                email=u["email"],
                display_name=u["display_name"],
                hashed_password=hash_password("Demo1234!"),
            )
            db.add(user)
            await db.flush()
            user_map[u["username"]] = user

        print("Seeding channels...")
        channel_map: dict[str, Channel] = {}
        for c in DEMO_CHANNELS:
            channel = Channel(
                name=c["name"],
                description=c["description"],
                created_by=user_map["alice"].id,
            )
            db.add(channel)
            await db.flush()
            channel_map[c["name"]] = channel

        print("Joining users to #general and #dispatch...")
        for username, user in user_map.items():
            for ch_name in ["general", "dispatch"]:
                membership = Membership(user_id=user.id, channel_id=channel_map[ch_name].id)
                db.add(membership)

        # Join channel creators to their channels too
        for ch_name, channel in channel_map.items():
            if ch_name not in ["general", "dispatch"]:
                for username in ["alice", "bob", "charlie", "diana", "evan"]:
                    m = Membership(user_id=user_map[username].id, channel_id=channel.id)
                    db.add(m)

        print("Seeding 20 shipments...")
        for i in range(1, 21):
            tracking_id = f"SHIP-2024-{i:03d}"
            status = STATUSES[i % len(STATUSES)]
            eta_days = random.randint(-5, 30)
            shipment = Shipment(
                tracking_id=tracking_id,
                po_number=f"PO-{2024000 + i}",
                origin=ORIGINS[i % len(ORIGINS)],
                destination=DESTINATIONS[(i + 2) % len(DESTINATIONS)],
                carrier=CARRIERS[i % len(CARRIERS)],
                status=status,
                eta=now + timedelta(days=eta_days),
                weight_kg=Decimal(str(round(random.uniform(100, 5000), 2))),
                contents=CONTENTS_LIST[i % len(CONTENTS_LIST)],
                flagged=(status == "delayed" and i % 3 == 0),
                notes=f"Standard logistics handling. Priority: {'HIGH' if i % 5 == 0 else 'NORMAL'}",
            )
            db.add(shipment)

        print("Seeding messages...")
        for idx, (ch_name, username, content) in enumerate(SEED_MESSAGES):
            msg = Message(
                content=content,
                sender_id=user_map[username].id,
                channel_id=channel_map[ch_name].id,
                message_type="text",
                created_at=now - timedelta(hours=len(SEED_MESSAGES) - idx),
            )
            db.add(msg)

        await db.commit()
        print("Seed complete!")


if __name__ == "__main__":
    asyncio.run(seed())
