import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import styles from './Sidebar.module.css';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: '📊' },
  { to: '/financials', label: 'Financials', icon: '💰' },
  { to: '/forecasting', label: 'Forecasting', icon: '📈' },
  { to: '/compliance', label: 'Compliance', icon: '🛡️' },
  { to: '/billing', label: 'Billing', icon: '💳' },
  { to: '/admin/invitations', label: 'Invites', icon: '✉️', requiresRole: 'admin' as const },
];

export function Sidebar() {
  const role = useAuthStore((s) => s.user?.role);
  const visibleNavItems = navItems.filter((item) => !item.requiresRole || item.requiresRole === role);

  return (
    <aside className={styles.sidebar}>
      <nav aria-label="Primary application navigation">
        <ul className={styles.list}>
          {visibleNavItems.map(({ to, label, icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                aria-label={label}
                className={({ isActive }) =>
                  `${styles.link} ${isActive ? styles.active : ''}`
                }
              >
                <span className={styles.icon} aria-hidden="true">{icon}</span>
                <span>{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
