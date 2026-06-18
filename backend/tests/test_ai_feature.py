"""
AI Feature Tests — IMPORTANT: Always mock the Anthropic API.
Never call the real API in tests.

Tests:
  1. summarize_channel() returns valid structure with mocked Claude
  2. Redis cache is populated after summarization
  3. POST /api/ai/summarize → 202 Accepted (non-blocking)
  4. GET /api/ai/summary → 404 when no summary exists
  5. GET /api/ai/summary → returns cached Redis summary
"""
import json
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient

from app.services.ai_service import (
    _validate_summary,
    _format_messages,
    _format_shipments,
    _extract_tracking_ids,
    summarize_channel,
    get_cached_summary,
    cache_summary,
)

# ── Mock data ──────────────────────────────────────────────────────
MOCK_AI_RESPONSE = {
    "tldr": "Team discussed delays on Route East. SHIP-2024-001 cleared customs.",
    "key_topics": ["Customs clearance", "Route East delays", "Warehouse capacity"],
    "shipment_status": [
        {
            "tracking_id": "SHIP-2024-001",
            "status": "in_transit",
            "note": "Cleared Dubai customs",
        }
    ],
    "action_items": ["Follow up with DHL on SHIP-2024-003 ETA"],
    "alerts": [],
}


# ── Unit tests (no DB / HTTP) ──────────────────────────────────────
def test_validate_summary_full():
    """_validate_summary normalises a well-formed dict."""
    result = _validate_summary(MOCK_AI_RESPONSE)
    assert result["tldr"] != ""
    assert isinstance(result["key_topics"], list)
    assert isinstance(result["shipment_status"], list)
    assert isinstance(result["action_items"], list)
    assert isinstance(result["alerts"], list)
    assert result["shipment_status"][0]["tracking_id"] == "SHIP-2024-001"


def test_validate_summary_missing_keys():
    """_validate_summary fills defaults for missing keys."""
    result = _validate_summary({})
    assert result["tldr"] == ""
    assert result["key_topics"] == []
    assert result["action_items"] == []


def test_extract_tracking_ids():
    """Tracking ID regex extracts SHIP-YYYY-NNN patterns."""
    texts = [
        "Update on SHIP-2024-001: cleared customs.",
        "Also see SHIP-2024-003 and SHIP-2024-003 (duplicate).",
        "No IDs here.",
    ]
    ids = _extract_tracking_ids(texts)
    assert "SHIP-2024-001" in ids
    assert "SHIP-2024-003" in ids
    assert len(ids) == 2  # deduped


def test_format_messages_empty():
    """_format_messages handles empty list gracefully."""
    result = _format_messages([])
    assert "no messages" in result.lower()


def test_format_shipments_empty():
    """_format_shipments handles empty list gracefully."""
    result = _format_shipments([])
    assert "no shipment" in result.lower()


# ── Integration tests (mocked Claude) ─────────────────────────────
@pytest.mark.asyncio
@patch("app.services.ai_service.client")
async def test_summarize_channel_mocked(mock_client, client: AsyncClient, auth_headers: dict):
    """
    summarize_channel() calls Claude once and returns validated structure.
    Requires: a channel with at least one message in the DB.
    """
    # Set up mock Claude response
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=json.dumps(MOCK_AI_RESPONSE))]
    mock_client.messages.create.return_value = mock_response

    # Create a channel + post a message to it
    ch_resp = await client.post(
        "/api/channels",
        json={"name": "ai-test-channel"},
        headers=auth_headers,
    )
    assert ch_resp.status_code == 201
    channel_id = uuid.UUID(ch_resp.json()["id"])

    await client.post(
        f"/api/messages/channel/{channel_id}",
        json={"content": "SHIP-2024-001 is delayed at Dubai port."},
        headers=auth_headers,
    )

    # Use the test DB (overridden in conftest via dependency injection)
    # We call the router endpoint rather than service directly to use the right DB
    with patch("app.routers.ai._run_summarization") as mock_bg:
        # Capture what would have been called and run it manually with our test DB
        called_with = {}

        async def capture(*args, **kwargs):
            called_with["channel_id"] = args[0]
            called_with["user_id"] = args[1]
            called_with["hours"] = args[2]

        mock_bg.side_effect = capture
        await client.post(
            f"/api/ai/summarize/{channel_id}",
            headers=auth_headers,
        )

    # Directly call the service with a test DB session
    from tests.conftest import TestAsyncSession
    async with TestAsyncSession() as db:
        # Patch setting to not look like a dummy key so it calls Claude client
        with patch("app.services.ai_service.settings.ANTHROPIC_API_KEY", "sk-ant-test-key-mock"):
            result = await summarize_channel(db, channel_id, hours=24)

    assert result["tldr"] != ""
    assert isinstance(result["key_topics"], list)
    assert isinstance(result["action_items"], list)
    mock_client.messages.create.assert_called_once()

    # Verify prompt contains our message content
    call_args = mock_client.messages.create.call_args
    prompt_content = call_args.kwargs["messages"][0]["content"]
    assert "SHIP-2024-001" in prompt_content


