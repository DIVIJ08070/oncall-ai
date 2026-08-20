import { Outlet, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/shell/AppShell';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { DashboardPage } from './pages/DashboardPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { IncidentDetailPage, IncidentsListPage } from './pages/IncidentDetailPage';
import { DemoControlPage } from './pages/DemoControlPage';
import { LandingPage as CodeReviewLandingPage } from './features/code-review-buddy/pages/LandingPage';
import { DemoPage as CodeReviewAppPage } from './features/code-review-buddy/pages/DemoPage';

/**
 * Route tree. `/` is the full-screen brand home and unknown routes get the
 * matching 404 — both render WITHOUT the shell. The operational console lives
 * inside `AppShell`: `/dashboard` (C12), `/incidents` + `/incidents/:id` (C13),
 * `/onboarding` (C14), `/demo` (C15).
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route element={<ConsoleLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/incidents" element={<IncidentsListPage />} />
        <Route path="/incidents/:id" element={<IncidentDetailPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/demo" element={<DemoControlPage />} />
      </Route>
      {/* Code Review Buddy — self-branded mini-app, renders without the shell */}
      <Route path="/code-review" element={<CodeReviewLandingPage />} />
      <Route path="/code-review/app" element={<CodeReviewAppPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

function ConsoleLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
