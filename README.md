# Hemut-Chat — Logistics Team Workspace

Hemut-Chat is a real-time, logistics-centric communication platform built with **FastAPI**, **Next.js**, **PostgreSQL**, **Redis**, and **Google Gemini / Anthropic Claude**. It is designed to keep dispatchers, coordinators, and terminal managers aligned on shipment statuses, delays, and critical alerts.

---

## 🚀 Running Hemut-Chat Locally

### Option 1: Docker (Recommended)
This launches PostgreSQL, Redis, the FastAPI Backend, and the Next.js Frontend with a single command.

1. **Clone & Setup Environment:**
   ```bash
   cp .env.example .env
   # Add your GEMINI_API_KEY or ANTHROPIC_API_KEY inside .env
   ```

2. **Launch with Docker Compose:**
   ```bash
   docker-compose up --build
   ```

3. **Access Services:**
   - **Frontend:** http://localhost:3000
   - **Backend API:** http://localhost:8000
   - **API Docs (Swagger):** http://localhost:8000/docs

---

### Option 2: Manual Setup (Development Mode)

#### 1. Infrastructure Services
Ensure you have local instances of **PostgreSQL** and **Redis** running:
- PostgreSQL URL: `postgresql+asyncpg://logichat_user:supersecretpassword@localhost:5432/logichat`
- Redis URL: `redis://:redispassword@localhost:6379/0`

#### 2. Backend Server Setup
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: .\venv\Scripts\activate
pip install -r requirements.txt

# Run migrations
alembic upgrade head

# Seed initial seed users & shipments
python -m scripts.seed

