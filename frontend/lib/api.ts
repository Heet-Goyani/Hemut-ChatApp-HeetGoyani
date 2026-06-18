/**
 * API helpers — fetch-based utilities for background data loading.
 * (Form submissions must use XHR, but data fetching uses fetch for simplicity.)
 */

import type {
  Channel,
  ChannelMember,
  Message,
  PaginatedMessages,
  Shipment,
  AISummaryResponse,
  DMConversation,
  PresenceInfo,
  User,
  PresenceStatus,
} from '@/types';

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body?.detail ?? detail;
    } catch { /* ignore */ }
    throw new ApiError(res.status, detail);
  }

  // 204 No Content
  if (res.status === 204) return null as T;

  return res.json() as Promise<T>;
}

// ── Auth helpers (token management) ──────────────────────────────

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export function setTokens(access: string, refresh: string): void {
  localStorage.setItem('access_token', access);
  localStorage.setItem('refresh_token', refresh);
}

export function clearTokens(): void {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
}

export function getUserId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('user_id');
}

export function setUserId(id: string): void {
  localStorage.setItem('user_id', id);
}

export async function fetchMe(): Promise<User> {
  return apiFetch<User>('/api/auth/me', {}, getToken() ?? undefined);
}

// ── Channels ──────────────────────────────────────────────────────

export async function fetchChannels(): Promise<Channel[]> {
  return apiFetch<Channel[]>('/api/channels', {}, getToken() ?? undefined);
}

export async function fetchChannel(id: string): Promise<Channel> {
  return apiFetch<Channel>(`/api/channels/${id}`, {}, getToken() ?? undefined);
}

export async function fetchChannelMembers(channelId: string): Promise<ChannelMember[]> {
  return apiFetch<ChannelMember[]>(
    `/api/channels/${channelId}/members`,
    {},
    getToken() ?? undefined
  );
}

export async function joinChannel(channelId: string): Promise<void> {
  return apiFetch<void>(
    `/api/channels/${channelId}/join`,
    { method: 'POST' },
    getToken() ?? undefined
  );
}

export async function leaveChannel(channelId: string): Promise<void> {
  return apiFetch<void>(
    `/api/channels/${channelId}/leave`,
    { method: 'DELETE' },
    getToken() ?? undefined
  );
}

// ── Messages ──────────────────────────────────────────────────────

export async function fetchChannelMessages(
  channelId: string,
  before?: string,
  limit = 50
): Promise<PaginatedMessages> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set('before', before);
  return apiFetch<PaginatedMessages>(
    `/api/messages/channel/${channelId}?${params}`,
    {},
    getToken() ?? undefined
  );
}

export async function sendChannelMessage(
  channelId: string,
  content: string,
  message_type = 'text',
  metadata: Record<string, unknown> = {},
  parentId?: string
): Promise<Message> {
  return apiFetch<Message>(
    `/api/messages/channel/${channelId}`,
    {
      method: 'POST',
      body: JSON.stringify({ content, message_type, metadata, parent_id: parentId }),
    },
    getToken() ?? undefined
  );
}

export async function editMessage(id: string, content: string): Promise<Message> {
  return apiFetch<Message>(
    `/api/messages/${id}`,
    { method: 'PUT', body: JSON.stringify({ content }) },
    getToken() ?? undefined
  );
}

export async function deleteMessage(id: string): Promise<void> {
  return apiFetch<void>(
    `/api/messages/${id}`,
    { method: 'DELETE' },
    getToken() ?? undefined
  );
}

export async function fetchMessageReplies(messageId: string): Promise<Message[]> {
  return apiFetch<Message[]>(
    `/api/messages/${messageId}/replies`,
    {},
    getToken() ?? undefined
  );
}

export async function fetchMessage(messageId: string): Promise<Message> {
  return apiFetch<Message>(
    `/api/messages/${messageId}`,
    {},
    getToken() ?? undefined
  );
}

export async function uploadFile(
  file: File
): Promise<{ url: string; name: string; type: string; size: number }> {
  const formData = new FormData();
  formData.append('file', file);

  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}/api/messages/upload`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body?.detail ?? detail;
    } catch { /* ignore */ }
    throw new ApiError(res.status, detail);
  }

  return res.json();
}

// ── DMs ───────────────────────────────────────────────────────────

export async function fetchDMConversations(): Promise<DMConversation[]> {
  return apiFetch<DMConversation[]>(
    '/api/dms/conversations',
    {},
    getToken() ?? undefined
  );
}

export async function fetchDMHistory(
  userId: string,
  before?: string,
  limit = 50
): Promise<PaginatedMessages> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set('before', before);
  return apiFetch<PaginatedMessages>(
    `/api/dms/${userId}?${params}`,
    {},
    getToken() ?? undefined
  );
}

export async function sendDM(
  userId: string,
  content: string,
  message_type = 'text',
  metadata: Record<string, unknown> = {},
  parentId?: string
): Promise<Message> {
  return apiFetch<Message>(
    `/api/dms/${userId}`,
    {
      method: 'POST',
      body: JSON.stringify({ content, message_type, metadata, parent_id: parentId }),
    },
    getToken() ?? undefined
  );
}

// ── Shipments ─────────────────────────────────────────────────────

export async function fetchShipments(): Promise<Shipment[]> {
  return apiFetch<Shipment[]>('/api/shipments', {}, getToken() ?? undefined);
}

export async function fetchShipment(trackingId: string): Promise<Shipment> {
  return apiFetch<Shipment>(
    `/api/shipments/${trackingId}`,
    {},
    getToken() ?? undefined
  );
}

// ── Presence ─────────────────────────────────────────────────────

export async function fetchChannelPresence(channelId: string): Promise<PresenceInfo[]> {
  return apiFetch<PresenceInfo[]>(
    `/api/presence/channel/${channelId}`,
    {},
    getToken() ?? undefined
  );
}

export async function updatePresence(status: 'online' | 'away' | 'offline'): Promise<void> {
  return apiFetch<void>(
    '/api/presence/status',
    { method: 'PUT', body: JSON.stringify({ status }) },
    getToken() ?? undefined
  );
}

export async function fetchUsers(): Promise<User[]> {
  return apiFetch<User[]>('/api/auth/users', {}, getToken() ?? undefined);
}

export async function fetchUser(userId: string): Promise<User> {
  return apiFetch<User>(`/api/auth/users/${userId}`, {}, getToken() ?? undefined);
}

export async function fetchUserPresence(userId: string): Promise<{ status: PresenceStatus }> {
  return apiFetch<{ status: PresenceStatus }>(`/api/presence/status/${userId}`, {}, getToken() ?? undefined);
}

// ── AI ────────────────────────────────────────────────────────────

export async function triggerAISummary(channelId: string, hours = 24): Promise<void> {
  return apiFetch<void>(
    `/api/ai/summarize/${channelId}?hours=${hours}`,
    { method: 'POST' },
    getToken() ?? undefined
  );
}

export async function fetchAISummary(channelId: string): Promise<AISummaryResponse> {
  return apiFetch<AISummaryResponse>(
    `/api/ai/summary/${channelId}`,
    {},
    getToken() ?? undefined
  );
}

export async function searchMessages(query: string, channelId?: string, dmUserId?: string): Promise<Message[]> {
  let url = `/api/messages/search?q=${encodeURIComponent(query)}`;
  if (channelId) {
    url += `&channel_id=${channelId}`;
  }
  if (dmUserId) {
    url += `&dm_user_id=${dmUserId}`;
  }
  return apiFetch<Message[]>(url, {}, getToken() ?? undefined);
}

export { ApiError };
