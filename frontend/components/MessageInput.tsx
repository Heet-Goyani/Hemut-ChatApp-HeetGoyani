'use client';

import { useState, useRef, useCallback } from 'react';
import { wsClient } from '@/lib/websocket';

interface MessageInputProps {
  channelId?: string;
  dmUserId?: string;
  placeholder?: string;
  onSend: (content: string) => Promise<void>;
}

const TYPING_DEBOUNCE = 2000;

export default function MessageInput({ channelId, dmUserId, placeholder, onSend }: MessageInputProps) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTyping = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sendTypingStart = useCallback(() => {
    if (isTyping.current) return;
    if (channelId) {
      isTyping.current = true;
      wsClient.send('typing_start', { channel_id: channelId });
    } else if (dmUserId) {
      isTyping.current = true;
      wsClient.send('typing_start', { dm_user_id: dmUserId });
    }
  }, [channelId, dmUserId]);

  const sendTypingStop = useCallback(() => {
    if (!isTyping.current) return;
    if (channelId) {
      isTyping.current = false;
      wsClient.send('typing_stop', { channel_id: channelId });
    } else if (dmUserId) {
      isTyping.current = false;
      wsClient.send('typing_stop', { dm_user_id: dmUserId });
    }
  }, [channelId, dmUserId]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);

    // Auto-resize textarea
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }

    // Typing indicator debounce
    sendTypingStart();
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(sendTypingStop, TYPING_DEBOUNCE);
  };

  const handleSend = async () => {
    const content = value.trim();
    if (!content || sending) return;

    setValue('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    // Stop typing indicator immediately
    sendTypingStop();
    if (typingTimer.current) clearTimeout(typingTimer.current);

    setSending(true);
    try {
      await onSend(content);
    } catch { /* ignore — optimistic UI handles rollback */ }
    finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="message-input-area">
      <div className="message-input-wrapper">
        <textarea
          ref={textareaRef}
          className="message-input-field"
          placeholder={placeholder ?? 'Type a message… (Shift+Enter for new line)'}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={sending}
          id="message-input"
        />
        <button
          id="btn-send-message"
          className="btn btn-primary btn-sm"
          onClick={handleSend}
          disabled={!value.trim() || sending}
          style={{ flexShrink: 0, padding: '6px 14px' }}
        >
          {sending ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '↑'}
        </button>
      </div>
    </div>
  );
}
