import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_channels(client: AsyncClient, auth_headers: dict):
    """GET /api/channels → 200 list of channels."""
    resp = await client.get("/api/channels", headers=auth_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_create_channel(client: AsyncClient, auth_headers: dict):
    """POST /api/channels → 201 channel created."""
    resp = await client.post("/api/channels", json={
        "name": "test-channel",
        "description": "A test channel",
        "is_private": False,
    }, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "test-channel"
    assert data["is_member"] is True
    assert data["member_count"] == 1


@pytest.mark.asyncio
async def test_join_channel(client: AsyncClient, auth_headers: dict, second_user_headers: dict):
    """POST /api/channels/{id}/join → 200 joined successfully."""
    # Create channel as first user
    create_resp = await client.post("/api/channels", json={
        "name": "join-test-channel",
        "description": "Channel to test joining",
    }, headers=auth_headers)
    channel_id = create_resp.json()["id"]

    # Second user joins
    resp = await client.post(f"/api/channels/{channel_id}/join", headers=second_user_headers)
    assert resp.status_code == 200
    assert "joined" in resp.json()["message"].lower() or "member" in resp.json()["message"].lower()


@pytest.mark.asyncio
async def test_leave_channel(client: AsyncClient, auth_headers: dict):
    """DELETE /api/channels/{id}/leave → 200 left successfully."""
    # Create and then leave
    create_resp = await client.post("/api/channels", json={
        "name": "leave-test-channel",
    }, headers=auth_headers)
    channel_id = create_resp.json()["id"]

    resp = await client.delete(f"/api/channels/{channel_id}/leave", headers=auth_headers)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_create_channel_duplicate(client: AsyncClient, auth_headers: dict):
    """POST /api/channels with duplicate name → 409 Conflict."""
    payload = {"name": "duplicate-channel"}
    await client.post("/api/channels", json=payload, headers=auth_headers)
    resp = await client.post("/api/channels", json=payload, headers=auth_headers)
    assert resp.status_code == 409
