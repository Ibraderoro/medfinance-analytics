import { FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../services/api';
import styles from './Page.module.css';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function RegisterPage() {
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fieldErrors = useMemo(() => ({
    firstName: firstName.trim().length >= 2 ? null : 'First name must be at least 2 characters.',
    lastName: lastName.trim().length >= 2 ? null : 'Last name must be at least 2 characters.',
    organizationId: uuidPattern.test(organizationId.trim()) ? null : 'Organization ID must be a valid UUID.',
    email: emailPattern.test(email.trim()) ? null : 'Enter a valid email address.',
    password: password.length >= 12 ? null : 'Password must be at least 12 characters.',
  }), [email, firstName, lastName, organizationId, password]);

  const hasValidationErrors = Object.values(fieldErrors).some(Boolean);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    setIsSubmitting(true);
    try {
      await authApi.register({ firstName: firstName.trim(), lastName: lastName.trim(), organizationId: organizationId.trim(), email: email.trim(), password });
      sessionStorage.setItem('auth_session_active', 'true');
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      const isAxiosError = (e: unknown): e is { response?: { data?: { error?: { message?: string } | string } } } =>
        typeof e === 'object' && e !== null && 'response' in e;
      const serverError = isAxiosError(err) ? err.response?.data?.error : undefined;
      const serverMessage = typeof serverError === 'string' ? serverError : serverError?.message;
      setError(serverMessage ?? 'Unable to register. Please check your details and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.page} style={{ maxWidth: 420, margin: '4rem auto' }}>
      <h1 className={styles.title}>Create account</h1>
      <p style={{ marginTop: 0, color: '#4b5563' }}>Register to access your MedFinance dashboards.</p>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }} noValidate>
        <label><span>First Name</span><input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={100} autoComplete="given-name" style={{ width: '100%', padding: '0.65rem', marginTop: 4 }} />{firstName && fieldErrors.firstName && <small className={styles.error}>{fieldErrors.firstName}</small>}</label>
        <label><span>Last Name</span><input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required maxLength={100} autoComplete="family-name" style={{ width: '100%', padding: '0.65rem', marginTop: 4 }} />{lastName && fieldErrors.lastName && <small className={styles.error}>{fieldErrors.lastName}</small>}</label>
        <label><span>Organization ID</span><input type="text" value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} required maxLength={36} autoComplete="organization" placeholder="UUID (e.g., ff6a1c0f-6d3b-8388-6b12-4e2ad21f57c5)" style={{ width: '100%', padding: '0.65rem', marginTop: 4 }} />{organizationId && fieldErrors.organizationId && <small className={styles.error}>{fieldErrors.organizationId}</small>}</label>
        <label><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="email" style={{ width: '100%', padding: '0.65rem', marginTop: 4 }} />{email && fieldErrors.email && <small className={styles.error}>{fieldErrors.email}</small>}</label>
        <label><span>Password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={128} autoComplete="new-password" style={{ width: '100%', padding: '0.65rem', marginTop: 4 }} />{password && fieldErrors.password && <small className={styles.error}>{fieldErrors.password}</small>}</label>
        {error && <p className={styles.error}>{error}</p>}
        <button type="submit" disabled={isSubmitting} style={{ padding: '0.7rem', fontWeight: 600 }}>{isSubmitting ? 'Creating account…' : 'Register'}</button>
        <p style={{ margin: 0, fontSize: '0.95rem' }}>Already have an account? <Link to="/login">Sign in</Link></p>
      </form>
    </div>
  );
}
