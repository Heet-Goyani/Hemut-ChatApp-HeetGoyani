'use client';

/**
 * useMessages — manages message state for a channel or DM view.
 *
 * Features:
 *  - Initial fetch from REST API with cursor-based pagination.
 *  - "Load more" (older messages) via next_cursor.
 *  - Real-time: new_message, message_edited, message_deleted from WebSocket.
 *  - Typing indicator tracking.
 *  - De-duplication by message ID.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSingleWSEvent } from '@/hooks/useWebSocket';
import {
  fetchChannelMessages,
  fetchDMHistory,
  getUserId,
} from '@/lib/api';
import type {
  Message,
  WSNewMessageEvent,
  WSMessageEditedEvent,
  WSMessageDeletedEvent,
  WSTypingEvent,
} from '@/types';

interface UseMessagesOptions {
  channelId?: string;
  dmUserId?: string;
}

export function useMessages({ channelId, dmUserId }: UseMessagesOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const currentUserId = getUserId();

  // ── Initial load ─────────────────────────────────────────────────
  useEffect(() => {
    setMessages([]);
    setHasMore(false);
    setNextCursor(null);

    if (!channelId && !dmUserId) return;

    let cancelled = false;
    setLoading(true);

    const load = channelId
      ? fetchChannelMessages(channelId)
      : fetchDMHistory(dmUserId!);

    load
      .then((data) => {
        if (cancelled) return;
        setMessages(data.messages);
        setHasMore(data.has_more);
        setNextCursor(data.next_cursor ?? null);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [channelId, dmUserId]);

  // ── Load more (older messages) ────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || loading) return;
    setLoading(true);
    try {
      const data = channelId
        ? await fetchChannelMessages(channelId, nextCursor)
        : await fetchDMHistory(dmUserId!, nextCursor);

      setMessages((prev) => {
        // Prepend older messages, deduplicate
        const ids = new Set(prev.map((m) => m.id));
        const newMsgs = data.messages.filter((m) => !ids.has(m.id));
        return [...newMsgs, ...prev];
      });
      setHasMore(data.has_more);
      setNextCursor(data.next_cursor ?? null);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [hasMore, nextCursor, loading, channelId, dmUserId]);

  // ── WebSocket: new message ────────────────────────────────────────
  useSingleWSEvent('new_message', (event) => {
    const e = event as WSNewMessageEvent;

    // Only process messages for this view
    const isMyChannel = channelId && e.channel_id === channelId;
    const isMyDM =
      dmUserId &&
      !e.channel_id &&
      e.is_dm &&
      (e.message.sender_id === dmUserId ||
        e.message.recipient_id === dmUserId ||
        e.message.sender_id === currentUserId);

    if (!isMyChannel && !isMyDM) return;

    setMessages((prev) => {
      if (prev.find((m) => m.id === e.message.id)) return prev;
      return [...prev, e.message];
    });
  });

  // ── WebSocket: message edited ─────────────────────────────────────
  useSingleWSEvent('message_edited', (event) => {
    const e = event as WSMessageEditedEvent;
    const isMyChannel = channelId && e.channel_id === channelId;
    const isMyDM =
      dmUserId &&
      !e.channel_id &&
      e.is_dm &&
      (e.message.sender_id === dmUserId ||
        e.message.recipient_id === dmUserId ||
        e.message.sender_id === currentUserId);

    if (!isMyChannel && !isMyDM) return;

    setMessages((prev) =>
      prev.map((m) => (m.id === e.message.id ? e.message : m))
    );
  });

  // ── WebSocket: message deleted ────────────────────────────────────
  useSingleWSEvent('message_deleted', (event) => {
    const e = event as WSMessageDeletedEvent;
    const isMyChannel = channelId && e.channel_id === channelId;
    const isMyDM =
      dmUserId &&
      !e.channel_id &&
      e.is_dm;

    if (!isMyChannel && !isMyDM) return;

    setMessages((prev) => prev.filter((m) => m.id !== e.message_id));
  });

  // ── WebSocket: typing indicators ──────────────────────────────────
  useSingleWSEvent('typing_start', (event) => {
    const e = event as WSTypingEvent;
    if (e.user_id === currentUserId) return;
    const isMyChannel = channelId && e.channel_id === channelId;
    const isMyDM = dmUserId && !e.channel_id && e.is_dm && e.user_id === dmUserId;

    if (!isMyChannel && !isMyDM) return;

    setTypingUsers((prev) => new Set(prev).add(e.user_id));

    // Auto-clear after 4s if no typing_stop
    clearTimeout(typingTimers.current[e.user_id]);
    typingTimers.current[e.user_id] = setTimeout(() => {
      setTypingUsers((prev) => {
        const next = new Set(prev);
        next.delete(e.user_id);
        return next;
      });
    }, 4000);
  });

  useSingleWSEvent('typing_stop', (event) => {
    const e = event as WSTypingEvent;
    if (e.user_id === currentUserId) return;
    const isMyChannel = channelId && e.channel_id === channelId;
    const isMyDM = dmUserId && !e.channel_id && e.is_dm && e.user_id === dmUserId;

    if (!isMyChannel && !isMyDM) return;

    clearTimeout(typingTimers.current[e.user_id]);
    setTypingUsers((prev) => {
      const next = new Set(prev);
      next.delete(e.user_id);
      return next;
    });
  });

  // ── Optimistic add (for own messages sent via fetch) ───────────────
  const addMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      if (prev.find((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  const removeMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const updateMessage = useCallback((updated: Message) => {
    setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  }, []);

  return {
    messages,
    hasMore,
    loading,
    typingUsers,
    loadMore,
    addMessage,
    removeMessage,
    updateMessage,
  };
}
