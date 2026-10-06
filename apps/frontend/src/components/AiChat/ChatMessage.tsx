import type { AiMessage } from '../../store/aiStore';
import styles from './AiChat.module.css';

interface ChatMessageProps {
  message: AiMessage;
}

/** Convert plain text with newlines into React-safe JSX spans. */
function TextWithLineBreaks({ text }: { text: string }) {
  const parts = text.split('\n');
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const bubbleClass = [
    styles.messageBubble,
    isUser ? styles.userBubble : styles.assistantBubble,
    message.isError ? styles.errorBubble : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`${styles.messageRow} ${isUser ? styles.messageRowUser : styles.messageRowAssistant}`}>
      {!isUser && (
        <span className={styles.avatarBadge} aria-hidden="true">AI</span>
      )}
      <div className={bubbleClass}>
        <TextWithLineBreaks text={message.content} />
        {message.recommendations && message.recommendations.length > 0 && (
          <ol className={styles.recommendationList}>
            {message.recommendations.map((rec, i) => (
              <li key={i}>{rec}</li>
            ))}
          </ol>
        )}
        <span className={styles.messageTime}>
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}
