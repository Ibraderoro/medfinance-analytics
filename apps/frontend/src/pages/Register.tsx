import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../services/api';
import styles from './Page.module.css';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [invitationToken, setInvitationToken] = useState(searchParams.get('invite') ?? '');
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!invitationToken.trim()) {
      setInvitedEmail(null);
      return;
    }
    let cancelled = false;
    setIsVerifying(true);
    authApi.verifyInvitation(invitationToken.trim())
      .then((response) => {
        if (cancelled) return;
        const verifiedEmail = response.data?.data?.email as string | undefined;
        setInvitedEmail(verifiedEmail ?? null);
        if (verifiedEmail) setEmail(verifiedEmail);
      })
      .catch(() => {
        if (!cancelled) setInvitedEmail(null);
      })
      .finally(() => {
        if (!cancelled) setIsVerifying(false);
      });
    return () => { cancelled = true; };
  }, [invitationToken]);

  const fieldErrors = useMemo(() => ({
    firstName: firstName.trim().length >= 2 ? null : 'First name must be at least 2 characters.',
    lastName: lastName.trim().length >= 2 ? null : 'Last name must be at least 2 characters.',
    invitationToken: invitationToken.trim().length > 0 ? null : 'A signed invitation token is required.',
    email: emailPattern.test(email.trim()) ? null : 'Enter a valid email address.',
    password: password.length >= 12 ? null : 'Password must be at least 12 characters.',
  }), [email, firstName, invitationToken, lastName, password]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    setIsSubmitting(true);
    try {
      await authApi.register({ firstName: firstName.trim(), lastName: lastName.trim(), invitationToken: invitationToken.trim(), email: email.trim(), password });
      sessionStorage.setItem('auth_session_active', 'true');
      window.dispatchEvent(new Event('auth-session-changed'));
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      const isAxiosError = (e: unknown): e is { response?: { data?: { error?: { message?: string } | string } } } =>
        typeof e === 'object' && e !== null && 'response' in e;
      const serverError = isAxiosError(err) ? err.response?.data?.error : undefined;
      const serverMessage = typeof serverError === 'string' ? serverError : serverError?.message;
      setError(serverMessage ?? 'Unable to accept invitation. Please check your link and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.page} style={{ maxWidth: 420, margin: '4rem auto' }}>
      <h1 className={styles.title}>Accept invitation</h1>
      <p style={{ marginTop: 0, color: '#4b5563' }}>Create your account using a signed invitation from your organization admin.</p>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }} noValidate>
        <label><span>Invitation token</span><textarea value={invitationToken} onChange={(e) => setInvitationToken(e.target.value)} required rows={3} autoComplete="off" style={{ width: '100%', padding: '0.65rem', marginTop: 4 }} />{fieldErrors.invitationToken && <small className={styles.error}>{fieldErrors.invitationToken}</small>}</label>
        {isVerifying && <small>Verifying invitation…</small>}
        {invitedEmail && <small>Invitation verified for {invitedEmail}.</small>}
        <label><span>First Name</span><input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={100} autoComplete="given-name" style={{ width: '100%', padding: '0.65rem', marginTop: 4 }} />{firstName && fieldErrors.firstName && <small className={styles.error}>{fieldErrors.firstName}</small>}</label>
        <label><span>Last Name</span><input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required maxLength={100} autoComplete="family-name" style={{ width: '100%', padding: '0.65rem', marginTop: 4 }} />{lastName && fieldErrors.lastName && <small className={styles.error}>{fieldErrors.lastName}</small>}</label>
        <label><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="email" style={{ width: '100%', padding: '0.65rem', marginTop: 4 }} />{email && fieldErrors.email && <small className={styles.error}>{fieldErrors.email}</small>}</label>
        <label><span>Password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={128} autoComplete="new-password" style={{ width: '100%', padding: '0.65rem', marginTop: 4 }} />{password && fieldErrors.password && <small className={styles.error}>{fieldErrors.password}</small>}</label>
        {error && <p className={styles.error}>{error}</p>}
        <button type="submit" disabled={isSubmitting} style={{ padding: '0.7rem', fontWeight: 600 }}>{isSubmitting ? 'Creating account…' : 'Accept invite'}</button>
        <p style={{ margin: 0, fontSize: '0.95rem' }}>Already have an account? <Link to="/login">Sign in</Link></p>
      </form>
    </div>
  );
}
