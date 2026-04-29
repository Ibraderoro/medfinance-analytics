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
    render(<MemoryRouter><LoginPage /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Email'), 'a@a.com');
    await userEvent.type(screen.getByLabelText('Password'), 'bad');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
  });

  it('shows register API error', async () => {
    render(<MemoryRouter><RegisterPage /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('First Name'), 'Jane');
    await userEvent.type(screen.getByLabelText('Last Name'), 'Doe');
    await userEvent.type(screen.getByLabelText('Organization ID'), 'org-1');
    await userEvent.type(screen.getByLabelText('Email'), 'jane@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Register' }));
    expect(await screen.findByText(/Unable to register/)).toBeInTheDocument();
  });
});
