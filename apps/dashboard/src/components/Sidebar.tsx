import { NavLink } from 'react-router-dom';
import './Sidebar.css';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: '📊' },
  { to: '/trends', label: 'Trends', icon: '📈' },
  { to: '/notes', label: 'Notes', icon: '📝' },
  { to: '/medications', label: 'Medications', icon: '💊' },
  { to: '/flags', label: 'Flags', icon: '🚩' },
  { to: '/reports', label: 'Reports', icon: '📄' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  return (
    <>
      <div
        className={`sidebar-overlay${open ? ' visible' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Main navigation">
        <div className="sidebar-header">
          <span className="sidebar-logo" aria-hidden="true">
            🩺
          </span>
          <span className="sidebar-title">Symptom Tracker</span>
        </div>
        <nav className="sidebar-nav">
          <ul>
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `sidebar-link${isActive ? ' active' : ''}`
                  }
                  onClick={onClose}
                >
                  <span className="sidebar-link-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="sidebar-link-label">{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </>
  );
}
