import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useAiStore } from '../store/aiStore';
import { ChatInput } from '../components/AiChat/ChatInput';
import { ChatMessage } from '../components/AiChat/ChatMessage';
import { AiChatPanel } from '../components/AiChat/AiChatPanel';
import { AiRecommendations } from '../components/Dashboard/AiRecommendations';
import { LiveBadge } from '../components/LiveBadge';
import { useAiSummary } from '../hooks/useAiSummary';
import { renderHook } from '@testing-library/react';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { aiApi } from '../services/api';
import type { AiMessage } from '../store/aiStore';

jest.mock('../services/api', () => ({
  aiApi: {
    ask: jest.fn(),
    getSummary: jest.fn(),
  },
}));

// ─── useAiStore ────────────────────────────────────────────────────────────

describe('useAiStore', () => {
  beforeEach(() => {
    useAiStore.setState({ isOpen: false, messages: [], isLoading: false });
  });

  it('open/close/toggle mutate isOpen', () => {
    act(() => useAiStore.getState().open());
    expect(useAiStore.getState().isOpen).toBe(true);

    act(() => useAiStore.getState().close());
    expect(useAiStore.getState().isOpen).toBe(false);

    act(() => useAiStore.getState().toggle());
    expect(useAiStore.getState().isOpen).toBe(true);

    act(() => useAiStore.getState().toggle());
    expect(useAiStore.getState().isOpen).toBe(false);
  });

  it('addMessage appends a message with generated id and timestamp', () => {
    act(() =>
      useAiStore.getState().addMessage({ role: 'user', content: 'Hello' }),
    );
    const msgs = useAiStore.getState().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('Hello');
    expect(typeof msgs[0].id).toBe('string');
    expect(msgs[0].timestamp).toBeInstanceOf(Date);
  });

  it('setLoading and clearHistory work correctly', () => {
    act(() => useAiStore.getState().setLoading(true));
    expect(useAiStore.getState().isLoading).toBe(true);

    act(() => useAiStore.getState().addMessage({ role: 'user', content: 'x' }));
    act(() => useAiStore.getState().clearHistory());
    expect(useAiStore.getState().messages).toHaveLength(0);
  });

  it('ask: adds user message, calls aiApi.ask, appends assistant reply', async () => {
    (aiApi.ask as jest.Mock).mockResolvedValueOnce({
      data: { data: { answer: 'Revenue up 12%.', recommendations: ['Review Q3 spend'] } },
    });

    await act(async () => {
      await useAiStore.getState().ask('What is revenue?');
    });

    const msgs = useAiStore.getState().messages;
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('What is revenue?');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].content).toBe('Revenue up 12%.');
    expect(msgs[1].recommendations).toEqual(['Review Q3 spend']);
    expect(useAiStore.getState().isLoading).toBe(false);
  });

  it('ask: appends error message when aiApi.ask rejects', async () => {
    (aiApi.ask as jest.Mock).mockRejectedValueOnce(new Error('network fail'));

    await act(async () => {
      await useAiStore.getState().ask('fail question');
    });

    const msgs = useAiStore.getState().messages;
    expect(msgs[1].isError).toBe(true);
    expect(msgs[1].role).toBe('assistant');
    expect(useAiStore.getState().isLoading).toBe(false);
  });

  it('loadSummary: appends assistant summary message', async () => {
    (aiApi.getSummary as jest.Mock).mockResolvedValueOnce({
      data: { data: { answer: 'Summary here.', recommendations: ['Cut costs'] } },
    });

    await act(async () => {
      await useAiStore.getState().loadSummary();
    });

    const msgs = useAiStore.getState().messages;
    expect(msgs[0].role).toBe('assistant');
    expect(msgs[0].content).toBe('Summary here.');
    expect(useAiStore.getState().isLoading).toBe(false);
  });

  it('loadSummary: appends error message when getSummary rejects', async () => {
    (aiApi.getSummary as jest.Mock).mockRejectedValueOnce(new Error('500'));

    await act(async () => {
      await useAiStore.getState().loadSummary();
    });

    const msgs = useAiStore.getState().messages;
    expect(msgs[0].isError).toBe(true);
    expect(useAiStore.getState().isLoading).toBe(false);
  });
});

// ─── ChatInput ────────────────────────────────────────────────────────────

