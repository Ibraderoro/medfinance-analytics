import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import styles from './Layout.module.css';

export function Layout({ theme = 'light', onToggleTheme = () => undefined }: { theme?: 'light' | 'dark'; onToggleTheme?: () => void }) {
  return (
    <div className={styles.root}>
      <Header theme={theme} onToggleTheme={onToggleTheme} />
      <div className={styles.body}>
        <Sidebar />
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
