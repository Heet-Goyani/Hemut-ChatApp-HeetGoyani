import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_register_success(client: AsyncClient):
    """POST /api/auth/register → 201 with access token."""
    resp = await client.post("/api/auth/register", json={
        "username": "alice_test",
        "email": "alice_test@example.com",
        "password": "SecurePass123!",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["user"]["username"] == "alice_test"


@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient):
    """POST /api/auth/register with duplicate email → 409 Conflict."""
    payload = {
        "username": "dupuser1",
        "email": "dup@example.com",
        "password": "SecurePass123!",
    }
    await client.post("/api/auth/register", json=payload)
    # Try again with different username but same email
    resp = await client.post("/api/auth/register", json={
        **payload,
        "username": "dupuser2",
    })
    assert resp.status_code == 409
    assert "email" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient):
    """POST /api/auth/login with valid credentials → 200 with tokens."""
    await client.post("/api/auth/register", json={
        "username": "loginuser",
        "email": "loginuser@example.com",
        "password": "SecurePass123!",
    })
    resp = await client.post("/api/auth/login", json={
        "username": "loginuser",
        "password": "SecurePass123!",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    """POST /api/auth/login with wrong password → 401 Unauthorized."""
    await client.post("/api/auth/register", json={
        "username": "wrongpassuser",
        "email": "wrongpass@example.com",
        "password": "SecurePass123!",
    })
    resp = await client.post("/api/auth/login", json={
        "username": "wrongpassuser",
        "password": "WrongPassword!",
    })
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_me_without_token(client: AsyncClient):
    """GET /api/auth/me without token → 401."""
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_me_with_valid_token(client: AsyncClient, auth_headers: dict):
    """GET /api/auth/me with valid token → 200 with user object."""
    resp = await client.get("/api/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "id" in data
    assert "username" in data
    assert "email" in data
    assert "hashed_password" not in data  # must never be exposed