describe('ChatInput', () => {
  beforeEach(() => {
    useAiStore.setState({ isOpen: false, messages: [], isLoading: false });
    (aiApi.ask as jest.Mock).mockResolvedValue({
      data: { data: { answer: 'ok', recommendations: [] } },
    });
  });

  it('renders the textarea and send button', () => {
    render(<ChatInput />);
    expect(screen.getByRole('textbox', { name: /message input/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send message/i })).toBeInTheDocument();
  });

  it('send button is disabled when input is empty', () => {
    render(<ChatInput />);
    expect(screen.getByRole('button', { name: /send message/i })).toBeDisabled();
  });

  it('enables send button when text is typed', () => {
    render(<ChatInput />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } });
    expect(screen.getByRole('button', { name: /send message/i })).not.toBeDisabled();
  });

  it('calls ask and clears input on button click', async () => {
    render(<ChatInput />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'my question' } });
    fireEvent.click(screen.getByRole('button', { name: /send message/i }));
    await waitFor(() => expect(aiApi.ask).toHaveBeenCalledWith('my question', expect.any(Array)));
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('submits on Enter key and ignores Shift+Enter', async () => {
    render(<ChatInput />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'enter question' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    await waitFor(() => expect(aiApi.ask).toHaveBeenCalled());

    // Shift+Enter does not submit
    jest.clearAllMocks();
    fireEvent.change(textarea, { target: { value: 'not submitted' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(aiApi.ask).not.toHaveBeenCalled();
  });
});

// ─── ChatMessage ──────────────────────────────────────────────────────────

describe('ChatMessage', () => {
  const base: AiMessage = {
    id: '1',
    role: 'user',
    content: 'Hello world',
    timestamp: new Date('2026-01-01T12:00:00Z'),
  };

  it('renders user message content', () => {
    render(<ChatMessage message={base} />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders assistant message with AI badge', () => {
    render(<ChatMessage message={{ ...base, role: 'assistant' }} />);
    expect(screen.getByText('AI')).toBeInTheDocument();
  });

  it('renders multi-line content with line breaks', () => {
    render(<ChatMessage message={{ ...base, content: 'Line1\nLine2' }} />);
    expect(screen.getByText('Line1')).toBeInTheDocument();
    expect(screen.getByText('Line2')).toBeInTheDocument();
  });

  it('renders recommendations list when provided', () => {
    render(<ChatMessage message={{ ...base, role: 'assistant', recommendations: ['Cut costs', 'Grow revenue'] }} />);
    expect(screen.getByText('Cut costs')).toBeInTheDocument();
    expect(screen.getByText('Grow revenue')).toBeInTheDocument();
  });
});

// ─── useAiSummary ─────────────────────────────────────────────────────────

describe('useAiSummary', () => {
  beforeEach(() => jest.resetAllMocks());

  it('fetches summary and returns answer + recommendations', async () => {
    (aiApi.getSummary as jest.Mock).mockResolvedValueOnce({
      data: { data: { answer: 'All good.', recommendations: ['Keep going'] } },
    });

    const { result } = renderHook(() => useAiSummary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.answer).toBe('All good.');
    expect(result.current.recommendations).toEqual(['Keep going']);
    expect(result.current.error).toBeNull();
  });

  it('sets error string when getSummary rejects', async () => {
    (aiApi.getSummary as jest.Mock).mockRejectedValueOnce(new Error('500'));

    const { result } = renderHook(() => useAiSummary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeTruthy();
    expect(result.current.recommendations).toEqual([]);
  });
});

// ─── AiRecommendations ────────────────────────────────────────────────────

describe('AiRecommendations', () => {
  beforeEach(() => jest.resetAllMocks());

  it('renders loading state', () => {
    (aiApi.getSummary as jest.Mock).mockReturnValue(new Promise(() => {}));
    render(<AiRecommendations />);
    expect(screen.getByLabelText(/loading recommendations/i)).toBeInTheDocument();
  });

  it('renders error text when fetch fails', async () => {
    (aiApi.getSummary as jest.Mock).mockRejectedValueOnce(new Error('fail'));
    render(<AiRecommendations />);
    await waitFor(() => expect(screen.getByText(/unable to load/i)).toBeInTheDocument());
  });

  it('renders empty state when recommendations is empty', async () => {
    (aiApi.getSummary as jest.Mock).mockResolvedValueOnce({
      data: { data: { answer: '', recommendations: [] } },
    });
    render(<AiRecommendations />);
    await waitFor(() => expect(screen.getByText(/no recommendations/i)).toBeInTheDocument());
  });

  it('renders recommendations with severity badges', async () => {
    (aiApi.getSummary as jest.Mock).mockResolvedValueOnce({
      data: {
        data: {
          answer: '',
          recommendations: [
            'Critical: fix urgent budget deficit',
            'Review monthly spend',
            'Keep growing',
          ],
        },
      },
    });
    render(<AiRecommendations />);
    await waitFor(() => expect(screen.getByText('Critical')).toBeInTheDocument());
    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('Info')).toBeInTheDocument();
  });
});

// ─── AiChatPanel ──────────────────────────────────────────────────────────

describe('AiChatPanel', () => {
  beforeEach(() => {
    // jsdom does not implement scrollIntoView; polyfill to prevent crashes.
    window.HTMLElement.prototype.scrollIntoView = jest.fn();
    useAiStore.setState({ isOpen: false, messages: [], isLoading: false });
    (aiApi.ask as jest.Mock).mockResolvedValue({
      data: { data: { answer: 'ok', recommendations: [] } },
    });
    (aiApi.getSummary as jest.Mock).mockResolvedValue({
      data: { data: { answer: 'summary', recommendations: [] } },
    });
  });

  it('renders FAB toggle button when closed', () => {
    render(<AiChatPanel />);
    expect(screen.getByRole('button', { name: /open ai assistant/i })).toBeInTheDocument();
  });

  it('opens the panel and shows dialog when FAB is clicked', () => {
    render(<AiChatPanel />);
    fireEvent.click(screen.getByRole('button', { name: /open ai assistant/i }));
    expect(screen.getByRole('dialog', { name: /ai assistant/i })).toBeInTheDocument();
    expect(screen.getByText(/ask about your finances/i)).toBeInTheDocument();
  });

  it('renders messages when the panel is open', () => {
    useAiStore.setState({
      isOpen: true,
      messages: [{ id: '1', role: 'user', content: 'Hi there', timestamp: new Date() }],
      isLoading: false,
    });
    render(<AiChatPanel />);
    expect(screen.getByText('Hi there')).toBeInTheDocument();
  });

  it('shows typing indicator when isLoading is true', () => {
    useAiStore.setState({ isOpen: true, messages: [], isLoading: true });
    render(<AiChatPanel />);
    expect(screen.getByLabelText(/ai is thinking/i)).toBeInTheDocument();
  });

  it('closes the panel when the close button is clicked', () => {
    useAiStore.setState({ isOpen: true, messages: [], isLoading: false });
    render(<AiChatPanel />);
    // Two buttons share this aria-label (header close + FAB); click the first (header).
    fireEvent.click(screen.getAllByRole('button', { name: /close ai assistant/i })[0]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

// ─── LiveBadge ────────────────────────────────────────────────────────────

describe('LiveBadge', () => {
  it('shows "Live" and live label when connected', () => {
    render(<LiveBadge isConnected={true} />);
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByLabelText('Live updates active')).toBeInTheDocument();
  });

  it('shows "Offline" and offline label when disconnected', () => {
    render(<LiveBadge isConnected={false} />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByLabelText('Live updates offline')).toBeInTheDocument();
  });
});

// ─── useAutoRefresh ───────────────────────────────────────────────────────

describe('useAutoRefresh', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('calls fetchFn immediately on mount when enabled', () => {
    const fetchFn = jest.fn();
    renderHook(() => useAutoRefresh(fetchFn, 5000, true));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('calls fetchFn again after interval elapses', () => {
    const fetchFn = jest.fn();
    renderHook(() => useAutoRefresh(fetchFn, 5000, true));
    act(() => jest.advanceTimersByTime(5000));
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not call fetchFn when disabled', () => {
    const fetchFn = jest.fn();
    renderHook(() => useAutoRefresh(fetchFn, 5000, false));
    act(() => jest.advanceTimersByTime(10000));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refresh() calls fetchFn when enabled', () => {
    const fetchFn = jest.fn();
    const { result } = renderHook(() => useAutoRefresh(fetchFn, 30000, true));
    fetchFn.mockClear();
    act(() => result.current.refresh());
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('refresh() does not call fetchFn when disabled', () => {
    const fetchFn = jest.fn();
    const { result } = renderHook(() => useAutoRefresh(fetchFn, 30000, false));
    act(() => result.current.refresh());
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

// ─── useAiSummary — null/non-array guards ─────────────────────────────────

describe('useAiSummary — data shape guards', () => {
  beforeEach(() => jest.resetAllMocks());

  it('defaults answer to empty string when ans is null/undefined', async () => {
    (aiApi.getSummary as jest.Mock).mockResolvedValueOnce({
      data: { data: { answer: null, recommendations: ['x'] } },
    });
    const { result } = renderHook(() => useAiSummary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.answer).toBe('');
  });

  it('defaults recommendations to empty array when response is not an array', async () => {
    (aiApi.getSummary as jest.Mock).mockResolvedValueOnce({
      data: { data: { answer: 'ok', recommendations: null } },
    });
    const { result } = renderHook(() => useAiSummary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.recommendations).toEqual([]);
  });
});
