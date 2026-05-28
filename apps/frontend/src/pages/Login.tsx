import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../services/api';
import styles from './Page.module.css';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isAxiosError = (e: unknown): e is { response?: { status?: number; data?: { error?: { message?: string } } } } =>
  typeof e === 'object' && e !== null && 'response' in e;

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingMfaToken, setPendingMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const mfaInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pendingMfaToken) {
      mfaInputRef.current?.focus();
    }
  }, [pendingMfaToken]);

  const fieldErrors = useMemo(() => ({
    email: emailPattern.test(email.trim()) ? null : 'Enter a valid email address.',
    organizationId: uuidPattern.test(organizationId.trim()) ? null : 'Organization ID must be a valid UUID.',
    password: pendingMfaToken || password.length >= 8 ? null : 'Password must be at least 8 characters.',
    mfaCode: !pendingMfaToken || (/^\d{6}$/.test(mfaCode.trim()) || /^[A-Fa-f0-9]{8}-?[A-Fa-f0-9]{8}$/.test(mfaCode.trim())) ? null : 'Enter the 6-digit verification code or recovery code.',
  }), [email, organizationId, password, pendingMfaToken, mfaCode]);
  const hasValidationErrors = Object.values(fieldErrors).some(Boolean);

  const startSso = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await authApi.initiateOidc(email.trim(), organizationId.trim());
      const data = response.data?.data as { authorizationUrl?: string; state?: string } | undefined;
      if (data?.authorizationUrl) {
        window.location.assign(data.authorizationUrl);
        return;
      }
      setError('SSO is initiated. Continue with your identity provider using the returned state.');
    } catch (err: unknown) {
      setError(isAxiosError(err) ? err.response?.data?.error?.message ?? 'Unable to start SSO.' : 'Unable to start SSO.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    setIsSubmitting(true);

    try {
      if (pendingMfaToken) {
        await authApi.verifyMfa(pendingMfaToken, mfaCode.trim());
        sessionStorage.setItem('auth_session_active', 'true');
        window.dispatchEvent(new Event('auth-session-changed'));
        navigate('/dashboard', { replace: true });
        return;
      }

      const response = await authApi.login(email.trim(), password, organizationId.trim());
      const data = response.data?.data as { session?: string; tempToken?: string } | undefined;
      if (data?.session === 'pending_mfa' && data.tempToken) {
        setPendingMfaToken(data.tempToken);
        setPassword('');
        return;
      }

      sessionStorage.setItem('auth_session_active', 'true');
      window.dispatchEvent(new Event('auth-session-changed'));
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      const status = isAxiosError(err) ? err.response?.status : null;
      const serverMessage = isAxiosError(err) ? err.response?.data?.error?.message : undefined;
      setError(serverMessage ?? (status === 401
        ? (pendingMfaToken ? 'Invalid or expired verification code.' : 'Invalid email, password, or organization ID.')
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
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="email" disabled={Boolean(pendingMfaToken)} style={{ width: '100%', padding: '0.65rem', marginTop: 4 }} />
          {email && fieldErrors.email && <small className={styles.error}>{fieldErrors.email}</small>}
        </label>

        <label>
          <span>Organization ID</span>
          <input type="text" value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} required maxLength={36} autoComplete="organization" disabled={Boolean(pendingMfaToken)} placeholder="UUID (e.g., 550e8400-e29b-41d4-a716-446655440000)" style={{ width: '100%', padding: '0.65rem', marginTop: 4 }} />
          {organizationId && fieldErrors.organizationId && <small className={styles.error}>{fieldErrors.organizationId}</small>}
        </label>

        <label>
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={128} autoComplete="current-password" disabled={Boolean(pendingMfaToken)} style={{ width: '100%', padding: '0.65rem', marginTop: 4 }} />
          {password && fieldErrors.password && <small className={styles.error}>{fieldErrors.password}</small>}
        </label>

        {pendingMfaToken && (
          <label>
            <span>Verification code</span>
            <input ref={mfaInputRef} type="text" inputMode="text" pattern="([0-9]{6}|[A-Fa-f0-9]{8}-?[A-Fa-f0-9]{8})" value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/[^A-Fa-f0-9-]/g, '').slice(0, 17))} required maxLength={17} autoComplete="one-time-code" style={{ width: '100%', padding: '0.65rem', marginTop: 4 }} />
            {mfaCode && fieldErrors.mfaCode && <small className={styles.error}>{fieldErrors.mfaCode}</small>}
          </label>
        )}

        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" disabled={hasValidationErrors || isSubmitting} style={{ padding: '0.7rem', fontWeight: 600 }}>
          {isSubmitting ? (pendingMfaToken ? 'Verifying…' : 'Signing in…') : (pendingMfaToken ? 'Verify code' : 'Sign in')}
        </button>
        {!pendingMfaToken && (
          <button type="button" disabled={Boolean(fieldErrors.email || fieldErrors.organizationId) || isSubmitting} onClick={startSso} style={{ padding: '0.7rem' }}>
            Continue with enterprise SSO
          </button>
        )}
        {pendingMfaToken && (
          <button type="button" disabled={isSubmitting} onClick={() => { setPendingMfaToken(null); setMfaCode(''); setError(null); }} style={{ padding: '0.7rem' }}>
            Use a different account
          </button>
        )}

        <p style={{ margin: 0, fontSize: '0.95rem' }}>
          Don't have an account? <Link to="/register">Register here</Link>
        </p>
      </form>
    </div>
  );
}
