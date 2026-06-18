from contextlib import asynccontextmanager
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.redis_client import close_redis, get_redis
from app.routers import auth, channels, messages, dms, shipments, presence, ai, rag
from app.websocket.manager import websocket_router



# Ensure static uploads directory exists before mounting
os.makedirs("uploads", exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await get_redis()  # warm up Redis connection
    yield
    # Shutdown
    await close_redis()


app = FastAPI(
    title="Hemut-Chat API",
    version="1.0.0",
    description="Real-time logistics collaboration platform",
    lifespan=lifespan,
)

app.mount("/static/uploads", StaticFiles(directory="uploads"), name="uploads")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# REST routers
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(channels.router, prefix="/api/channels", tags=["channels"])
app.include_router(messages.router, prefix="/api/messages", tags=["messages"])
app.include_router(dms.router, prefix="/api/dms", tags=["dms"])
app.include_router(shipments.router, prefix="/api/shipments", tags=["shipments"])
app.include_router(presence.router, prefix="/api/presence", tags=["presence"])
app.include_router(ai.router, prefix="/api/ai", tags=["ai"])
app.include_router(rag.router, prefix="/api/rag", tags=["rag"])


# WebSocket router
app.include_router(websocket_router)


@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "ok", "version": "1.0.0"}