# Run dev server
uvicorn app.main:app --reload
```

#### 3. Frontend Next.js Setup
```bash
cd frontend
npm install
npm run dev
```
Open http://localhost:3000 to interact with the workspace.

---

## 🏗️ Architecture Overview

```mermaid
graph TD
    subgraph Frontend["Next.js 14 Frontend (Port 3000)"]
        AUTH[Auth Page\nXHR Login/Register]
        SIDEBAR[Sidebar\nChannels + DMs]
        CHANNEL[Channel View\n✨ Catch Me Up]
        AUTO[Autocomplete\n/shipment menu]
        DM[DM View]
        SHIPS[Shipments Page]
    end

    subgraph Backend["FastAPI Backend (Port 8000)"]
        AUTHAPI[/api/auth]
        CHANAPI[/api/channels]
        MSGAPI[/api/messages]
        DMAPI[/api/dms]
        SHIPAPI[/api/shipments]
        AIAPI[/api/ai]
        PRESAPI[/api/presence]
        WS[ws://localhost:8000/ws/{userId}]
    end

    subgraph Infra["Infrastructure"]
        PG[(PostgreSQL 15)]
        REDIS[(Redis 7)]
        GEMINI[Google Gemini API\ngemini-3.5-flash]
        CLAUDE[Anthropic Claude\nclaude-3-5-sonnet]
    end

    Frontend -->|XHR / fetch| Backend
    Frontend -->|WebSocket| WS
    Backend --> PG
    Backend --> REDIS
    AIAPI --> GEMINI
    AIAPI --> CLAUDE
    WS -->|pub/sub| REDIS
```

---

## 🔮 AI Feature: "Catch Me Up" Thread Summarizer

### 1. Why This Feature?
In high-velocity logistics and supply chain operations, channels like `#route-east` or `#incidents` receive dozens of messages per hour regarding delays, weather alerts, carrier swaps, and terminal backups.
* **Problem:** Operations managers returning from a break or starting a shift cannot read through hundreds of chats without falling behind on immediate issues.
* **Solution:** A **"Catch Me Up"** button that leverages LLMs to distill discussion logs into structured, actionable reports.
* **Operational Control:** Rather than a static 24-hour window, users can select the timeframe to analyze:
  1. **Unread Chat Only:** Analyzes only messages received since they last checked the channel.
  2. **Last 24 Hours:** Captures recent daily updates.
  3. **Last 7 Days:** Summarizes high-level weekly trends.
* **Logistics-Specific Advantage:** Rather than just summarizing text, this feature matches shipment IDs (like `SHIP-2024-001`) mentioned in chat threads with their live database records (ETA, carrier, destination, status, flagged delays) to provide a unified, highly contextual logistics briefing.

---

### 2. How it is Implemented

The AI Catch Me Up pipeline is designed to be completely **asynchronous** and **non-blocking**:

```mermaid
sequenceDiagram
    autonumber
    actor User as Operations Manager
    participant FE as Next.js Frontend
    participant BE as FastAPI Backend
    participant DB as PostgreSQL
    participant Redis as Redis Cache
    participant LLM as Google Gemini / Claude

    User->>FE: Enters channel
    FE->>BE: GET /api/channels/{channel_id} (loads last_read_at)
    FE->>BE: POST /api/channels/{channel_id}/read (updates read marker)
    User->>FE: Clicks "Catch me up" & selects timeframe
    FE->>BE: POST /api/ai/summarize/{channel_id} (optional last_read_at)
    BE-->>FE: HTTP 202 Accepted (Immediately unblocks UI)
    
    rect rgb(30, 41, 59)
        note right of BE: Background Task Execution
        BE->>DB: Fetch messages since cutoff (limit 200)
        alt Zero messages since last_read_at
            BE-->>FE: Push caught up JSON via WebSocket
        else Messages found
            BE->>BE: Extract SHIP-YYYY-NNN tracking IDs
            BE->>DB: Fetch matching live Shipment records
            BE->>LLM: Prompt with structured schema requirements
            LLM-->>BE: Returns validated JSON response
            BE->>Redis: Cache summary (1-hour TTL)
            BE->>DB: Persist summary in ai_summaries table
            BE->>BE: Broadcast result to user WS channel
            BE-->>FE: WS push: ai_response event
        end
    end
    FE->>User: Render glassmorphic AISummaryPanel
```

#### LLM Schema Enforcement:
The LLM is restricted to a structured JSON output representing the operational dashboard components:
* **`tldr`:** Executive summary (2-3 sentences).
* **`key_topics`:** Bulleted key discussion themes.
* **`shipment_status`:** List mapping tracking IDs, live status, and inferred delays.
* **`action_items`:** Actionable task items.
* **`alerts`:** Bottlenecks needing manager intervention.

---

### 3. What Would Change in Production?

1. **Robust Task Queue (Celery / Huey):**
   * *Current:* FastAPI's default `BackgroundTasks` run in the same process event loop.
   * *Production:* Offload LLM requests to a dedicated cluster of Celery workers backed by a Redis/RabbitMQ broker to prevent request pool exhaustion.

2. **Concurrent Request Coalescing:**
   * If a summary is currently generating for `#dispatch`, block other users from starting a concurrent request for the same channel. Instead, cache the in-progress promise and broadcast the result to all active subscribers.

3. **Context Window Safeguards:**
   * For extremely active channels, the text could exceed token limits. In production, we would implement chunked pre-summarization or limit input logs to the last 150 messages.

4. **Enterprise Security (PII Redaction):**
   * Filter out user phone numbers, email addresses, or billing numbers before sending payloads to third-party model APIs to comply with data governance regulations (GDPR/SOC2).

---

## 🔍 Autocomplete Suggestions for `/shipment` Commands

To improve user experience, we implemented a real-time suggestions dropdown that triggers when typing `/shipment` commands in the message input field.

```mermaid
graph TD
    INPUT[User Types in input area]
    IS_SHIP{Starts with /shipment?}
    LOAD[Load shipments from DB if not cached]
    EXTRACT[Extract query text after /shipment]
    FILTER[Filter tracking IDs by query]
    RENDER[Render glassmorphic dropdown above input]
    KB_NAV[Arrow keys select / Enter completes]
    COMPLETE[Replace input with /shipment SHIP-YYYY-NNN]

    INPUT --> IS_SHIP
    IS_SHIP -->|Yes| LOAD
    LOAD --> EXTRACT
    EXTRACT --> FILTER
    FILTER --> RENDER
    RENDER --> KB_NAV
    KB_NAV --> COMPLETE
    IS_SHIP -->|No| RENDER_NORMAL[Render normal input]
```

---

## ⚖️ Thoughtful Tradeoffs

### 1. Attachment Metadata in Message JSONB Column
* **Tradeoff:** Stored attachment details (`url`, `name`, `type`, `size`) directly inside the existing JSONB `metadata` column of the `messages` table, rather than creating a dedicated `attachments` relation table.
* **Pros:** Zero-migration deployment, backward compatibility, and simplified single-query message loads.
* **Cons:** Harder to index or run database-level queries on files (e.g. counting total MB uploaded). We chose this for rapid deployment and high stability.

### 2. Session-Based Unread Cutoffs
* **Tradeoff:** When a user opens a channel, we fetch their `last_read_at` timestamp and store it in React state, but immediately call `POST /api/channels/{channel_id}/read` to mark the channel as read on the backend.
* **Pros:** Badges are cleared immediately in the sidebar (responsive UI), yet the active view preserves the original unread marker so they can still catch up on what they missed when they click the button.
* **Cons:** If they refresh the page before clicking "Catch me up", their unread count will reset to 0. We chose this as it provides the most reactive UX while keeping state synchronization simple.

### 3. Stateless AI Cutoffs
* **Tradeoff:** The client passes the session's `last_read_at` timestamp directly as a query parameter (`?last_read_at=...`) to `POST /api/ai/summarize/{channel_id}` instead of the backend managing session state.
* **Pros:** Keeps the backend API stateless, makes the endpoint testable in isolation, and allows the frontend to have full control over the session boundary.
* **Cons:** Malicious clients could pass arbitrary timestamps, which is mitigated by backend channel membership validation.

---