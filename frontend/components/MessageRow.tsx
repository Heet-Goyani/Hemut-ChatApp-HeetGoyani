'use client';

import { useRouter } from 'next/navigation';
import Avatar from '@/components/Avatar';
import { getUserId } from '@/lib/api';
import { deleteMessage, editMessage } from '@/lib/api';
import type { Message, PresenceStatus } from '@/types';
import { useState } from 'react';

const TRACKING_RE = /SHIP-\d{4}-\d{3}/g;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderContent(content: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex
  TRACKING_RE.lastIndex = 0;

  while ((match = TRACKING_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    const tid = match[0];
    parts.push(
      <a
        key={`${tid}-${match.index}`}
        href={`/chat/shipments/${tid}`}
        className="tracking-id"
        title={`View shipment ${tid}`}
        onClick={(e) => e.stopPropagation()}
      >
        {tid}
      </a>
    );
    lastIndex = match.index + tid.length;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts;
}

interface MessageRowProps {
  message: Message;
  presence?: PresenceStatus;
  showDate?: boolean;
  onDeleted?: (id: string) => void;
  onEdited?: (msg: Message) => void;
  onReplyInThread?: (msg: Message) => void;
}

export default function MessageRow({
  message,
  presence,
  showDate,
  onDeleted,
  onEdited,
  onReplyInThread,
}: MessageRowProps) {
  const router = useRouter();
  const currentUserId = getUserId();
  const isOwn = message.sender_id === currentUserId;
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const [hovered, setHovered] = useState(false);

  const sender = message.sender;
  const name = sender?.display_name ?? sender?.username ?? 'Unknown';

  const handleUserClick = () => {
    if (message.sender_id && !isOwn) {
      router.push(`/chat/dm/${message.sender_id}`);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this message?')) return;
    try {
      await deleteMessage(message.id);
      onDeleted?.(message.id);
    } catch { /* ignore */ }
  };

  const handleEdit = async () => {
    if (editValue.trim() === message.content) {
      setEditing(false);
      return;
    }
    try {
      const updated = await editMessage(message.id, editValue.trim());
      onEdited?.(updated);
      setEditing(false);
    } catch { /* ignore */ }
  };

  return (
    <>
      {showDate && (
        <div className="divider-label" style={{ margin: 'var(--space-6) 0 var(--space-4)' }}>
          {formatDate(message.created_at)}
        </div>
      )}
      <div
        className={`message-row ${isOwn ? 'is-own' : ''}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); }}
      >
        <span
          onClick={handleUserClick}
          style={!isOwn ? { cursor: 'pointer' } : undefined}
          title={!isOwn ? `Message ${name}` : undefined}
          className="flex"
        >
          <Avatar name={name} src={sender?.avatar_url} size="md" presence={presence} />
        </span>

        <div className="message-meta">
          <div className="message-header">
            <span
              className="message-author"
              onClick={handleUserClick}
              style={!isOwn ? { cursor: 'pointer' } : undefined}
              title={!isOwn ? `Message ${name}` : undefined}
            >
              {name}
            </span>
            <span className="message-time">{formatTime(message.created_at)}</span>
            {message.is_edited && (
              <span className="message-edited">(edited)</span>
            )}
          </div>

          {editing ? (
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
              <input
                className="input"
                style={{ flex: 1 }}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleEdit();
                  if (e.key === 'Escape') setEditing(false);
                }}
                autoFocus
              />
              <button className="btn btn-primary btn-sm" onClick={handleEdit}>Save</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          ) : message.message_type === 'shipment' && message.metadata?.shipment ? (
            (() => {
              const ship = message.metadata.shipment as any;
              const STATUS_BADGE: Record<string, string> = {
                in_transit: 'badge-info',
                delayed:    'badge-error',
                delivered:  'badge-success',
                pending:    'badge-warning',
              };
              
              // Extract any custom message text typed after the command
              const prefixRegex = /^\/shipment\s+SHIP-\d{4}-\d{3}\s*/i;
              const customText = message.content.replace(prefixRegex, '').trim();

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {customText && (
                    <div className="message-content">
                      {renderContent(customText)}
                    </div>
                  )}
                  <div className={`shipment-card ${ship.flagged ? 'flagged' : ''}`} style={{
                    marginTop: customText ? '0' : 'var(--space-2)',
                    maxWidth: '500px',
                    padding: 'var(--space-3) var(--space-4)',
                    borderLeft: ship.flagged ? '3px solid var(--error)' : '3px solid var(--brand-500)',
                    gridTemplateColumns: '1fr auto',
                    gap: 'var(--space-2)',
                  }}>
                    <div>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 2 }}>
                        <a href={`/chat/shipments/${ship.tracking_id}`} className="shipment-tracking" style={{ fontSize: '0.9375rem', fontWeight: 600 }}>
                          {ship.tracking_id}
                        </a>
                        {ship.flagged && <span className="badge badge-error" style={{ fontSize: '0.625rem', padding: '1px 6px' }}>⚠️ Delayed</span>}
                      </div>
                      <p style={{ fontWeight: 500, fontSize: '0.875rem' }}>
                        {ship.origin} → {ship.destination}
                      </p>
                      <p className="shipment-route" style={{ fontSize: '0.75rem', marginTop: 2 }}>
                        {ship.carrier} {ship.contents ? `• ${ship.contents}` : ''}
                      </p>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', gap: '4px' }}>
                      <span className={`badge ${STATUS_BADGE[ship.status ?? ''] ?? 'badge-info'}`} style={{ fontSize: '0.625rem', padding: '1px 6px' }}>
                        {(ship.status ?? 'unknown').replace('_', ' ')}
                      </span>
                      {ship.po_number && (
                        <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>PO: {ship.po_number}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()
          ) : message.message_type === 'system' ? (
            <div className="message-content" style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              {message.content}
            </div>
          ) : (
            <div className="message-content">
              {renderContent(message.content)}
            </div>
          )}

          {message.metadata?.attachment && (
            <div style={{ marginTop: 'var(--space-2)' }}>
              {message.metadata.attachment.type?.startsWith('image/') ? (
                <a href={message.metadata.attachment.url.startsWith('http') ? message.metadata.attachment.url : `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'}${message.metadata.attachment.url}`} target="_blank" rel="noopener noreferrer">
                  <img
                    src={message.metadata.attachment.url.startsWith('http') ? message.metadata.attachment.url : `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'}${message.metadata.attachment.url}`}
                    alt={message.metadata.attachment.name}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '300px',
                      borderRadius: 'var(--radius-lg)',
                      border: '1px solid var(--border-subtle)',
                      boxShadow: 'var(--shadow-sm)',
                      cursor: 'zoom-in',
                      display: 'block',
                      marginTop: '4px',
                      transition: 'transform 0.2s ease-in-out',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.01)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                  />
                </a>
              ) : (
                <a
                  href={message.metadata.attachment.url.startsWith('http') ? message.metadata.attachment.url : `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'}${message.metadata.attachment.url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={message.metadata.attachment.name}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-3) var(--space-4)',
                    borderRadius: 'var(--radius-lg)',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-subtle)',
                    textDecoration: 'none',
                    color: 'var(--text-normal)',
                    fontSize: '0.875rem',
                    maxWidth: '350px',
                    boxShadow: 'var(--shadow-sm)',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--brand-500)';
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-subtle)';
                    e.currentTarget.style.transform = 'none';
                    e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                  }}
                >
                  <span style={{ fontSize: '1.5rem', flexShrink: 0 }}>📄</span>
                  <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
                    <span style={{
                      fontWeight: 500,
                      textOverflow: 'ellipsis',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                    }}>
                      {message.metadata.attachment.name}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {(message.metadata.attachment.size / 1024).toFixed(1)} KB • Click to download
                    </span>
                  </div>
                  <span style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>⬇️</span>
                </a>
              )}
            </div>
          )}

          {/* Thread replies link */}
          {onReplyInThread && message.reply_count !== undefined && message.reply_count > 0 ? (
            <button
              onClick={() => onReplyInThread(message)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--brand-400)',
                fontSize: '0.75rem',
                fontWeight: 600,
                marginTop: 'var(--space-2)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                cursor: 'pointer',
                padding: 0,
              }}
              title="View thread replies"
            >
              💬 {message.reply_count} {message.reply_count === 1 ? 'reply' : 'replies'}
            </button>
          ) : null}
        </div>

        {/* Actions */}
        {hovered && !editing && (
          <div style={{ display: 'flex', gap: 'var(--space-1)', flexShrink: 0 }}>
            {onReplyInThread && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ padding: '4px 8px' }}
                onClick={() => onReplyInThread(message)}
                title="Reply in thread"
              >
                💬
              </button>
            )}
            {isOwn && (
              <>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '4px 8px' }}
                  onClick={() => { setEditing(true); setEditValue(message.content); }}
                  title="Edit message"
                >
                  ✏️
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ padding: '4px 8px', color: 'var(--error)' }}
                  onClick={handleDelete}
                  title="Delete message"
                >
                  🗑️
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
