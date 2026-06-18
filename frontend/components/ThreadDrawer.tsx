'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchMessageReplies, getUserId, sendChannelMessage, sendDM } from '@/lib/api';
import { useSingleWSEvent } from '@/hooks/useWebSocket';
import MessageRow from './MessageRow';
import type { Message, WSNewMessageEvent, WSMessageEditedEvent, WSMessageDeletedEvent } from '@/types';

interface ThreadDrawerProps {
  parentMessage: Message;
  onClose: () => void;
  channelId?: string;
  dmUserId?: string;
  channelName?: string;
  dmPartnerName?: string;
}

export default function ThreadDrawer({
  parentMessage,
  onClose,
  channelId,
  dmUserId,
  channelName,
  dmPartnerName,
}: ThreadDrawerProps) {
  const [replies, setReplies] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const repliesBottomRef = useRef<HTMLDivElement>(null);
  const currentUserId = getUserId();

  // Load replies on mount or parent message change
  useEffect(() => {
    setLoading(true);
    setReplies([]);
    fetchMessageReplies(parentMessage.id)
      .then(setReplies)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [parentMessage.id]);

  // Scroll replies to bottom when replies list updates
  useEffect(() => {
    repliesBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [replies.length]);

  // WebSocket support: append new reply
  useSingleWSEvent('new_message', (event) => {
    const e = event as WSNewMessageEvent;
    if (e.message.parent_id === parentMessage.id) {
      setReplies((prev) => {
        if (prev.find((r) => r.id === e.message.id)) return prev;
        return [...prev, e.message];
      });
    }
  });

  // WebSocket support: edit reply
  useSingleWSEvent('message_edited', (event) => {
    const e = event as WSMessageEditedEvent;
    if (e.message.parent_id === parentMessage.id) {
      setReplies((prev) =>
        prev.map((r) => (r.id === e.message.id ? e.message : r))
      );
    }
  });

  // WebSocket support: delete reply
  useSingleWSEvent('message_deleted', (event) => {
    const e = event as WSMessageDeletedEvent;
    // Check if the event matches this parent_id OR if the message is in our replies list
    const isReply = e.parent_id === parentMessage.id || replies.some((r) => r.id === e.message_id);
    if (isReply) {
      setReplies((prev) => prev.filter((r) => r.id !== e.message_id));
    }
  });

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = inputValue.trim();
    if (!content || sending) return;

    setSending(true);
    setInputValue('');
    try {
      let sentMsg: Message;
      if (channelId) {
        sentMsg = await sendChannelMessage(channelId, content, 'text', {}, parentMessage.id);
      } else if (dmUserId) {
        sentMsg = await sendDM(dmUserId, content, parentMessage.id);
      } else {
        throw new Error('Missing channelId or dmUserId context');
      }
      setReplies((prev) => {
        if (prev.find((r) => r.id === sentMsg.id)) return prev;
        return [...prev, sentMsg];
      });
    } catch {
      // rollback or handle error
    } finally {
      setSending(false);
    }
  };

  const parentName = parentMessage.sender?.display_name ?? parentMessage.sender?.username ?? 'Unknown';
  const headerSubtitle = channelName ? `#${channelName}` : dmPartnerName ? `with ${dmPartnerName}` : '';

  return (
    <div className="thread-drawer">
      <div className="thread-drawer-header">
        <div className="thread-drawer-title-area">
          <span className="thread-drawer-title">Thread</span>
          {headerSubtitle && <span className="thread-drawer-subtitle">{headerSubtitle}</span>}
        </div>
        <button className="dm-modal-close" onClick={onClose}>✕</button>
      </div>

      <div className="thread-drawer-body">
        {/* Parent message */}
        <div className="thread-drawer-parent">
          <MessageRow
            message={parentMessage}
            showDate={false}
          />
        </div>

        {/* Replies divider */}
        <div className="thread-drawer-divider">
          {loading ? 'Loading replies...' : `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
        </div>

        {/* Replies list */}
        <div className="thread-drawer-replies">
          {replies.map((reply, idx) => {
            const prevReply = replies[idx - 1];
            const currDay = new Date(reply.created_at).toDateString();
            const prevDay = prevReply ? new Date(prevReply.created_at).toDateString() : '';
            const showDate = currDay !== prevDay;

            return (
              <MessageRow
                key={reply.id}
                message={reply}
                showDate={showDate}
              />
            );
          })}
          <div ref={repliesBottomRef} />
        </div>
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="thread-drawer-input-container">
        <div className="message-input-wrapper">
          <input
            type="text"
            className="input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={`Reply to ${parentName}…`}
            disabled={sending}
            style={{ fontSize: '0.875rem', height: '36px' }}
          />
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={!inputValue.trim() || sending}
            style={{ padding: '6px 12px' }}
          >
            {sending ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
