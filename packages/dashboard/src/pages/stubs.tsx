import { Plug, AlertTriangle, List, FlaskConical } from 'lucide-react';
import { PagePlaceholder } from './PagePlaceholder';

/**
 * Route stubs for chunks that follow C12. Each renders inside the shared app shell
 * so the route tree, nav highlighting, and responsive chrome are all exercised now;
 * the owning chunk replaces the body (SPEC §6 route tree).
 */

export function OnboardingPage() {
  return (
    <PagePlaceholder
      icon={Plug}
      title="Connect"
      chunk="C14"
      description="The GitHub sign-in → repo select → integration-snippet onboarding flow lands with C14."
    />
  );
}

export function IncidentDetailPage() {
  return (
    <PagePlaceholder
      icon={AlertTriangle}
      title="Incident"
      chunk="C13"
      description="The investigation feed, PR card, lifecycle timeline and chat land with C13."
    />
  );
}

export function IncidentsListPage() {
  return (
    <PagePlaceholder
      icon={List}
      title="Incidents"
      chunk="C13"
      description="The incident list + detail views land with C13. Recent incidents also surface on the dashboard."
    />
  );
}

export function DemoControlPage() {
  return (
    <PagePlaceholder
      icon={FlaskConical}
      title="Demo controls"
      chunk="C15"
      description="The FailureModeSwitch + traffic generator that drive the victim app land with C15."
    />
  );
}
