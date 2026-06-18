/**
 * A tiny cross-component event bus using the browser's CustomEvent API.
 * Used for things like "user just joined a channel — update the sidebar."
 */

export const CHANNEL_JOINED_EVENT = 'logichat:channel-joined';
export const CHANNEL_LEFT_EVENT = 'logichat:channel-left';

/** Notify the rest of the app that the user joined a channel. */
export function emitChannelJoined(channelId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(CHANNEL_JOINED_EVENT, { detail: { channelId } })
  );
}

/** Notify the rest of the app that the user left a channel. */
export function emitChannelLeft(channelId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(CHANNEL_LEFT_EVENT, { detail: { channelId } })
  );
}

export const DM_SENT_EVENT = 'logichat:dm-sent';

/** Notify the rest of the app that a DM was sent. */
export function emitDMSent(recipientId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(DM_SENT_EVENT, { detail: { recipientId } })
  );
}
