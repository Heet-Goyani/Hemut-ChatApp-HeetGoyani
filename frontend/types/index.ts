/**
 * TypeScript types shared across the Hemut-Chat frontend.
 * These mirror the backend Pydantic schemas exactly.
 */

// ── Auth ───────────────────────────────────────────────────────────
export interface User {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: User;
}

// ── Channels ───────────────────────────────────────────────────────
export interface Channel {
  id: string;
  name: string;
  description: string | null;
  is_private: boolean;
  created_by: string | null;
  created_at: string;
  member_count: number;
  is_member: boolean;
  last_read_at?: string | null;
}

export interface ChannelMember {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  presence: PresenceStatus;
}

// ── Messages ───────────────────────────────────────────────────────
export type MessageType = 'text' | 'shipment' | 'ai' | 'system';

export interface AttachmentMetadata {
  url: string;
  name: string;
  type: string;
  size: number;
}

export interface Message {
  id: string;
  content: string;
  sender_id: string | null;
  channel_id: string | null;
  recipient_id: string | null;
  parent_id: string | null;
  reply_count?: number;
  message_type: MessageType;
  metadata: {
    attachment?: AttachmentMetadata;
    shipment?: any;
    [key: string]: any;
  };
  is_edited: boolean;
  created_at: string;
  updated_at: string;
  sender: User | null;
}

export interface PaginatedMessages {
  messages: Message[];
  has_more: boolean;
  next_cursor: string | null;
}

// ── Shipments ──────────────────────────────────────────────────────
export type ShipmentStatus = 'in_transit' | 'delayed' | 'delivered' | 'pending';

export interface Shipment {
  id: string;
  tracking_id: string;
  po_number: string | null;
  origin: string | null;
  destination: string | null;
  carrier: string | null;
  status: ShipmentStatus | null;
  eta: string | null;
  weight_kg: number | null;
  contents: string | null;
  flagged: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ── Presence ───────────────────────────────────────────────────────
export type PresenceStatus = 'online' | 'away' | 'offline';

export interface PresenceInfo {
  user_id: string;
  status: PresenceStatus;
}

// ── DM Conversations ───────────────────────────────────────────────
export interface DMConversation {
  user_id: string;
  user: Pick<User, 'id' | 'username' | 'display_name' | 'avatar_url'>;
  last_message: {
    content: string;
    created_at: string;
  };
}

// ── AI Summary ────────────────────────────────────────────────────
export interface ShipmentStatusItem {
  tracking_id: string;
  status: string;
  note: string;
}

export interface AISummary {
  tldr: string;
  key_topics: string[];
  shipment_status: ShipmentStatusItem[];
  action_items: string[];
  alerts: string[];
  error?: string;
}

export interface AISummaryResponse {
  channel_id: string;
  summary: AISummary;
  generated_at?: string;
  message_count?: number;
  time_window_hours?: number;
  source: 'cache' | 'database';
}

// ── WebSocket Events ───────────────────────────────────────────────
export type WSEventType =
  | 'connected'
  | 'new_message'
  | 'message_edited'
  | 'message_deleted'
  | 'presence_change'
  | 'typing_start'
  | 'typing_stop'
  | 'ai_response'
  | 'shipment_alert'
  | 'heartbeat_ack';

export interface WSEvent {
  type: WSEventType;
  [key: string]: unknown;
}

export interface WSNewMessageEvent extends WSEvent {
  type: 'new_message';
  channel_id?: string;
  is_dm?: boolean;
  message: Message;
}

export interface WSMessageEditedEvent extends WSEvent {
  type: 'message_edited';
  channel_id?: string | null;
  is_dm?: boolean;
  message: Message;
}

export interface WSMessageDeletedEvent extends WSEvent {
  type: 'message_deleted';
  channel_id?: string | null;
  is_dm?: boolean;
  message_id: string;
  parent_id?: string | null;
}

export interface WSPresenceChangeEvent extends WSEvent {
  type: 'presence_change';
  user_id: string;
  status: PresenceStatus;
}

export interface WSTypingEvent extends WSEvent {
  type: 'typing_start' | 'typing_stop';
  user_id: string;
  channel_id?: string | null;
  is_dm?: boolean;
}

export interface WSAIResponseEvent extends WSEvent {
  type: 'ai_response';
  channel_id: string;
  summary: AISummary;
}

// ── XHR Utility types ─────────────────────────────────────────────
export interface XHROptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  data?: unknown;
  token?: string;
  onProgress?: (percent: number) => void;
  timeout?: number;
}

export interface XHRResponse<T> {
  data: T | null;
  status: number;
  error: string | null;
}
