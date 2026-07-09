import { List } from 'lucide-react';
import { Card, CardHeader } from '../primitives/Card';
import { EmptyState } from '../primitives/EmptyState';
import { Icon } from '../primitives/Icon';

/**
 * SEAM for C13. The dashboard right column is `IncidentTimeline` (list mode,
 * DESIGN_SPEC §6.2/§8.4), owned by C13 (`IncidentTimeline + IncidentDetail + …`).
 * C12 lays out the slot and its sticky/scroll frame; C13 replaces this body with
 * the real `GET /incidents` list. Kept intentionally minimal — no incident logic here.
 */
export function IncidentListSlot() {
  return (
    <Card className="flex h-full flex-col" padded={false}>
      <div className="p-4 pb-0 md:p-5 md:pb-0">
        <CardHeader
          title="Incidents"
          icon={
            <span className="text-ink-2">
              <Icon icon={List} size={18} />
            </span>
          }
        />
      </div>
      <EmptyState
        icon={List}
        title="Incident timeline"
        subtitle="The live incident list (GET /incidents) lands with C13 — this slot is wired and ready."
      />
    </Card>
  );
}
