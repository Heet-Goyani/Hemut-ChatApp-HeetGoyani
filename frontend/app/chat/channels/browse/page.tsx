'use client';

import { useEffect, useState } from 'react';
import { fetchChannels, joinChannel } from '@/lib/api';
import { emitChannelJoined } from '@/lib/events';
import { useRouter } from 'next/navigation';
import type { Channel } from '@/types';

export default function BrowseChannelsPage() {
  const router = useRouter();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState<string | null>(null);

  useEffect(() => {
    fetchChannels()
      .then(setChannels)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleJoin = async (ch: Channel) => {
    if (ch.is_member) {
      router.push(`/chat/channels/${ch.id}`);
      return;
    }
    setJoining(ch.id);
    try {
      await joinChannel(ch.id);
      // Notify the Sidebar to re-fetch — no page refresh needed
      emitChannelJoined(ch.id);
      router.push(`/chat/channels/${ch.id}`);
    } catch { /* ignore */ }
    finally { setJoining(null); }
  };

  return (
    <>
      <div className="channel-header">
        <span className="channel-header-title">Browse Channels</span>
      </div>

      <div style={{ padding: 'var(--space-6)', overflowY: 'auto', flex: 1 }}>
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-12)' }}>
            <span className="spinner" style={{ width: 32, height: 32 }} />
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {channels.map((ch) => (
            <div key={ch.id} className="shipment-card" style={{ gridTemplateColumns: '1fr auto' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>#</span>
                  <span style={{ fontWeight: 600 }}>{ch.name}</span>
                  {ch.is_private && (
                    <span className="badge badge-warning">Private</span>
                  )}
                  {ch.is_member && (
                    <span className="badge badge-success">Joined</span>
                  )}
                </div>
                {ch.description && (
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{ch.description}</p>
                )}
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
                  {ch.member_count} members
                </p>
              </div>
              <button
                className={`btn ${ch.is_member ? 'btn-ghost' : 'btn-primary'} btn-sm`}
                onClick={() => handleJoin(ch)}
                disabled={joining === ch.id || ch.is_private}
              >
                {joining === ch.id ? (
                  <span className="spinner" style={{ width: 14, height: 14 }} />
                ) : ch.is_member ? 'Open' : 'Join'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
