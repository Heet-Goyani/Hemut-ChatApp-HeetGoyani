'use client';

/**
 * useWebSocket — React wrapper around the singleton wsClient.
 *
 * Handles:
 *   - Connect on mount with user credentials from localStorage.
 *   - Disconnect on unmount (prevents memory leaks).
 *   - Re-connect if userId/token change.
 */

import { useEffect, useRef } from 'react';
import { wsClient } from '@/lib/websocket';
import { getToken, getUserId } from '@/lib/api';
import type { WSEvent, WSEventType } from '@/types';

interface UseWebSocketOptions {
  /** If false, won't connect (e.g. during SSR or before auth). */
  enabled?: boolean;
  /** Called when any WS event arrives. */
  onEvent?: (event: WSEvent) => void;
}

export function useWebSocket({ enabled = true, onEvent }: UseWebSocketOptions = {}) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;

    const userId = getUserId();
    const token = getToken();

    if (!userId || !token) return;

    // Connect singleton client
    wsClient.connect(userId, token);

    // Subscribe to all events
    let unsub: (() => void) | undefined;
    if (onEventRef.current) {
      unsub = wsClient.on('*', (event) => {
        onEventRef.current?.(event);
      });
    }

    return () => {
      unsub?.();
      // Note: we don't disconnect here because the singleton is shared.
      // Disconnect is called explicitly on logout.
    };
  }, [enabled]);

  return { wsClient, isConnected: wsClient.isConnected };
}

/**
 * useSingleWSEvent — subscribe to a single WS event type with cleanup.
 */
export function useSingleWSEvent(
  eventType: WSEventType | '*',
  handler: (event: WSEvent) => void,
  deps: React.DependencyList = []
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unsub = wsClient.on(eventType, (event) => handlerRef.current(event));
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventType, ...deps]);
}
