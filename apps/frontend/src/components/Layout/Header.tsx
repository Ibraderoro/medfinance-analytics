import { useNavigate } from 'react-router-dom';
import { authApi } from '../../services/api';
import styles from './Header.module.css';

export function Header() {
  const navigate = useNavigate();

  const logout = async () => {
    try {
      await authApi.logout();
    } finally {
      sessionStorage.removeItem('auth_session_active');
      navigate('/login', { replace: true });
    }
  };

  return (
    <header className={styles.header}>
      <div className={styles.logo}>
        <span className={styles.logoIcon}>🏥</span>
        <span className={styles.logoText}>MedFinance Analytics</span>
      </div>
      <nav className={styles.nav}>
        <span className={styles.badge}>CFO Dashboard</span>
        <button type="button" onClick={() => void logout()} aria-label="Log out of your secure session" style={{ marginLeft: 12, padding: '0.4rem 0.65rem' }}>
          Logout
        </button>
      </nav>
    </header>
  );
}
