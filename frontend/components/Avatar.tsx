'use client';

import type { PresenceStatus } from '@/types';

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  presence?: PresenceStatus;
}

function getInitials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join('');
}

// Consistent colour from username
function colorFromName(name: string): string {
  const palette = [
    'linear-gradient(135deg, hsl(222,78%,52%), hsl(242,78%,58%))',
    'linear-gradient(135deg, hsl(262,78%,52%), hsl(302,60%,52%))',
    'linear-gradient(135deg, hsl(158,64%,40%), hsl(200,80%,44%))',
    'linear-gradient(135deg, hsl(38,80%,48%), hsl(20,80%,52%))',
    'linear-gradient(135deg, hsl(340,72%,52%), hsl(10,78%,52%))',
  ];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return palette[Math.abs(hash) % palette.length];
}

export default function Avatar({ name, src, size = 'md', presence }: AvatarProps) {
  return (
    <span className={`avatar avatar-${size}`} style={{ background: colorFromName(name) }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
        />
      ) : (
        getInitials(name)
      )}
      {presence && (
        <span className={`presence-dot ${presence}`} />
      )}
    </span>
  );
}
