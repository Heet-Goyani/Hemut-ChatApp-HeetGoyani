import pytest
from httpx import AsyncClient


async def _create_channel_and_get_id(client: AsyncClient, headers: dict, name: str) -> str:
    resp = await client.post("/api/channels", json={"name": name}, headers=headers)
    assert resp.status_code == 201, f"Channel creation failed: {resp.text}"
    return resp.json()["id"]


@pytest.mark.asyncio
async def test_get_channel_messages(client: AsyncClient, auth_headers: dict):
    """GET /api/messages/channel/{id} → paginated list."""
    channel_id = await _create_channel_and_get_id(client, auth_headers, "msg-list-channel")
    resp = await client.get(f"/api/messages/channel/{channel_id}", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "messages" in data
    assert "has_more" in data
    assert isinstance(data["messages"], list)


@pytest.mark.asyncio
async def test_post_message(client: AsyncClient, auth_headers: dict):
    """POST /api/messages/channel/{id} → 201 message created."""
    channel_id = await _create_channel_and_get_id(client, auth_headers, "msg-post-channel")
    resp = await client.post(
        f"/api/messages/channel/{channel_id}",
        json={"content": "Hello Hemut-Chat!", "message_type": "text"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["content"] == "Hello Hemut-Chat!"
    assert data["sender"] is not None


@pytest.mark.asyncio
async def test_paginated_messages(client: AsyncClient, auth_headers: dict):
    """GET /api/messages/channel/{id}?limit=2 → correct pagination."""
    channel_id = await _create_channel_and_get_id(client, auth_headers, "msg-page-channel")

    # Post 5 messages
    for i in range(5):
        await client.post(
            f"/api/messages/channel/{channel_id}",
            json={"content": f"Message {i}"},
            headers=auth_headers,
        )

    # Fetch with limit=2
    resp = await client.get(
        f"/api/messages/channel/{channel_id}?limit=2",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["messages"]) == 2
    assert data["has_more"] is True
    assert data["next_cursor"] is not None


@pytest.mark.asyncio
async def test_send_dm(client: AsyncClient, auth_headers: dict, second_user_headers: dict):
    """POST /api/dms/{user_id} → 201 DM created."""
    # Get second user's ID
    me_resp = await client.get("/api/auth/me", headers=second_user_headers)
    second_user_id = me_resp.json()["id"]

    resp = await client.post(
        f"/api/dms/{second_user_id}",
        json={"content": "Hey, quick update on SHIP-2024-001!"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["content"] == "Hey, quick update on SHIP-2024-001!"
    assert data["recipient_id"] == second_user_id


@pytest.mark.asyncio
async def test_get_dm_history(client: AsyncClient, auth_headers: dict, second_user_headers: dict):
    """GET /api/dms/{user_id} → DM history list."""
    me_resp = await client.get("/api/auth/me", headers=second_user_headers)
    second_user_id = me_resp.json()["id"]

    # Send a DM first
    await client.post(
        f"/api/dms/{second_user_id}",
        json={"content": "Test DM for history"},
        headers=auth_headers,
    )

    resp = await client.get(f"/api/dms/{second_user_id}", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "messages" in data
    assert len(data["messages"]) >= 1


@pytest.mark.asyncio
async def test_search_messages(client: AsyncClient, auth_headers: dict, second_user_headers: dict):
    """GET /api/messages/search → find matching messages."""
    channel_id = await _create_channel_and_get_id(client, auth_headers, "search-test-channel")

    # Post a message with specific keyword
    await client.post(
        f"/api/messages/channel/{channel_id}",
        json={"content": "Critical customs backup at Rotterdam terminal"},
        headers=auth_headers,
    )

    # Search globally
    resp = await client.get("/api/messages/search?q=Rotterdam", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 1
    assert "Rotterdam" in data[0]["content"]

    # Search with channel scope
    resp_scoped = await client.get(f"/api/messages/search?q=Rotterdam&channel_id={channel_id}", headers=auth_headers)
    assert resp_scoped.status_code == 200
    assert len(resp_scoped.json()) == 1

    # Search with empty query
    resp_empty = await client.get("/api/messages/search?q=", headers=auth_headers)
    assert resp_empty.status_code == 200
    assert len(resp_empty.json()) == 0

    # Search specifically in a 1:1 DM thread
    me_resp = await client.get("/api/auth/me", headers=second_user_headers)
    second_user_id = me_resp.json()["id"]

    await client.post(
        f"/api/dms/{second_user_id}",
        json={"content": "Confidential logistics doc is attached for SHIP-2024-002"},
        headers=auth_headers,
    )

    # Search globally should find it
    resp_global = await client.get("/api/messages/search?q=Confidential", headers=auth_headers)
    assert resp_global.status_code == 200
    assert len(resp_global.json()) == 1

    # Search in DM thread specifically
    resp_dm = await client.get(f"/api/messages/search?q=Confidential&dm_user_id={second_user_id}", headers=auth_headers)
    assert resp_dm.status_code == 200
    assert len(resp_dm.json()) == 1


@pytest.mark.asyncio
async def test_message_thread_replies(client: AsyncClient, auth_headers: dict):
    """Test channel thread reply creation, fetching replies, and count updating."""
    channel_id = await _create_channel_and_get_id(client, auth_headers, "thread-test-channel")

    # 1. Post parent message
    parent_resp = await client.post(
        f"/api/messages/channel/{channel_id}",
        json={"content": "Parent Message"},
        headers=auth_headers,
    )
    assert parent_resp.status_code == 201
    parent_id = parent_resp.json()["id"]

    # 2. Post reply message
    reply_resp = await client.post(
        f"/api/messages/channel/{channel_id}",
        json={"content": "Reply Message", "parent_id": parent_id},
        headers=auth_headers,
    )
    assert reply_resp.status_code == 201
    reply_id = reply_resp.json()["id"]

    # 3. Get replies
    replies_resp = await client.get(f"/api/messages/{parent_id}/replies", headers=auth_headers)
    assert replies_resp.status_code == 200
    replies = replies_resp.json()
    assert len(replies) == 1
    assert replies[0]["id"] == reply_id
    assert replies[0]["parent_id"] == parent_id

    # 4. Fetch channel messages (should not return the reply inline, but parent's reply_count should be 1)
    channel_msgs_resp = await client.get(f"/api/messages/channel/{channel_id}", headers=auth_headers)
    assert channel_msgs_resp.status_code == 200
    data = channel_msgs_resp.json()
    # Should only contain 1 message (the parent)
    assert len(data["messages"]) == 1
    assert data["messages"][0]["id"] == parent_id
    assert data["messages"][0]["reply_count"] == 1


@pytest.mark.asyncio
async def test_thread_validation_errors(client: AsyncClient, auth_headers: dict):
    """Test thread creation error paths and validation constraints."""
    channel_id_1 = await _create_channel_and_get_id(client, auth_headers, "validation-channel-1")
    channel_id_2 = await _create_channel_and_get_id(client, auth_headers, "validation-channel-2")

    # Post message in channel 1
    parent_resp = await client.post(
        f"/api/messages/channel/{channel_id_1}",
        json={"content": "Parent in Ch 1"},
        headers=auth_headers,
    )
    assert parent_resp.status_code == 201
    parent_id = parent_resp.json()["id"]

    # Try to reply with parent from channel 1 in channel 2
    bad_reply_resp = await client.post(
        f"/api/messages/channel/{channel_id_2}",
        json={"content": "Cross-channel reply", "parent_id": parent_id},
        headers=auth_headers,
    )
    assert bad_reply_resp.status_code == 400
    assert "Parent message does not belong to this channel" in bad_reply_resp.json()["detail"]

    # Try to reply to non-existent parent
    fake_uuid = "00000000-0000-0000-0000-000000000000"
    fake_parent_resp = await client.post(
        f"/api/messages/channel/{channel_id_1}",
        json={"content": "Fake parent reply", "parent_id": fake_uuid},
        headers=auth_headers,
    )
    assert fake_parent_resp.status_code == 404
    assert "Parent message not found" in fake_parent_resp.json()["detail"]

    # Post a reply message
    reply_resp = await client.post(
        f"/api/messages/channel/{channel_id_1}",
        json={"content": "Reply 1", "parent_id": parent_id},
        headers=auth_headers,
    )
    assert reply_resp.status_code == 201
    reply_id = reply_resp.json()["id"]

    # Try to reply to a reply (nested sub-threads not allowed)
    nested_reply_resp = await client.post(
        f"/api/messages/channel/{channel_id_1}",
        json={"content": "Nested reply", "parent_id": reply_id},
        headers=auth_headers,
    )
    assert nested_reply_resp.status_code == 400
    assert "Cannot reply to a thread reply message" in nested_reply_resp.json()["detail"]

