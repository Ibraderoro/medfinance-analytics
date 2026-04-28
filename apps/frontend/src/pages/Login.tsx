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
      const res = await authApi.login(email, password);
      const tokens = res.data.data;

      localStorage.setItem('access_token', tokens.accessToken);
      localStorage.setItem('refresh_token', tokens.refreshToken);
      navigate('/dashboard', { replace: true });
    } catch {
      setError('Login failed. Check your email/password and try again.');
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
