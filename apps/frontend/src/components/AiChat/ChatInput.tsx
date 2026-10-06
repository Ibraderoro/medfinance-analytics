import { useState, useRef, useCallback, type KeyboardEvent } from 'react';
import { useAiStore } from '../../store/aiStore';
import styles from './AiChat.module.css';

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 2L15 22l-4-9-9-4 20-7Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const MAX_ROWS = 3;
const LINE_HEIGHT_PX = 22; // approximate px per line

export function ChatInput() {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ask = useAiStore((s) => s.ask);
  const isLoading = useAiStore((s) => s.isLoading);

  const canSend = value.trim().length > 0 && !isLoading;

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = MAX_ROWS * LINE_HEIGHT_PX + 16; // padding
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, []);

  const submit = useCallback(() => {
    const question = value.trim();
    if (!question || isLoading) return;
    setValue('');
    // Reset height after clearing
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    void ask(question);
  }, [value, isLoading, ask]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  return (
    <div className={styles.inputRow}>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={value}
        rows={1}
        placeholder="Ask a financial question…"
        disabled={isLoading}
        onChange={(e) => {
          setValue(e.target.value);
          autoResize();
        }}
        onKeyDown={handleKeyDown}
        aria-label="Message input"
      />
      <button
        className={styles.sendBtn}
        onClick={submit}
        disabled={!canSend}
        aria-label="Send message"
        title="Send (Enter)"
      >
        <SendIcon />
      </button>
    </div>
  );
}
