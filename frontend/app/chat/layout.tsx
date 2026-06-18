'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, getUserId } from '@/lib/api';
import { wsClient } from '@/lib/websocket';
import Sidebar from '@/components/Sidebar';

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const token = getToken();
    const userId = getUserId();

    if (!token || !userId) {
      router.replace('/');
      return;
    }

    // Ensure WebSocket is connected
    if (!wsClient.isConnected) {
      wsClient.connect(userId, token);
    }
  }, [router]);

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-area">{children}</main>
    </div>
  );
}
