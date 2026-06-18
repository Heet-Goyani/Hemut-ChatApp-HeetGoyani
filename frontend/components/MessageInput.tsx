'use client';

import { useState, useRef, useCallback } from 'react';
import { wsClient } from '@/lib/websocket';
import { uploadFile } from '@/lib/api';

interface UploadedFile {
  url: string;
  name: string;
  type: string;
  size: number;
}

interface MessageInputProps {
  channelId?: string;
  dmUserId?: string;
  placeholder?: string;
  onSend: (content: string, metadata?: Record<string, any>) => Promise<void>;
}

const TYPING_DEBOUNCE = 2000;

export default function MessageInput({ channelId, dmUserId, placeholder, onSend }: MessageInputProps) {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTyping = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      setUploadError('File is too large. Maximum size is 10MB.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const result = await uploadFile(file);
      setUploadedFile(result);
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload file');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeUploadedFile = () => {
    setUploadedFile(null);
    setUploadError(null);
  };

  const handleSend = async () => {
    const textContent = value.trim();
    if ((!textContent && !uploadedFile) || sending || uploading) return;

    // Use filename as message text if no other content was typed
    const content = textContent || (uploadedFile ? uploadedFile.name : '');

    setValue('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    // Stop typing indicator immediately
    sendTypingStop();
    if (typingTimer.current) clearTimeout(typingTimer.current);

    setSending(true);
    try {
      const metadata: Record<string, any> = {};
      if (uploadedFile) {
        metadata.attachment = uploadedFile;
      }
      await onSend(content, metadata);
      setUploadedFile(null);
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

  const isSendDisabled = (!value.trim() && !uploadedFile) || sending || uploading;

  return (
    <div className="message-input-area" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {/* Upload Error Banner */}
      {uploadError && (
        <div className="upload-error-banner" style={{ justifyContent: 'space-between', width: '100%' }}>
          <span style={{ flex: 1 }}>⚠️ {uploadError}</span>
          <button
            onClick={() => setUploadError(null)}
            className="upload-error-close"
          >
            ✕
          </button>
        </div>
      )}

      {/* Uploading indicator */}
      {uploading && (
        <div className="upload-preview-card uploading">
          <span className="spinner" style={{ width: 14, height: 14 }} />
          <span>Uploading file…</span>
        </div>
      )}

      {/* Uploaded file preview */}
      {uploadedFile && (
        <div className="upload-preview-card">
          <span style={{ fontSize: '1.25rem' }}>
            {uploadedFile.type?.startsWith('image/') ? '🖼️' : '📄'}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{uploadedFile.name}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              ({(uploadedFile.size / 1024).toFixed(1)} KB)
            </span>
          </div>
          <button
            onClick={removeUploadedFile}
            className="upload-preview-remove"
            title="Remove file"
          >
            ✕
          </button>
        </div>
      )}

      <div className="message-input-wrapper">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending || uploading}
          className="btn btn-ghost"
          style={{
            flexShrink: 0,
            padding: '6px 12px',
            fontSize: '1.1rem',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '34px'
          }}
          title="Attach file (Max 10MB)"
        >
          📎
        </button>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />

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
          disabled={isSendDisabled}
          style={{ flexShrink: 0, padding: '6px 14px' }}
        >
          {sending ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '↑'}
        </button>
      </div>
    </div>
  );
}
