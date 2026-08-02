import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '../components/routing/ProtectedRoute';
import { RoleRoute } from '../components/routing/RoleRoute';
import { useAuthStore } from '../store/authStore';

function resetAuthStore() {
  useAuthStore.setState({
    status: 'idle',
    user: null,
    isRefreshing: false,
    sessionEndReason: null,
    hasCheckedSession: false,
    navigateRef: null,
  });
}

function renderProtected() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/dashboard" element={<ProtectedRoute><div>Protected content</div></ProtectedRoute>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => resetAuthStore());

  it('shows the loader before the initial session check has resolved', () => {
    renderProtected();
    expect(screen.getByText('Checking secure session')).toBeInTheDocument();
  });

  it('redirects to /login once unauthenticated', () => {
    useAuthStore.setState({ status: 'unauthenticated', hasCheckedSession: true });
    renderProtected();
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('renders children once authenticated', () => {
    useAuthStore.setState({ status: 'authenticated', hasCheckedSession: true });
    renderProtected();
    expect(screen.getByText('Protected content')).toBeInTheDocument();
  });

  it('does not show the full-page loader during a background silent refresh', () => {
    useAuthStore.setState({ status: 'authenticated', hasCheckedSession: true, isRefreshing: true });
    renderProtected();
    expect(screen.getByText('Protected content')).toBeInTheDocument();
    expect(screen.queryByText('Checking secure session')).not.toBeInTheDocument();
  });
});

function renderRoleRoute() {
  return render(
    <MemoryRouter initialEntries={['/admin/invitations']}>
      <Routes>
        <Route path="/dashboard" element={<div>Dashboard page</div>} />
        <Route
          path="/admin/invitations"
          element={<RoleRoute allow={['admin']}><div>Admin content</div></RoleRoute>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RoleRoute', () => {
  beforeEach(() => resetAuthStore());

  it('redirects away when there is no user', () => {
    renderRoleRoute();
    expect(screen.getByText('Dashboard page')).toBeInTheDocument();
  });

  it('redirects a non-admin user to the dashboard', () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: { id: '1', email: 'a@b.com', firstName: 'A', lastName: 'B', role: 'viewer', organizationId: 'org-1' },
    });
    renderRoleRoute();
    expect(screen.getByText('Dashboard page')).toBeInTheDocument();
  });

  it('renders children for an admin user', () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: { id: '1', email: 'a@b.com', firstName: 'A', lastName: 'B', role: 'admin', organizationId: 'org-1' },
    });
    renderRoleRoute();
    expect(screen.getByText('Admin content')).toBeInTheDocument();
  });
});
