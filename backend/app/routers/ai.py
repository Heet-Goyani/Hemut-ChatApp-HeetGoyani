"""
AI Router — /api/ai

POST /api/ai/summarize/{channel_id}
  → Triggers summarization as a background task.
  → Returns immediately with 202 Accepted.
  → Result is pushed to the requesting user via WebSocket (ai_response event).

GET /api/ai/summary/{channel_id}
  → Returns the latest cached summary (Redis → PostgreSQL fallback).
  → Returns 404 if no summary exists yet.
"""
import json
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, AsyncSessionLocal
from app.middleware.auth_middleware import get_current_user
from app.models.user import User
from app.services import ai_service
from app.services.channel_service import get_channel_by_id
from app.websocket.handlers import on_ai_summary_complete

router = APIRouter()


# ── Background task ────────────────────────────────────────────────
async def _run_summarization(
    channel_id: uuid.UUID,
    requester_id: uuid.UUID,
    hours: int,
) -> None:
    """
    Runs in background:
      1. Calls Claude API to summarize the channel.
      2. Pushes the result to the requesting user via WebSocket.
      3. Any exceptions are swallowed — never crash the worker.
    """
    try:
        async with AsyncSessionLocal() as db:
            summary = await ai_service.summarize_channel(db, channel_id, hours)
        await on_ai_summary_complete(requester_id, channel_id, summary)
    except json.JSONDecodeError as e:
        # AI service returned malformed JSON — push an error event
        await on_ai_summary_complete(requester_id, channel_id, {
            "error": "AI returned a malformed response. Please try again.",
            "tldr": "",
            "key_topics": [],
            "shipment_status": [],
            "action_items": [],
            "alerts": [],
        })
    except Exception as e:
        user_friendly_msg = (
            "AI Summarization is temporarily unavailable due to high server load. "
            "Please try again in a few minutes, or contact heet@hemut.com if the issue persists."
        )
        await on_ai_summary_complete(requester_id, channel_id, {
            "error": user_friendly_msg,
            "tldr": "",
            "key_topics": [],
            "shipment_status": [],
            "action_items": [],
            "alerts": [],
        })


# ── Endpoints ──────────────────────────────────────────────────────
@router.post(
    "/summarize/{channel_id}",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=dict,
)
async def trigger_summarization(
    channel_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    hours: int = 24,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger AI summarization for a channel.
    Returns 202 immediately — result delivered via WebSocket ai_response event.

    Query params:
      hours (int, default 24): time window for messages to summarize.
    """
    channel = await get_channel_by_id(db, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    # Fire summarization in background — don't block the HTTP response
    background_tasks.add_task(_run_summarization, channel_id, current_user.id, hours)

    return {
        "message": "Summarization started. Result will be delivered via WebSocket.",
        "channel_id": str(channel_id),
        "hours": hours,
    }


@router.get("/summary/{channel_id}", response_model=dict)
async def get_summary(
    channel_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get the latest cached summary for a channel.
    Checks Redis first (fast), then falls back to PostgreSQL.
    Returns 404 if no summary has been generated yet.
    """
    channel = await get_channel_by_id(db, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")

    # 1. Try Redis cache first
    cached = await ai_service.get_cached_summary(channel_id)
    if cached:
        return {
            "channel_id": str(channel_id),
            "summary": cached,
            "source": "cache",
        }

    # 2. Fall back to PostgreSQL
    db_record = await ai_service.get_latest_db_summary(db, channel_id)
    if not db_record:
        raise HTTPException(
            status_code=404,
            detail="No summary found. Use POST /api/ai/summarize/{channel_id} to generate one.",
        )

    try:
        summary = json.loads(db_record.summary_text)
    except json.JSONDecodeError:
        summary = {"tldr": db_record.summary_text}

    return {
        "channel_id": str(channel_id),
        "summary": summary,
        "generated_at": db_record.generated_at.isoformat(),
        "message_count": db_record.message_count,
        "time_window_hours": db_record.time_window_hours,
        "source": "database",
    }
