import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../services/api';
import styles from './Page.module.css';

export function RegisterPage() {
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await authApi.register({
        firstName,
        lastName,
        organizationId,
        email,
        password,
      });
      const { accessToken, refreshToken } = response.data.data;
      localStorage.setItem('access_token', accessToken);
      sessionStorage.setItem('refresh_token', refreshToken);
      navigate('/dashboard', { replace: true });
    } catch {
      setError('Unable to register. Please check your details and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.page} style={{ maxWidth: 420, margin: '4rem auto' }}>
      <h1 className={styles.title}>Create account</h1>
      <p style={{ marginTop: 0, color: '#6b7280' }}>Register to access your MedFinance dashboards.</p>

      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <label>
          <span>First Name</span>
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            maxLength={100}
            autoComplete="given-name"
            style={{ width: '100%', padding: '0.65rem', marginTop: 4 }}
          />
        </label>

        <label>
          <span>Last Name</span>
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
            maxLength={100}
            autoComplete="family-name"
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
            maxLength={100}
            autoComplete="organization"
            style={{ width: '100%', padding: '0.65rem', marginTop: 4 }}
          />
        </label>

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
            autoComplete="new-password"
            style={{ width: '100%', padding: '0.65rem', marginTop: 4 }}
          />
        </label>

        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" disabled={isSubmitting} style={{ padding: '0.7rem', fontWeight: 600 }}>
          {isSubmitting ? 'Creating account…' : 'Register'}
        </button>

        <p style={{ margin: 0, fontSize: '0.95rem' }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
