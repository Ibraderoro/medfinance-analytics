import { useEffect, useRef } from 'react';
import { useAiStore } from '../../store/aiStore';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import styles from './AiChat.module.css';

function ChatIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2C6.477 2 2 6.25 2 11.5c0 2.11.754 4.054 2.01 5.596L2.5 21l4.313-1.383A10.13 10.13 0 0 0 12 21c5.523 0 10-4.25 10-9.5S17.523 2 12 2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function TypingIndicator() {
  return (
    <div className={styles.typingIndicator} aria-live="polite" aria-label="AI is thinking">
      <span className={styles.typingDot} />
      <span className={styles.typingDot} />
      <span className={styles.typingDot} />
    </div>
  );
}

export function AiChatPanel() {
  const isOpen = useAiStore((s) => s.isOpen);
  const messages = useAiStore((s) => s.messages);
  const isLoading = useAiStore((s) => s.isLoading);
  const toggle = useAiStore((s) => s.toggle);
  const close = useAiStore((s) => s.close);
  const loadSummary = useAiStore((s) => s.loadSummary);
  const clearHistory = useAiStore((s) => s.clearHistory);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  return (
    <div className={styles.container}>
      {isOpen && (
        <div className={styles.panel} role="dialog" aria-label="AI Assistant" aria-modal="false">
          <div className={styles.header}>
            <span className={styles.headerTitle}>AI Assistant</span>
            <div className={styles.headerActions}>
              <button
                className={styles.summaryBtn}
                onClick={() => { void loadSummary(); }}
                disabled={isLoading}
                title="Generate financial summary"
                aria-label="Generate financial summary"
              >
                Summary
              </button>
              <button
                className={styles.clearBtn}
                onClick={clearHistory}
                disabled={isLoading}
                title="Clear conversation"
                aria-label="Clear conversation"
              >
                Clear
              </button>
              <button
                className={styles.closeBtn}
                onClick={close}
                aria-label="Close AI assistant"
              >
                ✕
              </button>
            </div>
          </div>

          <div className={styles.messageList} aria-live="polite">
            {messages.length === 0 && (
              <div className={styles.emptyState}>
                <p className={styles.emptyTitle}>Ask about your finances</p>
                <p className={styles.emptyHint}>
                  Try: "What drove revenue growth this quarter?" or tap <strong>Summary</strong> for an overview.
                </p>
              </div>
            )}
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {isLoading && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>

          <ChatInput />
        </div>
      )}

      <button
        className={`${styles.fab} ${isOpen ? styles.fabOpen : ''}`}
        onClick={toggle}
        aria-label={isOpen ? 'Close AI assistant' : 'Open AI assistant'}
        title={isOpen ? 'Close AI assistant' : 'Open AI assistant'}
      >
        {isOpen ? (
          <span className={styles.fabClose} aria-hidden="true">✕</span>
        ) : (
          <ChatIcon />
        )}
      </button>
    </div>
  );
}
