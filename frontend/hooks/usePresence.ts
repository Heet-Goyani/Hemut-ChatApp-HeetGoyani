'use client';

/**
 * usePresence — tracks real-time presence status for users.
 *
 * Listens to `presence_change` WebSocket events and maintains
 * a local map of user_id → PresenceStatus.
 * Initial presence is fetched from the REST API for a given channel.
 */

import { useEffect, useState, useCallback } from 'react';
import { useSingleWSEvent } from '@/hooks/useWebSocket';
import { fetchChannelPresence } from '@/lib/api';
import type { PresenceStatus, WSPresenceChangeEvent } from '@/types';

type PresenceMap = Record<string, PresenceStatus>;

export function usePresence(channelId?: string) {
  const [presence, setPresence] = useState<PresenceMap>({});

  // Load initial presence for all channel members
  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    fetchChannelPresence(channelId)
      .then((members) => {
        if (cancelled) return;
        const map: PresenceMap = {};
        members.forEach((m) => {
          map[m.user_id] = m.status as PresenceStatus;
        });
        setPresence(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [channelId]);

  // Listen for real-time presence changes
  useSingleWSEvent('presence_change', (event) => {
    const e = event as WSPresenceChangeEvent;
    setPresence((prev) => ({
      ...prev,
      [e.user_id]: e.status,
    }));
  });

  const getPresence = useCallback(
    (userId: string): PresenceStatus => presence[userId] ?? 'offline',
    [presence]
  );

  return { presence, getPresence };
}
