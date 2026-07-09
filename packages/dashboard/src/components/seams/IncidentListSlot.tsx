import { IncidentTimelineList } from '../IncidentTimeline';

/**
 * Dashboard right-column slot (DESIGN_SPEC §6.2/§8.4) — `IncidentTimeline` in list
 * mode. C12 laid out the sticky/scroll frame; C13 fills it with the live
 * `GET /incidents` list. The parent gives this a sticky wrapper with a max-height;
 * the list caps its own body scroll to fit.
 */
export function IncidentListSlot() {
  return <IncidentTimelineList scrollMaxHeight="calc(100vh - 260px)" />;
}
