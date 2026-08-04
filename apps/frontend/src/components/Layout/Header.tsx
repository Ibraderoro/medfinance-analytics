import { useAuthStore } from '../../store/authStore';
import styles from './Header.module.css';

export function Header({ theme = 'light', onToggleTheme = () => undefined }: { theme?: 'light' | 'dark'; onToggleTheme?: () => void }) {
  const logout = useAuthStore((s) => s.logout);

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
