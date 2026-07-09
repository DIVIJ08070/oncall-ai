import { AlertTriangle, List } from 'lucide-react';
import { PagePlaceholder } from './PagePlaceholder';

/**
 * `/incidents/:id` (detail) + `/incidents` (list) routes — owned by C13
 * (IncidentTimeline + IncidentDetail + InvestigationFeed + PRCard + ChatPanel).
 * C13 replaces these placeholder bodies. Kept in its own file so C13/C14/C15
 * build in parallel with zero shared-file collisions.
 */
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
