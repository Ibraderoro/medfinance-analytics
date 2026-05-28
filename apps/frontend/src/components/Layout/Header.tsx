import { useNavigate } from 'react-router-dom';
import { authApi } from '../../services/api';
import styles from './Header.module.css';

export function Header({ theme = 'light', onToggleTheme = () => undefined }: { theme?: 'light' | 'dark'; onToggleTheme?: () => void }) {
  const navigate = useNavigate();

  const logout = async () => {
    try {
      await authApi.logout();
    } finally {
      sessionStorage.removeItem('auth_session_active');
      window.dispatchEvent(new Event('auth-session-changed'));
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
        <button type="button" className={styles.themeButton} onClick={onToggleTheme} aria-label="Toggle dark mode">{theme === 'light' ? '🌙 Dark' : '☀️ Light'}</button>
        <button type="button" className={styles.logoutButton} onClick={() => void logout()} aria-label="Log out of your secure session">Logout</button>
      </nav>
    </header>
  );
}
