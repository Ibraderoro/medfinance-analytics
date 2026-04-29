import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../services/api';
import styles from './Page.module.css';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await authApi.login(email, password);
      // TODO: Backend must set httpOnly cookies for access_token and refresh_token.
      // Tokens should never be stored in localStorage in a healthcare application.
      // The server's Set-Cookie header handles auth persistence after this point.
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      const isAxiosError = (e: unknown): e is { response?: { status?: number } } =>
        typeof e === 'object' && e !== null && 'response' in e;
      const status = isAxiosError(err) ? err.response?.status : null;
      setError(
        status === 401
          ? 'Invalid email or password.'
          : 'Unable to sign in. Please check your connection and try again.'
      );
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
      </form>
    </div>
  );
}
