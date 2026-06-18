'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { fetchChannel, fetchChannelMembers, sendChannelMessage, triggerAISummary, searchMessages, markChannelAsRead } from '@/lib/api';
import { useMessages } from '@/hooks/useMessages';
import { usePresence } from '@/hooks/usePresence';
import { useSingleWSEvent } from '@/hooks/useWebSocket';
import MessageRow from '@/components/MessageRow';
import MessageInput from '@/components/MessageInput';
import TypingIndicator from '@/components/TypingIndicator';
import AISummaryPanel from '@/components/AISummaryPanel';
import ThreadDrawer from '@/components/ThreadDrawer';
import RAGPanel from '@/components/RAGPanel';
import type { Channel, ChannelMember, AISummary, WSAIResponseEvent, Message } from '@/types';

interface PageProps {
  params: { channelId: string };
}

export default function ChannelPage({ params }: PageProps) {
  const { channelId } = params;
  const [channel, setChannel] = useState<Channel | null>(null);
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [showAI, setShowAI] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState<AISummary | null>(null);
  const [lastReadAt, setLastReadAt] = useState<string | null>(null);
  const [aiLoadingText, setAiLoadingText] = useState('Analyzing channel activity…');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeThread, setActiveThread] = useState<Message | null>(null);
  const [showRAG, setShowRAG] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, hasMore, loading, typingUsers, loadMore, addMessage, removeMessage, updateMessage } =
    useMessages({ channelId });
  const { presence, getPresence } = usePresence(channelId);

  // Build user name map for typing indicator
  const memberNames: Record<string, string> = {};
  members.forEach((m) => { memberNames[m.id] = m.display_name ?? m.username; });

  // Fetch channel + members
  useEffect(() => {
    setChannel(null);
    setLastReadAt(null);
    fetchChannel(channelId)
      .then((ch) => {
        setChannel(ch);
        if (ch.last_read_at) {
          setLastReadAt(ch.last_read_at);
        }
        // Mark as read on the backend
        markChannelAsRead(channelId).catch(() => {});
      })
      .catch(() => {});
    fetchChannelMembers(channelId).then(setMembers).catch(() => {});
    // Reset search
    setSearchQuery('');
    setSearching(false);
    setSearchResults([]);
    setActiveThread(null);
    setShowRAG(false);
  }, [channelId]);

  // Calculate unread count since lastReadAt
  const unreadCount = useMemo(() => {
    if (!lastReadAt) return 0;
    const markerDate = new Date(lastReadAt);
    return messages.filter((m) => new Date(m.created_at) > markerDate).length;
  }, [messages, lastReadAt]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Receive AI summary via WebSocket
  useSingleWSEvent('ai_response', (event) => {
    const e = event as WSAIResponseEvent;
    if (e.channel_id !== channelId) return;
    setAiSummary(e.summary);
    setAiLoading(false);
    setShowAI(true);
  });

  const handleSend = async (content: string, metadata?: Record<string, any>) => {
    const msg = await sendChannelMessage(channelId, content, 'text', metadata);
    addMessage(msg);
  };

  const handleCatchMeUp = () => {
    setShowAI(true);
    setAiLoading(false);
    setAiSummary(null);
    setShowRAG(false);
  };

  const handleTriggerSummary = async (type: 'unread' | 'hours', hoursValue?: number) => {
    setAiLoading(true);
    setAiSummary(null);
    
    if (type === 'unread') {
      setAiLoadingText('Analyzing unread messages…');
      await triggerAISummary(channelId, 24, lastReadAt || undefined).catch(() => {
        setAiLoading(false);
      });
    } else {
      const hrs = hoursValue ?? 24;
      setAiLoadingText(`Analyzing the last ${hrs === 168 ? '7 days' : '24 hours'} of activity…`);
      await triggerAISummary(channelId, hrs).catch(() => {
        setAiLoading(false);
      });
    }
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
      const results = await searchMessages(query, channelId);
      setSearchResults(results);
    } catch {
      // ignore
    }
  };

  const prevDateRef = useRef<string>('');

  return (
    <div style={{ display: 'flex', flex: 1, height: '100%', overflow: 'hidden', width: '100%' }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        height: '100%',
        overflow: 'hidden',
        borderRight: (activeThread || showRAG) ? '1px solid var(--border-subtle)' : 'none'
      }}>
        {/* Channel header */}
        <div className="channel-header">
          <span style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>#</span>
          <div className="channel-header-title">
            <span>{channel?.name ?? '...'}</span>
            {channel?.description && (
              <span style={{ fontWeight: 400, fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                — {channel.description}
              </span>
            )}
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
                placeholder="Search in channel…"
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

            {/* Member count */}
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginRight: 'var(--space-2)' }}>
              {channel?.member_count ?? 0} members
            </span>

            {/* 📁 Document Q&A */}
            <button
              id="btn-document-qa"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setShowRAG(!showRAG);
                setActiveThread(null);
                setShowAI(false);
              }}
              style={{
                background: showRAG ? 'hsla(222, 78%, 52%, 0.15)' : 'hsla(222, 78%, 52%, 0.08)',
                color: 'var(--brand-400)',
                border: '1px solid hsla(222, 78%, 52%, 0.2)',
                marginRight: 'var(--space-2)'
              }}
              title="Upload documents and ask questions"
            >
              📁 Document Q&A
            </button>

            {/* ✨ Catch me up */}
            <button
              id="btn-catch-me-up"
              className="btn btn-ghost btn-sm"
              onClick={handleCatchMeUp}
              disabled={aiLoading}
              title="AI: Catch me up on the last 24 hours"
              style={{
                background: 'hsla(222, 78%, 52%, 0.1)',
                color: 'var(--brand-400)',
                border: '1px solid hsla(222, 78%, 52%, 0.2)',
              }}
            >
              {aiLoading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '✨'}
              Catch me up
            </button>
          </div>
        </div>

        {/* AI Summary panel */}
        {showAI && (
          <AISummaryPanel
            summary={aiSummary}
            loading={aiLoading}
            unreadCount={unreadCount}
            onTriggerSummary={handleTriggerSummary}
            loadingText={aiLoadingText}
            onClose={() => { setShowAI(false); setAiSummary(null); }}
          />
        )}

        {/* Messages */}
        <div className="messages-container">
          {/* Load more */}
          {hasMore && (
            <div style={{ textAlign: 'center', paddingBottom: 'var(--space-4)' }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={loadMore}
                disabled={loading}
              >
                {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Load older messages'}
              </button>
            </div>
          )}

          {/* Message list */}
          {(searching ? searchResults : messages).map((msg, idx) => {
            const prevMsg = (searching ? searchResults : messages)[idx - 1];
            const currDay = new Date(msg.created_at).toDateString();
            const prevDay = prevMsg ? new Date(prevMsg.created_at).toDateString() : '';
            const showDate = currDay !== prevDay;

            return (
              <MessageRow
                key={msg.id}
                message={msg}
                presence={msg.sender_id ? getPresence(msg.sender_id) : 'offline'}
                showDate={showDate}
                onDeleted={searching ? undefined : removeMessage}
                onEdited={searching ? undefined : updateMessage}
                onReplyInThread={(m) => {
                  setActiveThread(m);
                  setShowRAG(false);
                  setShowAI(false);
                }}
              />
            );
          })}

          {searching && searchResults.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-12) 0' }}>
              <p style={{ fontSize: '1rem', marginBottom: 'var(--space-2)' }}>No matching messages</p>
              <p style={{ fontSize: '0.875rem' }}>No messages in #{channel?.name} contain "{searchQuery}"</p>
            </div>
          )}

          {messages.length === 0 && !loading && (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-12) 0' }}>
              <p style={{ fontSize: '1rem', marginBottom: 'var(--space-2)' }}>No messages yet</p>
              <p style={{ fontSize: '0.875rem' }}>Be the first to say something in #{channel?.name}!</p>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Typing indicator */}
        <TypingIndicator typingUsers={typingUsers} userNames={memberNames} />

        {/* Message input */}
        <MessageInput
          channelId={channelId}
          placeholder={`Message #${channel?.name ?? '...'}`}
          onSend={handleSend}
        />
      </div>

      {/* Thread Drawer */}
      {activeThread && (
        <ThreadDrawer
          parentMessage={activeThread}
          onClose={() => setActiveThread(null)}
          channelId={channelId}
          channelName={channel?.name}
        />
      )}

      {/* RAG Drawer */}
      {showRAG && (
        <RAGPanel
          channelId={channelId}
          channelName={channel?.name}
          onClose={() => setShowRAG(false)}
        />
      )}
    </div>
  );
}
