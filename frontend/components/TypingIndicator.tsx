'use client';

interface TypingIndicatorProps {
  typingUsers: Set<string>;
  userNames?: Record<string, string>; // user_id → display name
}

export default function TypingIndicator({ typingUsers, userNames = {} }: TypingIndicatorProps) {
  if (typingUsers.size === 0) {
    return <div className="typing-indicator" />;
  }

  const names = [...typingUsers].map((id) => userNames[id] ?? 'Someone');

  let label: string;
  if (names.length === 1) {
    label = `${names[0]} is typing`;
  } else if (names.length === 2) {
    label = `${names[0]} and ${names[1]} are typing`;
  } else {
    label = `${names[0]} and ${names.length - 1} others are typing`;
  }

  return (
    <div className="typing-indicator">
      <div className="typing-dots">
        <span /><span /><span />
      </div>
      <span>{label}</span>
    </div>
  );
}
