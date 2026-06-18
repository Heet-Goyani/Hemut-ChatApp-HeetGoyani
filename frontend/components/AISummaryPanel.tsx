'use client';

import type { AISummary } from '@/types';

interface AISummaryPanelProps {
  summary: AISummary | null;
  loading?: boolean;
  onClose?: () => void;
  unreadCount: number;
  onTriggerSummary: (type: 'unread' | 'hours', hours?: number) => void;
  loadingText?: string;
}

export default function AISummaryPanel({
  summary,
  loading,
  onClose,
  unreadCount,
  onTriggerSummary,
  loadingText = 'Analyzing channel activity…'
}: AISummaryPanelProps) {
  return (
    <div className="ai-panel fade-in">
      {/* Header */}
      <div className="ai-panel-header">
        <span style={{ fontSize: '1.25rem' }}>✨</span>
        <span className="ai-panel-title">AI Catch Me Up</span>
        {onClose && (
          <button
            className="btn btn-ghost btn-sm ml-auto"
            onClick={onClose}
            style={{ padding: '4px 8px' }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Options Selection State */}
      {!loading && !summary && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginBottom: 'var(--space-2)' }}>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Choose the time range for the AI summary:
          </p>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-3)' }}>
            {/* Option 1: Unread Messages */}
            <button
              onClick={() => onTriggerSummary('unread')}
              className="ai-option-card"
              disabled={unreadCount === 0}
            >
              <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--brand-400)' }}>
                📥 Unread Chat
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {unreadCount > 0
                  ? `Summarize ${unreadCount} new message${unreadCount === 1 ? '' : 's'}`
                  : 'No unread messages'}
              </span>
            </button>

            {/* Option 2: Last 24 Hours */}
            <button
              onClick={() => onTriggerSummary('hours', 24)}
              className="ai-option-card"
            >
              <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--brand-400)' }}>
                ⏰ Last 24 Hours
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Summarize all activity from the past day
              </span>
            </button>

            {/* Option 3: Last 7 Days */}
            <button
              onClick={() => onTriggerSummary('hours', 168)}
              className="ai-option-card"
            >
              <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--brand-400)' }}>
                🗓️ Last 7 Days
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Summarize discussions from the past week
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && !summary && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-4) 0', color: 'var(--text-muted)' }}>
          <span className="spinner" />
          <span>{loadingText}</span>
        </div>
      )}

      {/* Error state */}
      {summary?.error && (
        <p className="text-error" style={{ fontSize: '0.875rem' }}>
          ⚠️ {summary.error}
        </p>
      )}

      {/* Summary content */}
      {summary && !summary.error && (
        <>
          {/* TL;DR */}
          {summary.tldr && (
            <p className="ai-tldr">{summary.tldr}</p>
          )}

          {/* Key Topics */}
          {summary.key_topics.length > 0 && (
            <div style={{ marginBottom: 'var(--space-5)' }}>
              <p className="ai-section-title">Key Topics</p>
              <div className="ai-chips">
                {summary.key_topics.map((topic, i) => (
                  <span key={i} className="ai-chip">{topic}</span>
                ))}
              </div>
            </div>
          )}

          {/* Shipment Status */}
          {summary.shipment_status.length > 0 && (
            <div style={{ marginBottom: 'var(--space-5)' }}>
              <p className="ai-section-title">Shipment Status</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {summary.shipment_status.map((s, i) => (
                  <div key={i} style={{
                    display: 'flex',
                    gap: 'var(--space-3)',
                    alignItems: 'flex-start',
                    padding: 'var(--space-3)',
                    background: 'var(--bg-overlay)',
                    borderRadius: 'var(--radius-md)',
                  }}>
                    <span className="font-mono" style={{ color: 'var(--brand-400)', fontSize: '0.875rem', flexShrink: 0 }}>
                      {s.tracking_id}
                    </span>
                    <span className={`badge ${s.status === 'delayed' ? 'badge-error' : s.status === 'delivered' ? 'badge-success' : 'badge-info'}`} style={{ flexShrink: 0 }}>
                      {s.status}
                    </span>
                    <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{s.note}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action Items */}
          {summary.action_items.length > 0 && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <p className="ai-section-title">Action Items</p>
              <div className="ai-action-list">
                {summary.action_items.map((item, i) => (
                  <div key={i} className="ai-action-item">{item}</div>
                ))}
              </div>
            </div>
          )}

          {/* Alerts */}
          {summary.alerts.length > 0 && (
            <div>
              <p className="ai-section-title">⚠️ Alerts</p>
              <div className="ai-action-list">
                {summary.alerts.map((alert, i) => (
                  <div key={i} style={{ fontSize: '0.9rem', color: 'var(--warning)', display: 'flex', gap: 'var(--space-2)' }}>
                    <span>!</span> {alert}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
