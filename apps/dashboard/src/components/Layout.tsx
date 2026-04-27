import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.js';
import { useClinicianMode } from './ClinicianModeContext.js';
import './Layout.css';

const DISCLAIMER =
  'This is a personal tracking tool, not a medical device. It does not provide diagnosis, treatment advice, or emergency support. If you are in crisis, contact your clinician or call 988.';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { enabled: clinicianMode } = useClinicianMode();

  return (
    <div className={`layout${clinicianMode ? ' clinician-mode' : ''}`}>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <header className="layout-header">
        <button
          className="menu-button"
          onClick={() => setSidebarOpen((prev) => !prev)}
          aria-label="Toggle navigation menu"
        >
          ☰
        </button>
        <h1>Symptom Tracker</h1>
        {clinicianMode && (
          <span className="clinician-badge" aria-label="Clinician summary mode active">
            Clinician Summary
          </span>
        )}
      </header>

      <div className="layout-body">
        <main className="layout-main">
          <Outlet />
        </main>

        <footer className="layout-footer">
          <p className="disclaimer">{DISCLAIMER}</p>
        </footer>
      </div>
    </div>
  );
}
