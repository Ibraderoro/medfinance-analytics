import { NavLink } from 'react-router-dom';
import styles from './Sidebar.module.css';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: '📊' },
  { to: '/financials', label: 'Financials', icon: '💰' },
  { to: '/forecasting', label: 'Forecasting', icon: '📈' },
  { to: '/compliance', label: 'Compliance', icon: '🛡️' },
  { to: '/billing', label: 'Billing', icon: '💳' },
  { to: '/admin/invitations', label: 'Invites', icon: '✉️' },
];

export function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <nav aria-label="Primary application navigation">
        <ul className={styles.list}>
          {navItems.map(({ to, label, icon }) => (
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
