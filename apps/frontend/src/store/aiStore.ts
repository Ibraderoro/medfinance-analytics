import { create } from 'zustand';
import { aiApi } from '../services/api';

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  recommendations?: string[];
  timestamp: Date;
  isError?: boolean;
}

interface AiStore {
  isOpen: boolean;
  messages: AiMessage[];
  isLoading: boolean;

  open: () => void;
  close: () => void;
  toggle: () => void;
  addMessage: (msg: Omit<AiMessage, 'id' | 'timestamp'>) => void;
  setLoading: (loading: boolean) => void;
  clearHistory: () => void;
  ask: (question: string) => Promise<void>;
  loadSummary: () => Promise<void>;
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function toHistorySlice(messages: AiMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter((m) => !m.isError)
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content }));
}

export const useAiStore = create<AiStore>((set, get) => ({
  isOpen: false,
  messages: [],
  isLoading: false,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),

  addMessage: (msg) =>
    set((s) => ({
      messages: [...s.messages, { ...msg, id: makeId(), timestamp: new Date() }],
    })),

  setLoading: (loading) => set({ isLoading: loading }),

  clearHistory: () => set({ messages: [] }),

  ask: async (question) => {
    const { addMessage, setLoading, messages } = get();

    addMessage({ role: 'user', content: question });
    setLoading(true);

    try {
      const history = toHistorySlice(messages);
      const res = await aiApi.ask(question, history);
      const { answer, recommendations } = res.data.data;
      addMessage({ role: 'assistant', content: answer, recommendations });
    } catch {
      addMessage({
        role: 'assistant',
        content: 'Sorry, I could not process your request. Please try again.',
        isError: true,
      });
    } finally {
      setLoading(false);
    }
  },

  loadSummary: async () => {
    const { addMessage, setLoading } = get();
    setLoading(true);
    try {
      const res = await aiApi.getSummary();
      const { answer, recommendations } = res.data.data;
      addMessage({ role: 'assistant', content: answer, recommendations });
    } catch {
      addMessage({
        role: 'assistant',
        content: 'Unable to load the financial summary right now.',
        isError: true,
      });
    } finally {
      setLoading(false);
    }
  },
}));
