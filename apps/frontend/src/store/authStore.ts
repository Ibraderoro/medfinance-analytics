import { create } from 'zustand';
import { authApi } from '../services/api';

export type AuthStatus = 'idle' | 'checking' | 'authenticated' | 'unauthenticated';
export type SessionEndReason = 'expired' | 'other-tab' | null;

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'analyst' | 'viewer';
  organizationId: string;
}

type NavigateFn = (path: string, opts?: { replace?: boolean; state?: unknown }) => void;

interface AuthState {
  status: AuthStatus;
  user: SessionUser | null;
  isRefreshing: boolean;
  sessionEndReason: SessionEndReason;
  hasCheckedSession: boolean;
  navigateRef: NavigateFn | null;

  setNavigate: (fn: NavigateFn | null) => void;
  restoreSession: () => Promise<void>;
  completeLogin: () => Promise<void>;
  silentRefresh: () => Promise<boolean>;
  logout: (opts?: { reason?: SessionEndReason }) => Promise<void>;
  clearLocal: (reason?: SessionEndReason) => void;
}

const LOGOUT_BROADCAST_KEY = 'auth_logout_broadcast';
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('medfinance-auth') : null;

// Module-level (not component state) so concurrent callers from the axios
// interceptor share a single in-flight refresh instead of racing the
// backend's rotate-on-use refresh tokens.
let refreshPromise: Promise<boolean> | null = null;

function extractUser(responseData: unknown): SessionUser {
  const user = (responseData as { data?: { user?: SessionUser } } | undefined)?.data?.user;
  if (!user) throw new Error('Malformed session response');
  return user;
}

function isAxios401(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'response' in err
    && (err as { response?: { status?: number } }).response?.status === 401;
}

function broadcastLogout(): void {
  if (channel) {
    channel.postMessage({ type: 'logout' });
    return;
  }
  try {
    localStorage.setItem(LOGOUT_BROADCAST_KEY, String(Date.now()));
  } catch {
    // storage may be unavailable (private browsing); cross-tab sync is best-effort
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'idle',
  user: null,
  isRefreshing: false,
  sessionEndReason: null,
  hasCheckedSession: false,
  navigateRef: null,

  setNavigate: (fn) => set({ navigateRef: fn }),

  restoreSession: async () => {
    set({ status: 'checking' });
    try {
      const res = await authApi.getSession();
      set({ status: 'authenticated', user: extractUser(res.data), hasCheckedSession: true, sessionEndReason: null });
      return;
    } catch (err) {
      if (!isAxios401(err)) {
        set({ status: 'unauthenticated', user: null, hasCheckedSession: true });
        return;
      }
    }

    // Access token missing/expired on first load — attempt one silent
    // refresh before declaring the session dead.
    const refreshed = await get().silentRefresh();
    set({ hasCheckedSession: true, ...(refreshed ? {} : { status: 'unauthenticated' as const, user: null }) });
  },

  completeLogin: async () => {
    const res = await authApi.getSession();
    set({ status: 'authenticated', user: extractUser(res.data), hasCheckedSession: true, sessionEndReason: null });
  },

  silentRefresh: () => {
    if (refreshPromise) return refreshPromise;

    set({ isRefreshing: true });
    refreshPromise = (async () => {
      try {
        await authApi.refresh();
        const res = await authApi.getSession();
        set({ status: 'authenticated', user: extractUser(res.data), sessionEndReason: null });
        return true;
      } catch {
        get().clearLocal('expired');
        return false;
      } finally {
        set({ isRefreshing: false });
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  },

  logout: async (opts) => {
    const reason = opts?.reason;
    try {
      await authApi.logout();
    } catch {
      // best-effort — backend logout is idempotent and clears cookies regardless
    }
    get().clearLocal(reason);
    broadcastLogout();
    get().navigateRef?.('/login', { replace: true, state: reason ? { reason } : undefined });
  },

  clearLocal: (reason) => {
    set({
      status: 'unauthenticated',
      user: null,
      isRefreshing: false,
      hasCheckedSession: true,
      sessionEndReason: reason ?? null,
    });
  },
}));

function handleRemoteLogout(): void {
  const store = useAuthStore.getState();
  if (store.status === 'unauthenticated') return;
  store.clearLocal('other-tab');
  store.navigateRef?.('/login', { replace: true, state: { reason: 'other-tab' } });
}

if (typeof window !== 'undefined') {
  channel?.addEventListener('message', (event: MessageEvent) => {
    if ((event.data as { type?: string } | undefined)?.type === 'logout') handleRemoteLogout();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === LOGOUT_BROADCAST_KEY && event.newValue) handleRemoteLogout();
  });
}
