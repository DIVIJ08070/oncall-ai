import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/shell/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import {
  OnboardingPage,
  IncidentDetailPage,
  IncidentsListPage,
  DemoControlPage,
} from './pages/stubs';

/**
 * Route tree (SPEC §6 / DESIGN_SPEC §5). Every route renders inside `AppShell`.
 * `/` = Dashboard (C12). `/incidents` + `/incidents/:id` (C13), `/onboarding`
 * (C14), `/demo` (C15) are stubbed seams. Unknown routes redirect to `/`.
 */
export function AppRoutes() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/incidents" element={<IncidentsListPage />} />
        <Route path="/incidents/:id" element={<IncidentDetailPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/demo" element={<DemoControlPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
