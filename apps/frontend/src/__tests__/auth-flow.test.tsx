import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from '../pages/Login';
import { RegisterPage } from '../pages/Register';
import { AdminInvitesPage } from '../pages/AdminInvites';
import { authApi } from '../services/api';

const navigate = jest.fn();
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

jest.mock('../services/api', () => ({
  authApi: {
    login: jest.fn().mockRejectedValue({ response: { status: 401 } }),
    register: jest.fn().mockRejectedValue(new Error('fail')),
    verifyInvitation: jest.fn().mockRejectedValue(new Error('invalid invite')),
    createInvitation: jest.fn().mockResolvedValue({ data: { success: true, data: { token: 'signed-token' } } }),
    revokeInvitation: jest.fn().mockResolvedValue({ data: { success: true, data: { revoked: true } } }),
    verifyMfa: jest.fn().mockResolvedValue({ data: { success: true, data: { session: 'created' } } }),
  },
}));

describe('Auth flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows login API error', async () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><LoginPage /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Email'), 'a@a.com');
    await userEvent.type(screen.getByLabelText('Organization ID'), '550e8400-e29b-41d4-a716-446655440000');
    await userEvent.type(screen.getByLabelText('Password'), 'strongpass1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid email, password, or organization ID.')).toBeInTheDocument();
  });

  it('completes login when MFA is required', async () => {
    (authApi.login as jest.Mock).mockResolvedValueOnce({ data: { success: true, data: { session: 'pending_mfa', tempToken: 'temp-123' } } });
    (authApi.verifyMfa as jest.Mock).mockResolvedValueOnce({ data: { success: true, data: { session: 'created' } } });

    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><LoginPage /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Email'), 'admin@example.com');
    await userEvent.type(screen.getByLabelText('Organization ID'), '550e8400-e29b-41d4-a716-446655440000');
    await userEvent.type(screen.getByLabelText('Password'), 'strongpass1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await userEvent.type(await screen.findByLabelText('Verification code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify code' }));

    expect(authApi.verifyMfa).toHaveBeenCalledWith('temp-123', '123456');
    expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('shows invite registration API error', async () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><RegisterPage /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText(/Invitation token/), 'signed-invite-token');
    await userEvent.type(screen.getByLabelText('First Name'), 'Jane');
    await userEvent.type(screen.getByLabelText('Last Name'), 'Doe');
    await userEvent.type(screen.getByLabelText('Email'), 'jane@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'verysecurepass123');
    await userEvent.click(screen.getByRole('button', { name: 'Accept invite' }));
    expect(authApi.register).toHaveBeenCalledWith(expect.objectContaining({ invitationToken: 'signed-invite-token' }));
    expect(await screen.findByText(/Unable to accept invitation/)).toBeInTheDocument();
  });

  it('prefills the invited email when an invite token verifies', async () => {
    (authApi.verifyInvitation as jest.Mock).mockResolvedValueOnce({ data: { success: true, data: { email: 'invited@example.com' } } });

    render(<MemoryRouter initialEntries={['/register?invite=verified-token']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><RegisterPage /></MemoryRouter>);

    expect(await screen.findByText('Invitation verified for invited@example.com.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('invited@example.com');
  });

  it('navigates to dashboard after successful invite registration', async () => {
    (authApi.register as jest.Mock).mockResolvedValueOnce({ data: { success: true, data: { session: 'created' } } });

    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><RegisterPage /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText(/Invitation token/), 'signed-invite-token');
    await userEvent.type(screen.getByLabelText('First Name'), 'Jane');
    await userEvent.type(screen.getByLabelText('Last Name'), 'Doe');
    await userEvent.type(screen.getByLabelText('Email'), 'jane@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'verysecurepass123');
    await userEvent.click(screen.getByRole('button', { name: 'Accept invite' }));

    expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('shows fallback admin invitation errors when no server message is available', async () => {
    (authApi.createInvitation as jest.Mock).mockResolvedValueOnce({ data: { success: true, data: {} } });
    (authApi.revokeInvitation as jest.Mock).mockRejectedValueOnce(new Error('network'));

    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AdminInvitesPage /></MemoryRouter>);

    await userEvent.type(screen.getByLabelText('Email'), 'new.user@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
    expect(await screen.findByText('Unable to create invitation. Confirm you are an organization admin.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Invitation ID'), 'invite-123');
    await userEvent.click(screen.getByRole('button', { name: 'Revoke pending invitation' }));
    expect(await screen.findByText('Unable to revoke invitation.')).toBeInTheDocument();
  });

  it('creates and revokes admin invitations', async () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AdminInvitesPage /></MemoryRouter>);

    await userEvent.type(screen.getByLabelText('Email'), 'new.user@example.com');
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'analyst');
    await userEvent.clear(screen.getByLabelText('Expires in hours'));
    await userEvent.type(screen.getByLabelText('Expires in hours'), '24');
    await userEvent.click(screen.getByRole('button', { name: 'Create invitation' }));

    expect(authApi.createInvitation).toHaveBeenCalledWith({ email: 'new.user@example.com', role: 'analyst', expiresInHours: 24 });
    expect(await screen.findByText(/Invitation created/)).toBeInTheDocument();
    expect(screen.getByText(/signed-token/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Invitation ID'), 'invite-123');
    await userEvent.click(screen.getByRole('button', { name: 'Revoke pending invitation' }));

    expect(authApi.revokeInvitation).toHaveBeenCalledWith('invite-123');
    expect(await screen.findByText('Invitation revoked if it was pending in your organization.')).toBeInTheDocument();
  });

  it('shows admin invitation API errors', async () => {
    (authApi.createInvitation as jest.Mock).mockRejectedValueOnce({ response: { data: { error: { message: 'Admin required' } } } });
    (authApi.revokeInvitation as jest.Mock).mockRejectedValueOnce({ response: { data: { error: { message: 'Cannot revoke' } } } });

    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AdminInvitesPage /></MemoryRouter>);

    await userEvent.type(screen.getByLabelText('Email'), 'new.user@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
    expect(await screen.findByText('Admin required')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Invitation ID'), 'invite-123');
    await userEvent.click(screen.getByRole('button', { name: 'Revoke pending invitation' }));
    expect(await screen.findByText('Cannot revoke')).toBeInTheDocument();
  });
});
