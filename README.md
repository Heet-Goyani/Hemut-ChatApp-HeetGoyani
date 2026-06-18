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

Hemut-Chat is designed with a modern, decoupled architecture:
* **Frontend:** A Next.js 14 React client running on port 3000. It manages authentication (via raw XHR form submissions), routes to Channels and DMs, fetches real-time presence/typing indicators, and mounts shipment tracking details and the glassmorphic AI panel.
* **Backend:** A FastAPI python server running on port 8000. It exposes REST API routers for channels, messages, DMs, shipments, presence, and AI summaries, while running a WebSocket manager (`ws://`) for live event fan-out.
* **Infrastructure & Database:** A PostgreSQL database serves as the durable store for user profiles, channels, message logs, and shipments. A Redis instance manages real-time pub/sub messaging channels and holds temporary cached AI Catch Me Up summaries.
* **AI Provider:** The FastAPI backend securely integrates with Google Gemini (`gemini-3.5-flash`) and Anthropic Claude APIs to summarize conversations.

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

The AI Catch Me Up pipeline operates completely asynchronously to ensure the user interface never freezes:
1. **Initial Entrance:** When a user enters a channel, the frontend loads the channel details (including their `last_read_at` timestamp) and immediately fires a background request (`POST /api/channels/{channel_id}/read`) to update their read marker on the database (clearing sidebar badges). The frontend preserves the original `last_read_at` in React state.
2. **Timeframe Selection:** When the user clicks the Catch Me Up button in the header, the AI panel drawer slides open. Instead of triggering immediately, it calculates the unread count locally and presents the user with cards (Unread Chat, Last 24 Hours, Last 7 Days).
3. **Triggering Summarization:** The user selects a timeframe. If they select "Unread Chat", the frontend passes the cached `last_read_at` timestamp to the backend (`POST /api/ai/summarize/{channel_id}?last_read_at=...`). The API returns a `202 Accepted` status code immediately, allowing the user to continue chatting.
4. **Backend Message Collection:** The backend runs the task in the background. It queries the PostgreSQL database for messages within the timeframe (messages newer than `last_read_at` or within the selected hour range). 
5. **No-Message Fast-Exit:** If "Unread Chat" is chosen and there are 0 new messages in the DB, the task exits early and immediately pushes a "caught up" JSON block to the user's WebSocket, avoiding costly LLM API calls.
6. **Logistics Context Enrichment:** If messages exist, the backend extracts any mentioned shipment tracking IDs (`SHIP-YYYY-NNN` pattern) using regex, and queries PostgreSQL for matching live carrier, origin, destination, ETA, and delay details.
7. **LLM Query & Parsing:** The backend formats the message transcript and live shipment data into a structured prompt, calling the Gemini (`gemini-3.5-flash`) or Claude API. The LLM response is validated against the required JSON schema.
8. **Caching & WebSocket Delivery:** The validated summary is cached in Redis (with a 1-hour TTL) and saved in PostgreSQL for historical reference. The result is pushed directly to the user's open WebSocket connection (`ai_response` event) where the frontend renders it as a structured operational summary.

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

## 🔍 Autocomplete Suggestions for `/shipment` Commands

To improve user experience, we implemented a real-time suggestions dropdown that triggers dynamically as the user types:
1. **Input Interception:** The `MessageInput` text area listens to changes. If the typed text starts with `/shipment`, it triggers the autocomplete logic.
2. **Metadata Fetching:** On the first match, the component invokes `fetchShipments()` from the API client, caching all active shipment tracking IDs from PostgreSQL.
3. **Fuzzy Query Filtering:** Any text entered after `/shipment ` (e.g. `SHIP-2`) is used as a filter. We return all cached tracking IDs that case-insensitively include the query string.
4. **Glassmorphic Suggestions Dropdown:** If matches exist, we render a floating panel above the text area displaying the matching shipment IDs.
5. **Keyboard & Click Autocomplete:**
   - **Keyboard:** The user can press `ArrowUp` or `ArrowDown` to navigate, `Escape` to close the dropdown, and `Enter` to auto-complete.
   - **Click:** The user can click any item (captured via `onMouseDown` to bypass focus-blur triggers) to select it.
   - **Replacement:** The text area text is replaced with `/shipment [TRACKING_ID] `, and the text cursor is repositioned at the end of the text.


---

## 📁 AI Feature: Document Q&A (RAG)

To enable operational teams to quickly query dealing files, confirmations, or layout PDFs without leaving their channel context, we implemented a complete RAG (Retrieval-Augmented Generation) pipeline:
1. **Document Management:** Users can upload `.txt`, `.md`, or `.pdf` files up to 10MB inside the Document Q&A panel. These files are securely processed on the backend.
2. **Text Chunking:** Extracted document text is split into 500-character overlapping chunks to preserve semantic integrity.
3. **Embeddings & Vector Search:** Chunks are translated to 768-dimensional embeddings using Google's `gemini-embedding-001` model.
4. **Resilient Vector Fallback:** Chunks and embeddings are stored in PostgreSQL (`rag_documents` and `rag_document_chunks` tables). If `pgvector` is not available in the database, the backend automatically falls back to storing vector arrays as standard `JSONB` rows and executes pure Python cosine similarity calculations, ensuring a seamless fallback deployment path.
5. **Interactive Assistant:** A dedicated side panel allows users to chat with their documents. The pipeline retrieves the most relevant chunks, prompts `gemini-3.5-flash` with the context, and displays responses inline with source citations and similarity scores.

---

## 🚪 Channel Management: Leave Channel Button

To give users full control over their channel memberships, we added a secure channel exit mechanism:
1. **Header Entrypoint:** A clean `🚪 Leave Channel` button is added to the channel header, dynamically rendered only for channels in which the current user is active (`is_member === true`).
2. **Double-Confirmation Modal:** Clicking the button triggers a glassmorphic confirmation modal asking: *"Are you sure you want to leave #{channelName}?"*, protecting users from accidental clicks.
3. **Reactive State Sync:** On confirming, the client calls `DELETE /api/channels/{channel_id}/leave` on the backend (deleting the SQL membership record), emits a `CHANNEL_LEFT_EVENT` via the window event bus to refresh the sidebar channels list, and redirects the active viewport back to `/chat`.

---

## 🎨 Message Alignment & Bubble Correction

To ensure clear readability and flow, we revamped the message bubble styling and layout:
1. **Visual Distinction:** Current user messages are right-aligned (`flex-direction: row-reverse`) with avatars placed on the right. Metadata fields (sender name, timestamp) are aligned to the right, and the message text bubble is styled in a glassmorphic brand blue tint (`hsla(222, 78%, 52%, 0.15)`) with a custom bubble notch.
2. **Received Messages:** Colleagues' messages remain left-aligned with a dark raised container backdrop (`var(--bg-raised)`).

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