@pytest.mark.asyncio
async def test_summarize_channel_fallback(client: AsyncClient, auth_headers: dict):
    """
    summarize_channel() uses the local mock fallback when a dummy key is present.
    It should NOT call the Anthropic API, but still return a valid validated summary structure.
    """
    # Create a channel + post a message to it
    ch_resp = await client.post(
        "/api/channels",
        json={"name": "ai-fallback-channel"},
        headers=auth_headers,
    )
    assert ch_resp.status_code == 201
    channel_id = uuid.UUID(ch_resp.json()["id"])

    await client.post(
        f"/api/messages/channel/{channel_id}",
        json={"content": "SHIP-2024-999 is delayed. The team is looking into it."},
        headers=auth_headers,
    )

    # Ensure the dummy key is present
    with patch("app.services.ai_service.settings.ANTHROPIC_API_KEY", "sk-ant-dummy-test-key"):
        from tests.conftest import TestAsyncSession
        async with TestAsyncSession() as db:
            result = await summarize_channel(db, channel_id, hours=24)

    # Assert it returns a mock summary that follows the expected schema
    assert result["tldr"] != ""
    assert "mock" in result["tldr"].lower() or "analyzed" in result["tldr"].lower()
    assert isinstance(result["key_topics"], list)
    assert isinstance(result["action_items"], list)
    assert isinstance(result["shipment_status"], list)


@pytest.mark.asyncio
@patch("app.services.ai_service.client")
async def test_summarize_caches_in_redis(mock_client, client: AsyncClient, auth_headers: dict):
    """After summarize_channel(), Redis should hold the cached result."""
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=json.dumps(MOCK_AI_RESPONSE))]
    mock_client.messages.create.return_value = mock_response

    ch_resp = await client.post(
        "/api/channels",
        json={"name": "ai-cache-test"},
        headers=auth_headers,
    )
    channel_id = uuid.UUID(ch_resp.json()["id"])

    from tests.conftest import TestAsyncSession
    async with TestAsyncSession() as db:
        await summarize_channel(db, channel_id, hours=24)

    # Check Redis cache
    cached = await get_cached_summary(channel_id)
    assert cached is not None
    assert "tldr" in cached


@pytest.mark.asyncio
async def test_trigger_summarization_endpoint(client: AsyncClient, auth_headers: dict):
    """POST /api/ai/summarize/{channel_id} → 202 Accepted immediately."""
    ch_resp = await client.post(
        "/api/channels",
        json={"name": "ai-endpoint-test"},
        headers=auth_headers,
    )
    channel_id = ch_resp.json()["id"]

    # Patch the background task so it doesn't actually call Claude
    with patch("app.routers.ai._run_summarization") as mock_task:
        mock_task.return_value = None
        resp = await client.post(
            f"/api/ai/summarize/{channel_id}",
            headers=auth_headers,
        )

    assert resp.status_code == 202
    data = resp.json()
    assert "started" in data["message"].lower()
    assert data["channel_id"] == channel_id


@pytest.mark.asyncio
async def test_get_summary_not_found(client: AsyncClient, auth_headers: dict):
    """GET /api/ai/summary/{channel_id} with no summary → 404."""
    ch_resp = await client.post(
        "/api/channels",
        json={"name": "ai-nosummary-test"},
        headers=auth_headers,
    )
    channel_id = ch_resp.json()["id"]

    resp = await client.get(f"/api/ai/summary/{channel_id}", headers=auth_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_summary_from_cache(client: AsyncClient, auth_headers: dict):
    """GET /api/ai/summary/{channel_id} returns Redis-cached summary."""
    ch_resp = await client.post(
        "/api/channels",
        json={"name": "ai-getsummary-test"},
        headers=auth_headers,
    )
    channel_id = uuid.UUID(ch_resp.json()["id"])

    # Manually populate Redis cache
    await cache_summary(channel_id, MOCK_AI_RESPONSE)

    resp = await client.get(f"/api/ai/summary/{channel_id}", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["source"] == "cache"
    assert data["summary"]["tldr"] == MOCK_AI_RESPONSE["tldr"]
