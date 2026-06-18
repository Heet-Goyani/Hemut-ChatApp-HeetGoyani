/**
 * Hemut-Chat WebSocket Client
 *
 * Features:
 *   - Singleton ws client (wsClient) shared across the app.
 *   - Exponential backoff reconnection (1s → 30s max).
 *   - Event-based subscription model: on(type, handler) → returns unsubscribe fn.
 *   - Heartbeat ping every 20s to keep presence alive on the server.
 *   - Thread-safe: multiple React components can call on() independently.
 */

import type { WSEvent, WSEventType } from '@/types';

const API_WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8000';

class HemutChatWebSocket {
  private ws: WebSocket | null = null;
  private userId: string | null = null;
  private token: string | null = null;

  private reconnectDelay = 1_000;
  private readonly maxReconnectDelay = 30_000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private shouldReconnect = false;
  private connecting = false;

  /** Map of event type → set of handler functions */
  private handlers: Map<string, Set<(event: WSEvent) => void>> = new Map();

  // ── Public API ───────────────────────────────────────────────────

  connect(userId: string, token: string): void {
    this.userId = userId;
    this.token = token;
    this.shouldReconnect = true;
    this._openConnection();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this._clearTimers();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnected');
      this.ws = null;
    }
  }

  /** Send a raw event object over the WebSocket. */
  send(eventType: string, data: Record<string, unknown> = {}): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: eventType, ...data }));
    }
  }

  /**
   * Subscribe to a WebSocket event type.
   * @returns An unsubscribe function — call it in useEffect cleanup.
   */
  on(
    eventType: WSEventType | '*',
    handler: (event: WSEvent) => void
  ): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  /** Is the WebSocket currently open? */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ── Internal ──────────────────────────────────────────────────────

  private _openConnection(): void {
    if (this.connecting || !this.userId || !this.token) return;
    this.connecting = true;

    const url = `${API_WS_URL}/ws/${this.userId}?token=${encodeURIComponent(this.token)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.connecting = false;
      this.reconnectDelay = 1_000; // reset backoff
      this._startHeartbeat();
      this._dispatch({ type: 'connected' } as WSEvent);
    };

    this.ws.onmessage = (raw: MessageEvent) => {
      this._handleMessage(raw);
    };

    this.ws.onerror = () => {
      // onclose will also fire — handle reconnection there
      this.connecting = false;
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.connecting = false;
      this._clearTimers();

      // Code 4001 = unauthorized — don't retry
      if (event.code === 4001 || !this.shouldReconnect) return;

      this._scheduleReconnect();
    };
  }

  private _handleMessage(raw: MessageEvent): void {
    try {
      const event = JSON.parse(raw.data as string) as WSEvent;
      this._dispatch(event);
    } catch {
      // Ignore malformed messages
    }
  }

  private _dispatch(event: WSEvent): void {
    // Fire specific handlers
    this.handlers.get(event.type)?.forEach((h) => {
      try { h(event); } catch { /* never crash the WS */ }
    });
    // Fire wildcard handlers
    this.handlers.get('*')?.forEach((h) => {
      try { h(event); } catch { /* never crash the WS */ }
    });
  }

  private _scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        this.maxReconnectDelay
      );
      this._openConnection();
    }, this.reconnectDelay);
  }

  private _startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send('heartbeat');
    }, 20_000);
  }

  private _clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

// ── Singleton export ──────────────────────────────────────────────
export const wsClient = new HemutChatWebSocket();
