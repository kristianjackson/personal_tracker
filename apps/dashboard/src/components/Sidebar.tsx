import { NavLink } from 'react-router-dom';
import { useClinicianMode } from './ClinicianModeContext.js';
import { NAV_ITEMS, filterNavItems } from './clinician-mode-helpers.js';
import './Sidebar.css';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const { enabled: clinicianMode, toggle: toggleClinicianMode } = useClinicianMode();

  const visibleItems = filterNavItems(NAV_ITEMS, clinicianMode);

  return (
    <>
      <div
        className={`sidebar-overlay${open ? ' visible' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`sidebar${open ? ' open' : ''}${clinicianMode ? ' clinician-mode' : ''}`}
        aria-label="Main navigation"
      >
        <div className="sidebar-header">
          <span className="sidebar-logo" aria-hidden="true">
            🩺
          </span>
          <span className="sidebar-title">Symptom Tracker</span>
        </div>
        <nav className="sidebar-nav">
          <ul>
            {visibleItems.map((item) => (
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
        <div className="sidebar-footer">
          <button
            className={`clinician-toggle${clinicianMode ? ' clinician-toggle--active' : ''}`}
            onClick={toggleClinicianMode}
            aria-pressed={clinicianMode}
            title={clinicianMode ? 'Exit clinician summary mode' : 'Enter clinician summary mode'}
          >
            <span className="clinician-toggle-icon" aria-hidden="true">
              🩻
            </span>
            <span className="clinician-toggle-label">
              {clinicianMode ? 'Exit Summary' : 'Clinician View'}
            </span>
          </button>
        </div>
      </aside>
    </>
  );
}
