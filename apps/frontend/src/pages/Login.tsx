import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../services/api';
import styles from './Page.module.css';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await authApi.login(email, password, organizationId);
      const { accessToken, refreshToken } = response.data.data;
      localStorage.setItem('access_token', accessToken);
      sessionStorage.setItem('refresh_token', refreshToken);
      // TODO: Move refresh token to httpOnly cookie when backend support lands.
      // Tokens should never be stored in localStorage in a healthcare application.
      // The server's Set-Cookie header handles auth persistence after this point.
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      const isAxiosError = (e: unknown): e is { response?: { status?: number; data?: { error?: { message?: string } } } } =>
        typeof e === 'object' && e !== null && 'response' in e;
      const status = isAxiosError(err) ? err.response?.status : null;
      const serverMessage = isAxiosError(err) ? err.response?.data?.error?.message : undefined;
      setError(serverMessage ?? (status === 401
        ? 'Invalid email, password, or organization ID.'
        : 'Unable to sign in. Please check your connection and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.page} style={{ maxWidth: 420, margin: '4rem auto' }}>
      <h1 className={styles.title}>Sign in</h1>
      <p style={{ marginTop: 0, color: '#6b7280' }}>Use your MedFinance credentials to access dashboards.</p>

      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <label>
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={254}
            autoComplete="email"
            style={{ width: '100%', padding: '0.65rem', marginTop: 4 }}
          />
        </label>

        <label>
          <span>Organization ID</span>
          <input
            type="text"
            value={organizationId}
            onChange={(e) => setOrganizationId(e.target.value)}
            required
            maxLength={36}
            autoComplete="organization"
            placeholder="UUID (e.g., ff6a1c0f-6d3b-8388-6b12-4e2ad21f57c5)"
            style={{ width: '100%', padding: '0.65rem', marginTop: 4 }}
          />
        </label>

        <label>
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            maxLength={128}
            autoComplete="current-password"
            style={{ width: '100%', padding: '0.65rem', marginTop: 4 }}
          />
        </label>

        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" disabled={isSubmitting} style={{ padding: '0.7rem', fontWeight: 600 }}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p style={{ margin: 0, fontSize: '0.95rem' }}>
          Don't have an account? <Link to="/register">Register here</Link>
        </p>
      </form>
    </div>
  );
}
