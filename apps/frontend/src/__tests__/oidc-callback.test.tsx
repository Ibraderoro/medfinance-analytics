import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OidcCallbackPage } from '../pages/OidcCallback';
import { completeOidc } from '../services/api';

const navigate = jest.fn();
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

jest.mock('../services/api', () => ({
  completeOidc: jest.fn(),
}));

const completeLoginMock = jest.fn();
jest.mock('../store/authStore', () => ({
  useAuthStore: (selector: (state: { completeLogin: () => Promise<void> }) => unknown) =>
    selector({ completeLogin: completeLoginMock }),
}));

describe('OidcCallbackPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a friendly error when state or code are missing', async () => {
    render(
      <MemoryRouter initialEntries={['/oidc/callback?state=']}>
        <Routes>
          <Route path="/oidc/callback" element={<OidcCallbackPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/missing required parameters/i)).toBeInTheDocument();
    expect(completeOidc).not.toHaveBeenCalled();
    expect(completeLoginMock).not.toHaveBeenCalled();
  });

  it('completes OIDC, hydrates the session, and redirects to dashboard', async () => {
    (completeOidc as jest.Mock).mockResolvedValueOnce({ data: { success: true } });
    completeLoginMock.mockResolvedValueOnce(undefined);

    render(
      <MemoryRouter initialEntries={['/oidc/callback?state=state-1&code=code-1']}>
        <Routes>
          <Route path="/oidc/callback" element={<OidcCallbackPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(completeOidc).toHaveBeenCalledWith('state-1', 'code-1'));
    await waitFor(() => expect(completeLoginMock).toHaveBeenCalled());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true }));
  });
});
