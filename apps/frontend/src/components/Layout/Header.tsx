import { useNavigate } from 'react-router-dom';
import styles from './Header.module.css';

export function Header() {
  const navigate = useNavigate();

  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    navigate('/login', { replace: true });
  };

  return (
    <header className={styles.header}>
      <div className={styles.logo}>
        <span className={styles.logoIcon}>🏥</span>
        <span className={styles.logoText}>MedFinance Analytics</span>
      </div>
      <nav className={styles.nav}>
        <span className={styles.badge}>CFO Dashboard</span>
        <button type="button" onClick={logout} style={{ marginLeft: 12, padding: '0.4rem 0.65rem' }}>
          Logout
        </button>
      </nav>
    </header>
  );
}
