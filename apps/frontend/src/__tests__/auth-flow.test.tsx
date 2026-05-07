import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from '../pages/Login';
import { RegisterPage } from '../pages/Register';
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
    verifyMfa: jest.fn().mockResolvedValue({ data: { success: true, data: { session: 'created' } } }),
  },
}));

describe('Auth flow', () => {
  it('shows login API error', async () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Email'), 'a@a.com');
    await userEvent.type(screen.getByLabelText('Organization ID'), '550e8400-e29b-41d4-a716-446655440000');
    await userEvent.type(screen.getByLabelText('Password'), 'strongpass1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid email, password, or organization ID.')).toBeInTheDocument();
  });



  it('completes login when MFA is required', async () => {
    (authApi.login as jest.Mock).mockResolvedValueOnce({ data: { success: true, data: { session: 'pending_mfa', tempToken: 'temp-123' } } });
    (authApi.verifyMfa as jest.Mock).mockResolvedValueOnce({ data: { success: true, data: { session: 'created' } } });

    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Email'), 'admin@example.com');
    await userEvent.type(screen.getByLabelText('Organization ID'), '550e8400-e29b-41d4-a716-446655440000');
    await userEvent.type(screen.getByLabelText('Password'), 'strongpass1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await userEvent.type(await screen.findByLabelText('Verification code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify code' }));

    expect(authApi.verifyMfa).toHaveBeenCalledWith('temp-123', '123456');
    expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('shows register API error', async () => {
    render(<MemoryRouter><RegisterPage /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('First Name'), 'Jane');
    await userEvent.type(screen.getByLabelText('Last Name'), 'Doe');
    await userEvent.type(screen.getByLabelText('Organization ID'), '123e4567-e89b-42d3-a456-426614174000');
    await userEvent.type(screen.getByLabelText('Email'), 'jane@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'verysecurepass123');
    await userEvent.click(screen.getByRole('button', { name: 'Register' }));
    expect(await screen.findByText(/Unable to register/)).toBeInTheDocument();
  });
});
