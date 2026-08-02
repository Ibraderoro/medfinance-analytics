import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { completeOidc } from '../services/api';
import { useAuthStore } from '../store/authStore';
import styles from './Page.module.css';

export function OidcCallbackPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const completeLogin = useAuthStore((s) => s.completeLogin);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const params = new URLSearchParams(location.search);
    const state = params.get('state')?.trim() ?? '';
    const code = params.get('code')?.trim() ?? '';

    if (!state || !code) {
      setError('Sign-in callback is missing required parameters. Please try signing in again.');
      return;
    }

    const run = async () => {
      try {
        await completeOidc(state, code);
        await completeLogin();
        navigate('/dashboard', { replace: true });
      } catch {
        setError('Unable to complete enterprise sign-in. Please try again.');
      }
    };

    void run();
  }, [location.search, navigate]);

  return (
    <div className={styles.page} style={{ maxWidth: 420, margin: '4rem auto' }}>
      <h1 className={styles.title}>Enterprise sign-in</h1>
      {error ? <p className={styles.error}>{error}</p> : <p>Completing your sign-in…</p>}
    </div>
  );
}
