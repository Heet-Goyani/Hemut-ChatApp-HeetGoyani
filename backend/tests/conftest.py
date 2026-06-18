import asyncio
import uuid
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.main import app
from app.database import Base, get_db
from app.config import settings

@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for the test session."""
    policy = asyncio.get_event_loop_policy()
    loop = policy.new_event_loop()
    yield loop
    loop.close()

# Use a separate test database
TEST_DATABASE_URL = settings.DATABASE_URL.rsplit("/", 1)[0] + "/logichat_test"

from sqlalchemy.pool import NullPool
test_engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool, echo=False)
TestAsyncSession = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)


async def override_get_db():
    async with TestAsyncSession() as session:
        try:
            yield session
        finally:
            await session.close()


app.dependency_overrides[get_db] = override_get_db


@pytest_asyncio.fixture(scope="session", autouse=True)
async def create_test_tables():
    from sqlalchemy import text
    # Dynamically create the test database if it does not exist
    admin_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool, isolation_level="AUTOCOMMIT")
    async with admin_engine.connect() as conn:
        try:
            await conn.execute(text("CREATE DATABASE logichat_test"))
        except Exception:
            # Database might already exist (fails with DuplicateDatabase) or has other restriction
            pass
    await admin_engine.dispose()

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        # Import models so Base.metadata knows about all tables
        from app.models import user, channel, message, shipment, membership, ai_summary  # noqa
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await test_engine.dispose()


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac


@pytest_asyncio.fixture
async def auth_headers(client: AsyncClient):
    """Register a unique test user and return auth headers."""
    unique = uuid.uuid4().hex[:8]
    resp = await client.post("/api/auth/register", json={
        "username": f"testuser_{unique}",
        "email": f"testuser_{unique}@example.com",
        "password": "TestPass123!",
        "display_name": "Test User",
    })
    assert resp.status_code == 201, f"Register failed: {resp.text}"
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def second_user_headers(client: AsyncClient):
    """Register a second unique test user."""
    unique = uuid.uuid4().hex[:8]
    resp = await client.post("/api/auth/register", json={
        "username": f"testuser2_{unique}",
        "email": f"testuser2_{unique}@example.com",
        "password": "TestPass123!",
        "display_name": "Test User 2",
    })
    assert resp.status_code == 201, f"Register failed: {resp.text}"
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
