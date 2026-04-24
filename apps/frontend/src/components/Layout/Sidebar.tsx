import { NavLink } from 'react-router-dom';
import styles from './Sidebar.module.css';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: '📊' },
  { to: '/financials', label: 'Financials', icon: '💰' },
  { to: '/forecasting', label: 'Forecasting', icon: '📈' },
  { to: '/compliance', label: 'Compliance', icon: '🛡️' },
];

export function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <nav>
        <ul className={styles.list}>
          {navItems.map(({ to, label, icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  `${styles.link} ${isActive ? styles.active : ''}`
                }
              >
                <span className={styles.icon}>{icon}</span>
                <span>{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
