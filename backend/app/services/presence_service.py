import uuid
from app.redis_client import get_redis

PRESENCE_TTL = 35  # seconds — expires if no heartbeat
VALID_STATUSES = {"online", "away", "offline"}


def _key(user_id: uuid.UUID) -> str:
    return f"presence:{user_id}"


async def set_user_presence(user_id: uuid.UUID, status: str) -> None:
    """Set user presence in Redis. 'offline' removes the key."""
    if status not in VALID_STATUSES:
        status = "offline"
    redis = await get_redis()
    if status == "offline":
        await redis.delete(_key(user_id))
    else:
        await redis.setex(_key(user_id), PRESENCE_TTL, status)


async def get_user_presence(user_id: uuid.UUID) -> str:
    """Get user presence from Redis. Returns 'offline' if key missing/expired."""
    redis = await get_redis()
    value = await redis.get(_key(user_id))
    return value if value in VALID_STATUSES else "offline"


async def refresh_presence(user_id: uuid.UUID) -> None:
    """Refresh TTL for a user who is already online/away (heartbeat)."""
    redis = await get_redis()
    current = await redis.get(_key(user_id))
    if current in ("online", "away"):
        await redis.expire(_key(user_id), PRESENCE_TTL)


async def get_bulk_presence(user_ids: list[uuid.UUID]) -> dict[str, str]:
    """Get presence for multiple users at once."""
    if not user_ids:
        return {}
    redis = await get_redis()
    keys = [_key(uid) for uid in user_ids]
    values = await redis.mget(*keys)
    return {
        str(uid): (val if val in VALID_STATUSES else "offline")
        for uid, val in zip(user_ids, values)
    }
