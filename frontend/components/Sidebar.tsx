'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { fetchChannels, fetchDMConversations, clearTokens, fetchUsers, fetchUser, fetchUserPresence, getUserId, fetchMe } from '@/lib/api';
import { wsClient } from '@/lib/websocket';
import { CHANNEL_JOINED_EVENT, CHANNEL_LEFT_EVENT, DM_SENT_EVENT } from '@/lib/events';
import { useSingleWSEvent } from '@/hooks/useWebSocket';
import Avatar from '@/components/Avatar';
import type { Channel, DMConversation, User, PresenceStatus, WSNewMessageEvent, WSPresenceChangeEvent } from '@/types';

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [conversations, setConversations] = useState<DMConversation[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});

  // Direct Message starting and presence state
  const [showDMModal, setShowDMModal] = useState(false);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [dmPresence, setDmPresence] = useState<Record<string, PresenceStatus>>({});
  const [activeUser, setActiveUser] = useState<User | null>(null);
  const [me, setMe] = useState<User | null>(null);

  const currentUserId = getUserId();
  const activeDMUserId = pathname.startsWith('/chat/dm/') ? pathname.split('/').pop() : null;

  const refreshChannels = () => {
    fetchChannels()
      .then((data) => setChannels(data.filter((c) => c.is_member)))
      .catch(() => {});
  };

  const refreshConversations = () => {
    fetchDMConversations()
      .then((data) => {
        setConversations(data);
        // Fetch presence for each user
        data.forEach((c) => {
          fetchUserPresence(c.user_id)
            .then((res) => {
              setDmPresence((prev) => ({ ...prev, [c.user_id]: res.status }));
            })
            .catch(() => {});
        });
      })
      .catch(() => {});
  };

  useEffect(() => {
    refreshChannels();
    refreshConversations();

    fetchMe()
      .then(setMe)
      .catch(() => {});

    // Re-fetch whenever user joins or leaves a channel from anywhere in the app
    window.addEventListener(CHANNEL_JOINED_EVENT, refreshChannels);
    window.addEventListener(CHANNEL_LEFT_EVENT, refreshChannels);
    window.addEventListener(DM_SENT_EVENT, refreshConversations);

    return () => {
      window.removeEventListener(CHANNEL_JOINED_EVENT, refreshChannels);
      window.removeEventListener(CHANNEL_LEFT_EVENT, refreshChannels);
      window.removeEventListener(DM_SENT_EVENT, refreshConversations);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch the active DM user profile if they are not in the existing list
  useEffect(() => {
    if (activeDMUserId && !conversations.some((c) => c.user_id === activeDMUserId)) {
      fetchUser(activeDMUserId)
        .then((user) => {
          setActiveUser(user);
          fetchUserPresence(user.id)
            .then((res) => {
              setDmPresence((prev) => ({ ...prev, [user.id]: res.status }));
            })
            .catch(() => {});
        })
        .catch(() => {});
    } else {
      setActiveUser(null);
    }
  }, [activeDMUserId, conversations]);

  // Track real-time presence updates
  useSingleWSEvent('presence_change', (event) => {
    const e = event as WSPresenceChangeEvent;
    setDmPresence((prev) => ({ ...prev, [e.user_id]: e.status }));
  });

  // Track unread messages (both channel and DM)
  useSingleWSEvent('new_message', (event) => {
    const e = event as WSNewMessageEvent;
    
    if (e.is_dm) {
      // Reload conversation previews
      refreshConversations();
      
      const otherUserId = e.message.sender_id === currentUserId ? e.message.recipient_id : e.message.sender_id;
      if (otherUserId && pathname !== `/chat/dm/${otherUserId}`) {
        const idKey = `dm:${otherUserId}`;
        setUnread((prev) => ({
          ...prev,
          [idKey]: (prev[idKey] ?? 0) + 1,
        }));
      }
    } else {
      const channelId = e.channel_id;
      if (!channelId) return;

      const isActive = pathname === `/chat/channels/${channelId}`;
      if (!isActive) {
        setUnread((prev) => ({
          ...prev,
          [channelId]: (prev[channelId] ?? 0) + 1,
        }));
      }
    }
  });

  const clearUnread = (id: string) => {
    setUnread((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const openDMModal = async () => {
    setShowDMModal(true);
    setSearchTerm('');
    setUsersLoading(true);
    try {
      const users = await fetchUsers();
      setAllUsers(users);
    } catch {
      // ignore
    } finally {
      setUsersLoading(false);
    }
  };

  const startDM = (userId: string) => {
    setShowDMModal(false);
    router.push(`/chat/dm/${userId}`);
  };

  const handleLogout = () => {
    wsClient.disconnect();
    clearTokens();
    router.push('/');
  };

  const filteredUsers = allUsers.filter((u) => 
    u.id !== currentUserId && (
      u.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.display_name && u.display_name.toLowerCase().includes(searchTerm.toLowerCase()))
    )
  );

  const displayConversations = [...conversations];
  if (activeUser && !displayConversations.some((c) => c.user_id === activeUser.id)) {
    displayConversations.unshift({
      user_id: activeUser.id,
      user: {
        id: activeUser.id,
        username: activeUser.username,
        display_name: activeUser.display_name,
        avatar_url: activeUser.avatar_url,
      },
      last_message: {
        content: 'No messages yet',
        created_at: new Date().toISOString(),
      }
    });
  }

  return (
    <>
      <aside className="sidebar">
        {/* Header */}
        <div className="sidebar-header">
          <div className="sidebar-logo">Hemut-Chat</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
            <Link href="/chat/shipments" title="Shipments">
              <button className="btn btn-ghost btn-sm" style={{ padding: '6px 8px' }}>
                📦
              </button>
            </Link>
            <button
              id="btn-logout"
              className="btn btn-ghost btn-sm"
              onClick={handleLogout}
              title="Sign out"
            >
              ⏏
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto' }}>

          {/* Channels */}
          <div className="sidebar-section">
            <div className="sidebar-section-label">
              Channels
              <Link href="/chat/channels/browse">
                <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', fontSize: '1.1rem' }}>+</button>
              </Link>
            </div>

            {channels.length === 0 && (
              <p style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                No channels joined yet
              </p>
            )}

            {channels.map((ch) => {
              const isActive = pathname === `/chat/channels/${ch.id}`;
              const count = unread[ch.id] ?? 0;
              return (
                <Link
                  key={ch.id}
                  href={`/chat/channels/${ch.id}`}
                  onClick={() => clearUnread(ch.id)}
                  style={{ textDecoration: 'none' }}
                >
                  <div className={`sidebar-item ${isActive ? 'active' : ''}`}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>#</span>
                    <span className="truncate flex-1">{ch.name}</span>
                    {count > 0 && (
                      <span className="unread-badge">{count > 99 ? '99+' : count}</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Direct Messages */}
          <div className="sidebar-section">
            <div className="sidebar-section-label">
              Direct Messages
              <button
                className="btn btn-ghost btn-sm"
                onClick={openDMModal}
                style={{ padding: '2px 8px', fontSize: '1.1rem' }}
                title="New Direct Message"
              >
                +
              </button>
            </div>

            {displayConversations.length === 0 && (
              <p style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                No conversations yet
              </p>
            )}

            {displayConversations.map((conv) => {
              const isActive = pathname === `/chat/dm/${conv.user_id}`;
              const count = unread[`dm:${conv.user_id}`] ?? 0;
              return (
                <Link
                  key={conv.user_id}
                  href={`/chat/dm/${conv.user_id}`}
                  onClick={() => clearUnread(`dm:${conv.user_id}`)}
                  style={{ textDecoration: 'none' }}
                >
                  <div className={`sidebar-item ${isActive ? 'active' : ''}`}>
                    <Avatar
                      name={conv.user.display_name ?? conv.user.username}
                      size="sm"
                      presence={dmPresence[conv.user_id] ?? 'offline'}
                    />
                    <span className="truncate flex-1">
                      {conv.user.display_name ?? conv.user.username}
                    </span>
                    {count > 0 && (
                      <span className="unread-badge">{count > 99 ? '99+' : count}</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Profile Footer */}
        {me && (
          <div className="sidebar-footer">
            <Avatar name={me.display_name ?? me.username} src={me.avatar_url} size="sm" presence="online" />
            <div className="sidebar-footer-info">
              <span className="sidebar-footer-name truncate">{me.display_name ?? me.username}</span>
              <span className="sidebar-footer-username truncate">@{me.username}</span>
            </div>
          </div>
        )}
      </aside>

      {/* DM Modal Overlay */}
      {showDMModal && (
        <div className="dm-modal-overlay" onClick={() => setShowDMModal(false)}>
          <div className="dm-modal-container" onClick={(e) => e.stopPropagation()}>
            <div className="dm-modal-header">
              <span className="dm-modal-title">New Direct Message</span>
              <button className="dm-modal-close" onClick={() => setShowDMModal(false)}>
                &times;
              </button>
            </div>
            <div className="dm-modal-body">
              <input
                type="text"
                className="input"
                placeholder="Search by name or username..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoFocus
              />
              <div className="dm-modal-user-list">
                {usersLoading ? (
                  <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Loading users...</p>
                ) : filteredUsers.length === 0 ? (
                  <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No users found</p>
                ) : (
                  filteredUsers.map((user) => (
                    <button
                      key={user.id}
                      className="dm-modal-user-item"
                      onClick={() => startDM(user.id)}
                    >
                      <Avatar
                        name={user.display_name ?? user.username}
                        size="sm"
                        presence={dmPresence[user.id] ?? 'offline'}
                      />
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: 500 }}>{user.display_name ?? user.username}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>@{user.username}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
