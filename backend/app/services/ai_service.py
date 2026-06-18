"""
AI Service — "Catch Me Up" Channel Summarization

Flow:
  1. Fetch the last N hours of messages from a channel (PostgreSQL).
  2. Extract any tracking IDs and fetch matching shipment records.
  3. Format messages + shipments into a structured prompt.
  4. Call Claude API (claude-sonnet-4-6) with a logistics-specialist system prompt.
  5. Parse and validate the JSON response against the expected schema.
  6. Cache result in:
     - Redis: key ai_summary:{channel_id} with 1h TTL (fast re-fetch)
     - PostgreSQL: ai_summaries table (audit trail / history)
  7. Push the result to the requesting user via WebSocket (ai_response event).
"""
import json
import re
import uuid
from datetime import datetime, timedelta, timezone

import anthropic
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.message import Message
from app.models.shipment import Shipment
from app.models.ai_summary import AISummary
from app.redis_client import get_redis

# ── Anthropic client ───────────────────────────────────────────────
client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

# ── Prompts ────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are a logistics operations assistant. You analyze team communication \
in a logistics company's messaging platform. Your job is to create concise, actionable \
summaries that help operations managers stay on top of their work without reading every message.

Always respond in valid JSON matching this schema exactly — no extra text, no markdown:
{
  "tldr": "string (2-3 sentences)",
  "key_topics": ["string", ...],
  "shipment_status": [{"tracking_id": "string", "status": "string", "note": "string"}, ...],
  "action_items": ["string", ...],
  "alerts": ["string", ...]
}"""

TRACKING_RE = re.compile(r"SHIP-\d{4}-\d{3}")
REDIS_TTL = 3600  # 1 hour
REDIS_KEY_PREFIX = "ai_summary:"


# ── Helpers ────────────────────────────────────────────────────────
def _extract_tracking_ids(contents: list[str]) -> list[str]:
    found: set[str] = set()
    for text in contents:
        found.update(TRACKING_RE.findall(text))
    return list(found)


def _format_messages(messages: list[Message]) -> str:
    if not messages:
        return "(no messages in this time window)"
    lines = []
    for msg in messages:
        sender = msg.sender.username if msg.sender else "unknown"
        ts = msg.created_at.strftime("%H:%M")
        lines.append(f"[{ts}] {sender}: {msg.content}")
    return "\n".join(lines)


def _format_shipments(shipments: list[Shipment]) -> str:
    if not shipments:
        return "(no shipment records found)"
    lines = []
    for s in shipments:
        eta = s.eta.strftime("%b %d") if s.eta else "N/A"
        flagged = " ⚠️ FLAGGED" if s.flagged else ""
        lines.append(
            f"{s.tracking_id}: {s.status.upper()} | {s.origin} → {s.destination} | "
            f"ETA: {eta} | Carrier: {s.carrier}{flagged}"
        )
    return "\n".join(lines)


def _validate_summary(data: dict) -> dict:
    """Ensure the response matches expected schema; fill in defaults if needed."""
    return {
        "tldr": str(data.get("tldr", "")),
        "key_topics": list(data.get("key_topics", [])),
        "shipment_status": [
            {
                "tracking_id": str(item.get("tracking_id", "")),
                "status": str(item.get("status", "")),
                "note": str(item.get("note", "")),
            }
            for item in data.get("shipment_status", [])
        ],
        "action_items": list(data.get("action_items", [])),
        "alerts": list(data.get("alerts", [])),
    }


# ── Redis cache helpers ────────────────────────────────────────────
async def get_cached_summary(channel_id: uuid.UUID) -> dict | None:
    """Return cached summary from Redis, or None if not found."""
    redis = await get_redis()
    raw = await redis.get(f"{REDIS_KEY_PREFIX}{channel_id}")
    if raw:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass
    return None


async def cache_summary(channel_id: uuid.UUID, summary: dict) -> None:
    """Store summary in Redis with 1h TTL."""
    redis = await get_redis()
    await redis.setex(
        f"{REDIS_KEY_PREFIX}{channel_id}",
        REDIS_TTL,
        json.dumps(summary),
    )


# ── DB helpers ─────────────────────────────────────────────────────
async def fetch_recent_messages(
    db: AsyncSession, channel_id: uuid.UUID, hours: int
) -> list[Message]:
    """Fetch messages from the last N hours with sender eagerly loaded."""
    from sqlalchemy.orm import selectinload

    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    result = await db.execute(
        select(Message)
        .options(selectinload(Message.sender))
        .where(
            Message.channel_id == channel_id,
            Message.created_at >= cutoff,
        )
        .order_by(Message.created_at)
    )
    return list(result.scalars().all())


async def fetch_shipments_by_ids(
    db: AsyncSession, tracking_ids: list[str]
) -> list[Shipment]:
    if not tracking_ids:
        return []
    result = await db.execute(
        select(Shipment).where(Shipment.tracking_id.in_(tracking_ids))
    )
    return list(result.scalars().all())


async def persist_summary(
    db: AsyncSession,
    channel_id: uuid.UUID,
    summary: dict,
    message_count: int,
    hours: int,
) -> AISummary:
    """Save the generated summary to the ai_summaries table for audit trail."""
    record = AISummary(
        channel_id=channel_id,
        summary_text=json.dumps(summary),
        message_count=message_count,
        time_window_hours=hours,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


async def get_latest_db_summary(
    db: AsyncSession, channel_id: uuid.UUID
) -> AISummary | None:
    """Retrieve the most recent summary from PostgreSQL for a channel."""
    result = await db.execute(
        select(AISummary)
        .where(AISummary.channel_id == channel_id)
        .order_by(desc(AISummary.generated_at))
        .limit(1)
    )
    return result.scalar_one_or_none()


# ── Core summarization function ────────────────────────────────────
async def summarize_channel(
    db: AsyncSession,
    channel_id: uuid.UUID,
    hours: int = 24,
) -> dict:
    """
    Full summarization pipeline:
      fetch → extract → call Claude → validate → cache → persist → return
    """
    # 1. Fetch messages
    messages = await fetch_recent_messages(db, channel_id, hours)

    # 2. Extract tracking IDs and fetch shipment data
    tracking_ids = _extract_tracking_ids([m.content for m in messages])
    shipments = await fetch_shipments_by_ids(db, tracking_ids)

    # 3. Format for Claude
    conversation_text = _format_messages(messages)
    shipment_context = _format_shipments(shipments)

    # 4. Call Gemini, Claude, or Fallback Mock
    if settings.GEMINI_API_KEY and not settings.GEMINI_API_KEY.startswith("dummy") and settings.GEMINI_API_KEY != "mock":
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={settings.GEMINI_API_KEY}"
        
        prompt = (
            f"{SYSTEM_PROMPT}\n\n"
            f"Summarize the last {hours} hours of activity in this logistics channel.\n\n"
            f"MESSAGES:\n{conversation_text}\n\n"
            f"SHIPMENT DATA:\n{shipment_context}\n\n"
            "Return only the JSON object, no other text."
        )
        
        payload = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": prompt
                        }
                    ]
                }
            ],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "OBJECT",
                    "properties": {
                        "tldr": {"type": "STRING"},
                        "key_topics": {"type": "ARRAY", "items": {"type": "STRING"}},
                        "shipment_status": {
                          "type": "ARRAY",
                          "items": {
                            "type": "OBJECT",
                            "properties": {
                              "tracking_id": {"type": "STRING"},
                              "status": {"type": "STRING"},
                              "note": {"type": "STRING"}
                            },
                            "required": ["tracking_id", "status", "note"]
                          }
                        },
                        "action_items": {"type": "ARRAY", "items": {"type": "STRING"}},
                        "alerts": {"type": "ARRAY", "items": {"type": "STRING"}}
                    },
                    "required": ["tldr", "key_topics", "shipment_status", "action_items", "alerts"]
                }
            }
        }
        
        import httpx
        async with httpx.AsyncClient() as httpx_client:
            res = await httpx_client.post(url, json=payload, timeout=30.0)
            res.raise_for_status()
            res_data = res.json()
            raw_text = res_data["candidates"][0]["content"]["parts"][0]["text"].strip()
            summary = _validate_summary(json.loads(raw_text))

    elif (settings.ANTHROPIC_API_KEY 
          and not settings.ANTHROPIC_API_KEY.startswith("sk-ant-dummy") 
          and settings.ANTHROPIC_API_KEY != "mock"):
        response = client.messages.create(
            model="claude-3-5-sonnet-latest",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Summarize the last {hours} hours of activity in this logistics channel.\n\n"
                        f"MESSAGES:\n{conversation_text}\n\n"
                        f"SHIPMENT DATA:\n{shipment_context}\n\n"
                        "Return only the JSON object, no other text."
                    ),
                }
            ],
        )

        # 5. Parse + validate
        raw_text = response.content[0].text.strip()
        # Strip markdown code fences if model wraps it
        if raw_text.startswith("```"):
            raw_text = re.sub(r"^```[a-z]*\n?", "", raw_text).rstrip("`").strip()

        summary = _validate_summary(json.loads(raw_text))

    else:
        # Construct a realistic mock response dynamically based on channel logs
        topics = ["General Operations"]
        if tracking_ids:
            topics.append(f"Shipment status updates ({', '.join(tracking_ids[:3])})")
        
        shipment_status_list = []
        for s in shipments:
            shipment_status_list.append({
                "tracking_id": s.tracking_id,
                "status": s.status or "unknown",
                "note": f"{s.carrier or 'Carrier'} transport from {s.origin or 'Origin'} to {s.destination or 'Destination'}."
            })
            
        summary = _validate_summary({
            "tldr": f"Mock Operational Summary: Analyzed {len(messages)} messages over the last {hours} hours. The team is coordinating active routes.",
            "key_topics": topics,
            "shipment_status": shipment_status_list,
            "action_items": [f"Audit delayed containers matching tracking IDs" if tracking_ids else "Monitor channel updates"],
            "alerts": ["Storm delays reported near Route West" if "storm" in conversation_text.lower() else "No active alerts."]
        })

    # 6. Cache in Redis (1h TTL)
    await cache_summary(channel_id, summary)

    # 7. Persist in PostgreSQL
    await persist_summary(db, channel_id, summary, len(messages), hours)

    return summary
