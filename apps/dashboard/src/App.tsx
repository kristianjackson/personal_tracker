import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.js';
import OverviewPage from './pages/OverviewPage.js';
import TrendsPage from './pages/TrendsPage.js';
import NotesPage from './pages/NotesPage.js';
import MedicationsPage from './pages/MedicationsPage.js';
import FlagsPage from './pages/FlagsPage.js';
import ReportsPage from './pages/ReportsPage.js';
import SettingsPage from './pages/SettingsPage.js';
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<OverviewPage />} />
          <Route path="trends" element={<TrendsPage />} />
          <Route path="notes" element={<NotesPage />} />
          <Route path="medications" element={<MedicationsPage />} />
          <Route path="flags" element={<FlagsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
