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

describe('OidcCallbackPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
  });

  it('shows a friendly error when state or code are missing', async () => {
    render(
      <MemoryRouter initialEntries={['/oidc/callback?state=']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/oidc/callback" element={<OidcCallbackPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/missing required parameters/i)).toBeInTheDocument();
    expect(completeOidc).not.toHaveBeenCalled();
  });

  it('completes OIDC and redirects to dashboard', async () => {
    (completeOidc as jest.Mock).mockResolvedValueOnce({ data: { success: true } });

    render(
      <MemoryRouter initialEntries={['/oidc/callback?state=state-1&code=code-1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/oidc/callback" element={<OidcCallbackPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(completeOidc).toHaveBeenCalledWith('state-1', 'code-1'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true }));
    expect(sessionStorage.getItem('auth_session_active')).toBe('true');
  });
});
