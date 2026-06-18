'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchShipment } from '@/lib/api';
import type { Shipment } from '@/types';

const STATUS_BADGE: Record<string, string> = {
  in_transit: 'badge-info',
  delayed:    'badge-error',
  delivered:  'badge-success',
  pending:    'badge-warning',
};

function formatETA(eta: string | null): string {
  if (!eta) return 'N/A';
  return new Date(eta).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface PageProps {
  params: { trackingId: string };
}

export default function ShipmentDetailPage({ params }: PageProps) {
  const { trackingId } = params;
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchShipment(trackingId)
      .then(setShipment)
      .catch((err) => {
        setError(err.message || `Shipment '${trackingId}' not found.`);
      })
      .finally(() => setLoading(false));
  }, [trackingId]);

  return (
    <>
      {/* Header */}
      <div className="channel-header">
        <span style={{ fontSize: '1.2rem' }}>📦</span>
        <span className="channel-header-title">Shipment {trackingId.toUpperCase()}</span>
        <div className="channel-header-actions">
          <Link href="/chat/shipments">
            <button className="btn btn-ghost btn-sm">← Back to Shipments</button>
          </Link>
        </div>
      </div>

      {/* Main Details Panel */}
      <div style={{ padding: 'var(--space-6)', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-12)' }}>
            <span className="spinner" style={{ width: 32, height: 32 }} />
          </div>
        )}

        {error && (
          <div className="glass-card" style={{ padding: 'var(--space-6)', borderLeft: '4px solid var(--error)' }}>
            <h3 style={{ color: 'var(--error)', marginBottom: 'var(--space-2)' }}>Error Loading Shipment</h3>
            <p style={{ color: 'var(--text-secondary)' }}>{error}</p>
            <div style={{ marginTop: 'var(--space-4)' }}>
              <Link href="/chat/shipments">
                <button className="btn btn-primary btn-sm">View All Shipments</button>
              </Link>
            </div>
          </div>
        )}

        {!loading && !error && shipment && (
          <div className={`glass-card ${shipment.flagged ? 'flagged' : ''}`} style={{
            padding: 'var(--space-6)',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-5)',
            borderLeft: shipment.flagged ? '4px solid var(--error)' : '4px solid var(--brand-500)',
          }}>
            {/* Header info */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
              <div>
                <span className="shipment-tracking" style={{ fontSize: '1.5rem', display: 'block', marginBottom: '4px' }}>
                  {shipment.tracking_id}
                </span>
                {shipment.po_number && (
                  <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    Purchase Order: <strong style={{ color: 'var(--text-primary)' }}>{shipment.po_number}</strong>
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                {shipment.flagged && <span className="badge badge-error">⚠ Flagged</span>}
                <span className={`badge ${STATUS_BADGE[shipment.status ?? ''] ?? 'badge-info'}`}>
                  {(shipment.status ?? 'unknown').replace('_', ' ')}
                </span>
              </div>
            </div>

            <hr className="divider" style={{ margin: 'var(--space-2) 0' }} />

            {/* Route Map simulation */}
            <div style={{
              background: 'var(--bg-overlay)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-4)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              border: '1px solid var(--border-subtle)',
            }}>
              <div style={{ textAlign: 'left' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Origin</span>
                <p style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{shipment.origin || 'Unknown'}</p>
              </div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 var(--space-4)', color: 'var(--text-muted)' }}>
                <div style={{ borderTop: '2px dashed var(--border-strong)', flex: 1 }} />
                <span style={{ padding: '0 var(--space-2)', fontSize: '1.2rem' }}>✈</span>
                <div style={{ borderTop: '2px dashed var(--border-strong)', flex: 1 }} />
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Destination</span>
                <p style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{shipment.destination || 'Unknown'}</p>
              </div>
            </div>

            {/* Cargo & Carrier Details */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
              <div>
                <label className="input-label">Carrier</label>
                <div style={{ background: 'var(--bg-overlay)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                  {shipment.carrier || 'N/A'}
                </div>
              </div>
              <div>
                <label className="input-label">Cargo Contents</label>
                <div style={{ background: 'var(--bg-overlay)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                  {shipment.contents || 'N/A'}
                </div>
              </div>
              <div>
                <label className="input-label">Weight</label>
                <div style={{ background: 'var(--bg-overlay)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                  {shipment.weight_kg ? `${Number(shipment.weight_kg).toLocaleString()} kg` : 'N/A'}
                </div>
              </div>
              <div>
                <label className="input-label">Estimated Arrival Time (ETA)</label>
                <div style={{ background: 'var(--bg-overlay)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                  {formatETA(shipment.eta)}
                </div>
              </div>
            </div>

            {/* Notes Section */}
            {shipment.notes && (
              <div>
                <label className="input-label">Operational Notes</label>
                <div style={{
                  background: 'hsla(38, 92%, 52%, 0.04)',
                  border: '1px solid hsla(38, 92%, 52%, 0.2)',
                  color: 'var(--text-primary)',
                  padding: 'var(--space-4)',
                  borderRadius: 'var(--radius-md)',
                  fontFamily: 'var(--font-sans)',
                  whiteSpace: 'pre-wrap',
                }}>
                  {shipment.notes}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
