import { FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../services/api';
import styles from './Page.module.css';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fieldErrors = useMemo(() => ({
    email: emailPattern.test(email.trim()) ? null : 'Enter a valid email address.',
    organizationId: uuidPattern.test(organizationId.trim()) ? null : 'Organization ID must be a valid UUID.',
    password: password.length >= 8 ? null : 'Password must be at least 8 characters.',
  }), [email, organizationId, password]);


  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    setIsSubmitting(true);

    try {
      await authApi.login(email.trim(), password, organizationId.trim());
      sessionStorage.setItem('auth_session_active', 'true');
      window.dispatchEvent(new Event('auth-session-changed'));
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
      <p style={{ marginTop: 0, color: '#4b5563' }}>Use your MedFinance credentials to access dashboards.</p>

      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }} noValidate>
        <label>
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="email" style={{ width: '100%', padding: '0.65rem', marginTop: 4 }} />
          {email && fieldErrors.email && <small className={styles.error}>{fieldErrors.email}</small>}
        </label>

        <label>
          <span>Organization ID</span>
          <input type="text" value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} required maxLength={36} autoComplete="organization" placeholder="UUID (e.g., 550e8400-e29b-41d4-a716-446655440000)" style={{ width: '100%', padding: '0.65rem', marginTop: 4 }} />
          {organizationId && fieldErrors.organizationId && <small className={styles.error}>{fieldErrors.organizationId}</small>}
        </label>

        <label>
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={128} autoComplete="current-password" style={{ width: '100%', padding: '0.65rem', marginTop: 4 }} />
          {password && fieldErrors.password && <small className={styles.error}>{fieldErrors.password}</small>}
        </label>

        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" disabled={hasValidationErrors || isSubmitting} style={{ padding: '0.7rem', fontWeight: 600 }}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p style={{ margin: 0, fontSize: '0.95rem' }}>
          Don't have an account? <Link to="/register">Register here</Link>
        </p>
      </form>
    </div>
  );
}
