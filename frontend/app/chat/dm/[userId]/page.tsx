'use client';

import { useEffect, useRef, useState } from 'react';
import { sendDM, fetchUser, fetchUserPresence, getUserId, searchMessages } from '@/lib/api';
import { useMessages } from '@/hooks/useMessages';
import { useSingleWSEvent } from '@/hooks/useWebSocket';
import { emitDMSent } from '@/lib/events';
import MessageRow from '@/components/MessageRow';
import MessageInput from '@/components/MessageInput';
import TypingIndicator from '@/components/TypingIndicator';
import ThreadDrawer from '@/components/ThreadDrawer';
import type { User, PresenceStatus, WSPresenceChangeEvent, Message } from '@/types';

interface PageProps {
  params: { userId: string };
}

export default function DMPage({ params }: PageProps) {
  const { userId } = params;
  const { messages, hasMore, loading, typingUsers, loadMore, addMessage, removeMessage, updateMessage } =
    useMessages({ dmUserId: userId });
  const bottomRef = useRef<HTMLDivElement>(null);

  const [profile, setProfile] = useState<User | null>(null);
  const [status, setStatus] = useState<PresenceStatus>('offline');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeThread, setActiveThread] = useState<Message | null>(null);
  const currentUserId = getUserId();

  useEffect(() => {
    fetchUser(userId)
      .then(setProfile)
      .catch(() => {});

    fetchUserPresence(userId)
      .then((res) => setStatus(res.status))
      .catch(() => {});

    // Reset search on channel swap
    setSearchQuery('');
    setSearching(false);
    setSearchResults([]);
    setActiveThread(null);
  }, [userId]);

  useSingleWSEvent('presence_change', (event) => {
    const e = event as WSPresenceChangeEvent;
    if (e.user_id === userId) {
      setStatus(e.status);
    }
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = async (content: string) => {
    const msg = await sendDM(userId, content);
    addMessage(msg);
    emitDMSent(userId);
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearching(false);
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results = await searchMessages(query, undefined, userId); // Pass undefined for channelId, userId for dmUserId
      setSearchResults(results);
    } catch {
      // ignore
    }
  };

  const displayName = profile?.display_name ?? profile?.username ?? '...';

  return (
    <div style={{ display: 'flex', flex: 1, height: '100%', overflow: 'hidden', width: '100%' }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        height: '100%',
        overflow: 'hidden',
        borderRight: activeThread ? '1px solid var(--border-subtle)' : 'none'
      }}>
        <div className="channel-header">
          <span style={{ fontSize: '1.1rem' }}>✉</span>
          <div className="channel-header-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span>{displayName}</span>
            <span style={{
              fontWeight: 400,
              fontSize: '0.8125rem',
              color: 'var(--text-muted)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: 'var(--bg-overlay)',
              padding: '2px 8px',
              borderRadius: 'var(--radius-full)',
              border: '1px solid var(--border-subtle)'
            }}>
              <span
                style={{
                  display: 'inline-block',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: status === 'online' ? 'var(--presence-online)' : status === 'away' ? 'var(--presence-away)' : 'var(--presence-offline)',
                }}
              />
              {status}
            </span>
          </div>

          <div className="channel-header-actions">
            {/* 🔍 Search Input */}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                type="text"
                className="input"
                style={{
                  width: '180px',
                  padding: 'var(--space-1) 24px var(--space-1) var(--space-3)',
                  fontSize: '0.8125rem',
                  height: '32px',
                  marginRight: 'var(--space-2)'
                }}
                placeholder="Search chat…"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
              />
              {searchQuery && (
                <button
                  onClick={() => handleSearch('')}
                  style={{
                    position: 'absolute',
                    right: '16px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: '0.875rem'
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="messages-container">
          {hasMore && (
            <div style={{ textAlign: 'center', paddingBottom: 'var(--space-4)' }}>
              <button className="btn btn-ghost btn-sm" onClick={loadMore} disabled={loading}>
                {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Load older'}
              </button>
            </div>
          )}

          {(searching ? searchResults : messages).map((msg, idx) => {
            const prevMsg = (searching ? searchResults : messages)[idx - 1];
            const currDay = new Date(msg.created_at).toDateString();
            const prevDay = prevMsg ? new Date(prevMsg.created_at).toDateString() : '';

            let msgPresence: PresenceStatus = 'offline';
            if (msg.sender_id === currentUserId) {
              msgPresence = 'online';
            } else if (msg.sender_id === userId) {
              msgPresence = status;
            }

            return (
              <MessageRow
                key={msg.id}
                message={msg}
                showDate={currDay !== prevDay}
                presence={msgPresence}
                onDeleted={searching ? undefined : removeMessage}
                onEdited={searching ? undefined : updateMessage}
                onReplyInThread={setActiveThread}
              />
            );
          })}

          {searching && searchResults.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-12) 0' }}>
              <p style={{ fontSize: '1rem', marginBottom: 'var(--space-2)' }}>No matching messages</p>
              <p style={{ fontSize: '0.875rem' }}>No direct messages contain "{searchQuery}"</p>
            </div>
          )}

          {messages.length === 0 && !loading && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-12) 0' }}>
              <p>Start a conversation with {displayName}</p>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <TypingIndicator typingUsers={typingUsers} userNames={profile ? { [profile.id]: profile.display_name ?? profile.username } : {}} />
        <MessageInput dmUserId={userId} onSend={handleSend} placeholder={`Message ${displayName}`} />
      </div>

      {/* Thread Drawer */}
      {activeThread && (
        <ThreadDrawer
          parentMessage={activeThread}
          onClose={() => setActiveThread(null)}
          dmUserId={userId}
          dmPartnerName={displayName}
        />
      )}
    </div>
  );
}
