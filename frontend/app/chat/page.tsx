'use client';

export default function ChatIndexPage() {
  return (
    <div
      className="flex flex-col items-center"
      style={{
        height: '100%',
        justifyContent: 'center',
        gap: 'var(--space-4)',
        color: 'var(--text-muted)',
      }}
    >
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-2)' }}>
          Select a channel or DM
        </p>
        <p style={{ fontSize: '0.875rem' }}>
          Choose a conversation from the sidebar to get started.
        </p>
      </div>
    </div>
  );
}
