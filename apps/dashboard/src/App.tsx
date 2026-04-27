import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ClinicianModeProvider, useClinicianMode } from './components/ClinicianModeContext.js';
import Layout from './components/Layout.js';
import OverviewPage from './pages/OverviewPage.js';
import TrendsPage from './pages/TrendsPage.js';
import NotesPage from './pages/NotesPage.js';
import MedicationsPage from './pages/MedicationsPage.js';
import FlagsPage from './pages/FlagsPage.js';
import ReportsPage from './pages/ReportsPage.js';
import SettingsPage from './pages/SettingsPage.js';
import './App.css';

/**
 * Redirects to overview when clinician mode is active and the user
 * navigates to an admin-only route (reports, settings).
 */
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { enabled } = useClinicianMode();
  if (enabled) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ClinicianModeProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<OverviewPage />} />
            <Route path="trends" element={<TrendsPage />} />
            <Route path="notes" element={<NotesPage />} />
            <Route path="medications" element={<MedicationsPage />} />
            <Route path="flags" element={<FlagsPage />} />
            <Route
              path="reports"
              element={
                <AdminRoute>
                  <ReportsPage />
                </AdminRoute>
              }
            />
            <Route
              path="settings"
              element={
                <AdminRoute>
                  <SettingsPage />
                </AdminRoute>
              }
            />
          </Route>
        </Routes>
      </ClinicianModeProvider>
    </BrowserRouter>
  );
}
