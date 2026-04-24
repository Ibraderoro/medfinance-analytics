import styles from './Header.module.css';

export function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.logo}>
        <span className={styles.logoIcon}>🏥</span>
        <span className={styles.logoText}>MedFinance Analytics</span>
      </div>
      <nav className={styles.nav}>
        <span className={styles.badge}>CFO Dashboard</span>
      </nav>
    </header>
  );
}
