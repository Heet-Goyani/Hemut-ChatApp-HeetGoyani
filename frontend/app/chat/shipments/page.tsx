'use client';

import { useEffect, useState } from 'react';
import { fetchShipments } from '@/lib/api';
import type { Shipment } from '@/types';

const STATUS_BADGE: Record<string, string> = {
  in_transit: 'badge-info',
  delayed:    'badge-error',
  delivered:  'badge-success',
  pending:    'badge-warning',
};

function formatETA(eta: string | null): string {
  if (!eta) return 'N/A';
  return new Date(eta).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ShipmentsPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    fetchShipments()
      .then(setShipments)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = shipments.filter((s) => {
    const matchText = !filter || s.tracking_id.toLowerCase().includes(filter.toLowerCase())
      || s.origin?.toLowerCase().includes(filter.toLowerCase())
      || s.destination?.toLowerCase().includes(filter.toLowerCase())
      || s.carrier?.toLowerCase().includes(filter.toLowerCase());
    const matchStatus = !statusFilter || s.status === statusFilter;
    return matchText && matchStatus;
  });

  return (
    <>
      <div className="channel-header">
        <span style={{ fontSize: '1.2rem' }}>📦</span>
        <span className="channel-header-title">Shipments</span>
        <div className="channel-header-actions">
          <select
            className="input"
            style={{ padding: 'var(--space-1) var(--space-3)', width: 'auto', fontSize: '0.875rem' }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="in_transit">In Transit</option>
            <option value="delayed">Delayed</option>
            <option value="delivered">Delivered</option>
            <option value="pending">Pending</option>
          </select>
          <input
            className="input"
            style={{ width: '220px', padding: 'var(--space-1) var(--space-3)', fontSize: '0.875rem' }}
            placeholder="Search ID, origin, carrier…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      <div style={{ padding: 'var(--space-6)', overflowY: 'auto', flex: 1 }}>
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-12)' }}>
            <span className="spinner" style={{ width: 32, height: 32 }} />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-12)' }}>
            No shipments match your filters.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {filtered.map((s) => (
            <div key={s.id} className={`shipment-card ${s.flagged ? 'flagged' : ''}`}>
              <div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 4 }}>
                  <span className="shipment-tracking">{s.tracking_id}</span>
                  {s.flagged && <span className="badge badge-error">⚠ Flagged</span>}
                </div>
                {s.po_number && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>PO: {s.po_number}</p>
                )}
              </div>

              <div>
                <p style={{ fontWeight: 500, marginBottom: 4 }}>
                  {s.origin} → {s.destination}
                </p>
                <p className="shipment-route">{s.carrier}</p>
                <p className="text-xs text-muted" style={{ marginTop: 4 }}>
                  ETA: {formatETA(s.eta)}
                </p>
                {s.contents && (
                  <p className="text-xs text-muted">{s.contents}</p>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--space-2)' }}>
                <span className={`badge ${STATUS_BADGE[s.status ?? ''] ?? 'badge-info'}`}>
                  {(s.status ?? 'unknown').replace('_', ' ')}
                </span>
                {s.weight_kg && (
                  <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                    {Number(s.weight_kg).toLocaleString()} kg
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
