import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_seed_shipments(client: AsyncClient, auth_headers: dict):
    """POST /api/shipments/seed → seeds 20 shipments."""
    resp = await client.post("/api/shipments/seed", headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert "seeded" in data["message"] or "shipment" in data["message"].lower()


@pytest.mark.asyncio
async def test_list_shipments(client: AsyncClient, auth_headers: dict):
    """GET /api/shipments → list of shipments."""
    # Ensure seeded
    await client.post("/api/shipments/seed", headers=auth_headers)
    resp = await client.get("/api/shipments", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) > 0
    # Check schema
    first = data[0]
    assert "tracking_id" in first
    assert "status" in first
    assert "origin" in first


@pytest.mark.asyncio
async def test_get_shipment_by_tracking_id(client: AsyncClient, auth_headers: dict):
    """GET /api/shipments/SHIP-2024-001 → shipment detail."""
    await client.post("/api/shipments/seed", headers=auth_headers)
    resp = await client.get("/api/shipments/SHIP-2024-001", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["tracking_id"] == "SHIP-2024-001"
    assert "origin" in data
    assert "destination" in data
    assert "carrier" in data
    assert "status" in data


@pytest.mark.asyncio
async def test_get_nonexistent_shipment(client: AsyncClient, auth_headers: dict):
    """GET /api/shipments/NONEXISTENT → 404."""
    resp = await client.get("/api/shipments/SHIP-9999-999", headers=auth_headers)
    assert resp.status_code == 404
