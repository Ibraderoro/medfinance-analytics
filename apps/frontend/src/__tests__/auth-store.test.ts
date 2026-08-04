import { useAuthStore, type SessionUser } from '../store/authStore';
import { authApi } from '../services/api';

jest.mock('../services/api', () => ({
  authApi: {
    getSession: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
  },
}));

const getSessionMock = authApi.getSession as jest.Mock;
const refreshMock = authApi.refresh as jest.Mock;
const logoutMock = authApi.logout as jest.Mock;

const sessionResponse = (overrides: Partial<{ id: string; role: SessionUser['role'] }> = {}) => ({
  data: {
    data: {
      user: {
        id: overrides.id ?? 'user-1',
        email: 'user@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        role: overrides.role ?? 'admin',
        organizationId: 'org-1',
      },
    },
  },
});

function resetStore() {
  useAuthStore.setState({
    status: 'idle',
    user: null,
    isRefreshing: false,
    sessionEndReason: null,
    hasCheckedSession: false,
    navigateRef: null,
  });
}

describe('useAuthStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    resetStore();
  });

  describe('restoreSession', () => {
    it('authenticates immediately when /auth/me succeeds', async () => {
      getSessionMock.mockResolvedValueOnce(sessionResponse());

      await useAuthStore.getState().restoreSession();

      expect(useAuthStore.getState().status).toBe('authenticated');
      expect(useAuthStore.getState().user?.id).toBe('user-1');
      expect(useAuthStore.getState().hasCheckedSession).toBe(true);
      expect(refreshMock).not.toHaveBeenCalled();
    });

    it('falls back to a silent refresh on a 401 and succeeds', async () => {
      getSessionMock
        .mockRejectedValueOnce({ response: { status: 401 } })
        .mockResolvedValueOnce(sessionResponse());
      refreshMock.mockResolvedValueOnce({});

      await useAuthStore.getState().restoreSession();

      expect(refreshMock).toHaveBeenCalledTimes(1);
      expect(useAuthStore.getState().status).toBe('authenticated');
      expect(useAuthStore.getState().hasCheckedSession).toBe(true);
    });

    it('ends unauthenticated when the fallback refresh also fails', async () => {
      getSessionMock.mockRejectedValueOnce({ response: { status: 401 } });
      refreshMock.mockRejectedValueOnce({ response: { status: 401 } });

      await useAuthStore.getState().restoreSession();

      expect(useAuthStore.getState().status).toBe('unauthenticated');
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().hasCheckedSession).toBe(true);
    });

    it('fails closed (unauthenticated) on a non-401 network error without attempting a refresh', async () => {
      getSessionMock.mockRejectedValueOnce(new Error('network down'));

      await useAuthStore.getState().restoreSession();

      expect(refreshMock).not.toHaveBeenCalled();
      expect(useAuthStore.getState().status).toBe('unauthenticated');
    });
  });

  describe('silentRefresh', () => {
    it('deduplicates concurrent callers into a single /auth/refresh call', async () => {
      refreshMock.mockResolvedValueOnce({});
      getSessionMock.mockResolvedValueOnce(sessionResponse());

      const [first, second] = await Promise.all([
        useAuthStore.getState().silentRefresh(),
        useAuthStore.getState().silentRefresh(),
      ]);

      expect(refreshMock).toHaveBeenCalledTimes(1);
      expect(first).toBe(true);
      expect(second).toBe(true);
    });

    it('clears local session state and marks it expired on failure', async () => {
      refreshMock.mockRejectedValueOnce({ response: { status: 401 } });

      const result = await useAuthStore.getState().silentRefresh();

      expect(result).toBe(false);
      expect(useAuthStore.getState().status).toBe('unauthenticated');
      expect(useAuthStore.getState().sessionEndReason).toBe('expired');
    });
  });

  describe('logout', () => {
    it('clears state, broadcasts to other tabs, and navigates to /login', async () => {
      logoutMock.mockResolvedValueOnce({});
      useAuthStore.setState({ status: 'authenticated', user: sessionResponse().data.data.user, hasCheckedSession: true });
      const navigate = jest.fn();
      useAuthStore.getState().setNavigate(navigate);

      await useAuthStore.getState().logout();

      expect(logoutMock).toHaveBeenCalled();
      expect(useAuthStore.getState().status).toBe('unauthenticated');
      expect(useAuthStore.getState().user).toBeNull();
      expect(navigate).toHaveBeenCalledWith('/login', { replace: true, state: undefined });
    });

    it('still clears local state and navigates even if the server call fails', async () => {
      logoutMock.mockRejectedValueOnce(new Error('network down'));
      const navigate = jest.fn();
      useAuthStore.getState().setNavigate(navigate);

      await useAuthStore.getState().logout({ reason: 'expired' });

      expect(useAuthStore.getState().status).toBe('unauthenticated');
      expect(navigate).toHaveBeenCalledWith('/login', { replace: true, state: { reason: 'expired' } });
    });
  });

  describe('cross-tab logout', () => {
    it('reacts to a storage broadcast from another tab without calling the server again', () => {
      useAuthStore.setState({ status: 'authenticated', user: sessionResponse().data.data.user, hasCheckedSession: true });
      const navigate = jest.fn();
      useAuthStore.getState().setNavigate(navigate);

      window.dispatchEvent(new StorageEvent('storage', { key: 'auth_logout_broadcast', newValue: String(Date.now()) }));

      expect(useAuthStore.getState().status).toBe('unauthenticated');
      expect(useAuthStore.getState().sessionEndReason).toBe('other-tab');
      expect(logoutMock).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith('/login', { replace: true, state: { reason: 'other-tab' } });
    });

    it('ignores unrelated storage keys', () => {
      useAuthStore.setState({ status: 'authenticated', user: sessionResponse().data.data.user, hasCheckedSession: true });

      window.dispatchEvent(new StorageEvent('storage', { key: 'theme_mode', newValue: 'dark' }));

      expect(useAuthStore.getState().status).toBe('authenticated');
    });
  });

  describe('cross-tab broadcast mechanism selection', () => {
    afterEach(() => {
      delete (global as { BroadcastChannel?: unknown }).BroadcastChannel;
    });

    it('prefers BroadcastChannel.postMessage over the localStorage fallback when available', async () => {
      const postMessage = jest.fn();
      class FakeBroadcastChannel {
        addEventListener = jest.fn();
        removeEventListener = jest.fn();
        postMessage = postMessage;
        close = jest.fn();
      }
      (global as unknown as { BroadcastChannel: unknown }).BroadcastChannel = FakeBroadcastChannel;

      jest.resetModules();
      const freshApi = await import('../services/api');
      (freshApi.authApi.logout as jest.Mock).mockResolvedValueOnce({});
      const { useAuthStore: freshAuthStore } = await import('../store/authStore');

      await freshAuthStore.getState().logout();

      expect(postMessage).toHaveBeenCalledWith({ type: 'logout' });
    });
  });
});
