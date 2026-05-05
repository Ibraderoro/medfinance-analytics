import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from '../pages/Login';
import { RegisterPage } from '../pages/Register';

const navigate = jest.fn();
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

jest.mock('../services/api', () => ({
  authApi: {
    login: jest.fn().mockRejectedValue({ response: { status: 401 } }),
    register: jest.fn().mockRejectedValue(new Error('fail')),
  },
}));

describe('Auth flow', () => {
  it('shows login API error', async () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><LoginPage /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Email'), 'a@a.com');
    await userEvent.type(screen.getByLabelText('Organization ID'), '550e8400-e29b-41d4-a716-446655440000');
    await userEvent.type(screen.getByLabelText('Password'), 'strongpass1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid email, password, or organization ID.')).toBeInTheDocument();
  });

  it('shows register API error', async () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><RegisterPage /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('First Name'), 'Jane');
    await userEvent.type(screen.getByLabelText('Last Name'), 'Doe');
    await userEvent.type(screen.getByLabelText('Organization ID'), '123e4567-e89b-42d3-a456-426614174000');
    await userEvent.type(screen.getByLabelText('Email'), 'jane@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'verysecurepass123');
    await userEvent.click(screen.getByRole('button', { name: 'Register' }));
    expect(await screen.findByText(/Unable to register/)).toBeInTheDocument();
  });
});
