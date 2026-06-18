# Hemut-Chat — Logistics Workspace (Frontend Client)

This directory houses the Next.js 14 Single-Page Application (SPA) frontend for **Hemut-Chat**, a real-time logistics communication dashboard. The application is written in **TypeScript** and uses vanilla CSS custom variables for a sleek, glassmorphic dark-mode interface.

---

## 🎨 Design System & UX Principles

The client is designed with modern dashboard aesthetics:
* **Glassmorphism:** Visual components utilize transparent backdrops with frosted filters (`backdrop-filter: blur()`), subtle border strokes, and dark gradient backdrops.
* **Micro-animations:** Interactive components features smooth transitions on hover, layout transformations, and lift translations for cards.
* **Responsive Layouts:** The UI adapts seamlessly between wide desktop formats (displaying the Sidebar, Main Feed, Thread Drawer, and AI Panel side-by-side) and compact viewports.

---

## 🏗️ Key Technical Implementations

### 1. Zero-Fetch Authentication (Raw XHR)
Per the architectural design constraints, the login, registration, and user profile update forms in the client bypass `fetch` or third-party libraries (like Axios). Instead, they are built entirely on top of a raw `XMLHttpRequest` wrapper inside [`lib/xhr.ts`](file:///d:/Job%20Hunt/Assignments%20/Hemut/logichat/frontend/lib/xhr.ts) to handle multi-part forms and retrieve server-issued JWT tokens.

### 2. Robust WebSocket Lifecycle
The client implements a custom WebSocket client class ([`lib/websocket.ts`](file:///d:/Job%20Hunt/Assignments/Hemut/logichat/frontend/lib/websocket.ts)) designed to survive unstable networks:
* **Reconnections:** Automatically triggers exponential back-off retries on unexpected disconnects.
* **Heartbeat Ping:** Sends periodic pings to keep the connection open and prevent server timeouts.
* **Message Replays:** Replays client-side updates and queries state once reconnected to ensure no missed real-time events.

### 3. Asynchronous AI "Catch Me Up" Drawer
The AI summarizer panel ([`components/AISummaryPanel.tsx`](file:///d:/Job%20Hunt/Assignments/Hemut/logichat/frontend/components/AISummaryPanel.tsx)) acts as a slide-out drawer containing timeframe cards:
* **Timeframe Options:** Users choose between **Unread Chat**, **Last 24 Hours**, and **Last 7 Days**.
* **Unread Calculation:** Computes locally from the channel's `last_read_at` value. The "Unread Chat" option is disabled if the user has no unread messages.
* **Stateless Triggers:** When selected, triggers the backend generator and listens to the active WebSocket channel for the resulting `ai_response` event, rendering a beautiful schema-validated summary without locking the client interface.

### 4. Interactive `/shipment` Autocomplete Suggestion Dropdown
The message input area ([`components/MessageInput.tsx`](file:///d:/Job%20Hunt/Assignments/Hemut/logichat/frontend/components/MessageInput.tsx)) features a real-time predictive shipment selector:
* **Fuzzy Filtering:** Triggers as the user types `/shipment` commands, query-matching against cached active tracking IDs (e.g. `SHIP-2024-001`).
* **Keyboard Navigation:** Fully supports choosing items via `ArrowUp`/`ArrowDown`, confirming via `Enter`, and dismissing via `Escape`.
* **Mouse Interactions:** Leverages `onMouseDown` to intercept selections before focus-blur triggers dismiss the panel.

### 5. Multi-format File Attachments & Uploads
Users can upload files up to 10MB in channels, direct messages, and thread reply drawers:
* **Local Storing:** Integrated paperclip triggers route files to the backend for storage and serving.
* **Dynamic Cards:** Rendered inline as animated images or downloadeable glassmorphic files card inside the chat stream ([`components/MessageRow.tsx`](file:///d:/Job%20Hunt/Assignments/Hemut/logichat/frontend/components/MessageRow.tsx)).

---

## 📂 Directory Structure

```
frontend/
├── app/                  # Next.js 14 App Router pages (Auth, Channels, DMs, Shipments)
├── components/           # Reusable UI components
│   ├── AISummaryPanel.tsx# Catch me up drawer & timeframe cards
│   ├── Avatar.tsx        # Profile picture with green presence status dot
│   ├── MessageInput.tsx  # Input bar, file paperclip, and /shipment autocomplete
│   ├── MessageRow.tsx    # Message cards, files preview, and shipment info link cards
│   ├── Sidebar.tsx       # Sidebar, user profile footer, and DM directory dialog
│   ├── ThreadDrawer.tsx  # Sliding sub-thread replies view
│   └── TypingIndicator.tsx# "X is typing..." animation
├── hooks/                # React state & subscription hooks
│   ├── useMessages.ts    # Feeds state, message editing, thread replies updates
│   ├── usePresence.ts    # Globally maps online/away/offline states
│   └── useWebSocket.ts   # Subscribes pages to active WebSocket connections
├── lib/                  # Utilities & API wrappers
│   ├── api.ts            # Fetch client routing backend REST endpoints
│   ├── events.ts         # Global event emitters
│   ├── websocket.ts      # WebSocket connection recovery & heartbeat management
│   └── xhr.ts            # Pure XHR module for authentication
└── types/                # Shared TypeScript models
    └── index.ts          # Core interfaces & structures
```

---

## 🚀 Running the Frontend

Ensure you have [Node.js](https://nodejs.org) installed on your local environment.

### 1. Configuration
Create a `.env.local` file in the frontend root directory to direct API and WebSocket calls to the backend server:
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
```

### 2. Start Development Server
```bash
# Install package dependencies
npm install

# Run the development server on http://localhost:3000
npm run dev
```
