import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FlaskConical, SearchCode, Boxes, AlertTriangle, Activity, Gauge } from 'lucide-react';
import type { ServiceHealth as ServiceHealthDto } from '@oncall/shared';
import { ServiceHealth } from '../components/ServiceHealth';
import { MetricsChart } from '../components/MetricsChart';
import { LogStream } from '../components/LogStream';
import { IncidentListSlot } from '../components/seams/IncidentListSlot';
import { DemoControlLauncher } from '../components/seams/DemoControlLauncher';
import { Button } from '../components/primitives/Button';
import { Icon } from '../components/primitives/Icon';
import { StatTile, SectionHeader } from '../components/primitives/StatTile';
import { Entrance, StaggerGroup, StaggerItem } from '../components/motion/primitives';
import { EarlyWarningCard } from '../features/prevention/components/EarlyWarningCard';
import { HostEarlyWarningCard } from '../features/prevention/components/HostEarlyWarningCard';
import { EscalationTimeline } from '../features/prevention/components/EscalationTimeline';
import { PreventionSpotlight } from '../features/prevention/components/PreventionSpotlight';
import { pct, ms } from '../lib/format';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { TIME_RANGES } from '../config';

/**
 * DashboardPage (DESIGN_SPEC §6.2, FR-14). Composes the C12 surfaces — ServiceHealth
 * strip, error-rate + latency MetricsCharts, LogStream — plus the C13/C15 seams
 * (IncidentTimeline list, DemoControl launcher). Page-level state: the selected
 * service (drives charts + logs) and the metrics time-range window.
 *
 * Layout: Row A = ServiceHealth (full width). Row B = 1.6fr/1.6fr split on ≥1024
 * (charts + logs left, incidents right); single column below with source order
 * charts → incidents → logs (matches the tablet/mobile spec).
 */
export function DashboardPage() {
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceHealthDto[]>([]);
  const [windowSec, setWindowSec] = useState<number>(TIME_RANGES[0].window_sec);
  const didAutoSelect = useRef(false);

  const isMobile = useMediaQuery('(max-width: 639px)');
  const isTablet = useMediaQuery('(min-width: 640px) and (max-width: 1023px)');
  const chartHeight = isMobile ? 160 : isTablet ? 200 : 220;
  const logHeight = isMobile ? 260 : 420;

  const onServicesLoaded = (list: ServiceHealthDto[]): void => {
    setServices(list);
    // Auto-select the first service once so charts populate by default; never
    // override a later explicit "All services" (null) choice.
    if (!didAutoSelect.current && list.length > 0) {
      didAutoSelect.current = true;
      setSelectedService(list[0].name);
    }
  };

  // KPIs rolled up from the live ServiceHealth list already loaded on the page.
  const healthy = services.filter((s) => s.health === 'healthy').length;
  const activeIncidents = services.filter((s) => s.active_incident_id).length;
  const worstErrorRate = services.reduce((m, s) => Math.max(m, s.error_rate ?? 0), 0);
  const worstP95 = services.reduce((m, s) => Math.max(m, s.p95_ms ?? 0), 0);

  return (
    <Entrance className="flex flex-col gap-6">
      {/* Title row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-playfair text-h1 italic text-ink">Dashboard</h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* Code Review Buddy mini-app entry point */}
          <Link
            to="/code-review"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong px-3 text-body-md font-medium text-ink hover:bg-surface-3"
          >
            <Icon icon={SearchCode} size={16} />
            Code Review
          </Link>
          <label className="sr-only" htmlFor="service-filter">
            Filter by service
          </label>
          <select
            id="service-filter"
            value={selectedService ?? '__all__'}
            onChange={(e) =>
              setSelectedService(e.target.value === '__all__' ? null : e.target.value)
            }
            className="h-9 rounded-md border border-border-strong bg-surface-2 px-2 text-body text-ink focus:border-accent"
          >
            <option value="__all__">All services</option>
            {services.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>

          <div
            className="flex h-9 items-center rounded-md bg-surface-2 p-0.5"
            role="tablist"
            aria-label="Time range"
          >
            {TIME_RANGES.map((r) => {
              const active = r.window_sec === windowSec;
              return (
                <button
                  key={r.label}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setWindowSec(r.window_sec)}
                  className={`h-8 rounded px-2.5 text-body-md font-medium transition-colors duration-fast ${
                    active ? 'bg-surface text-ink shadow-elev-1' : 'text-ink-2 hover:text-ink'
                  }`}
                >
                  {r.label}
                </button>
              );
            })}
          </div>

          <Link to="/demo" className="hidden sm:block">
            <Button variant="secondary" leadingIcon={<Icon icon={FlaskConical} size={16} />}>
              Simulate incident
            </Button>
          </Link>
        </div>
      </div>

      {/* AI Incident PREVENTION (HOST layer) — the "AI EARLY WARNING" resource
          forecast + the "ESCALATE IF IGNORED" ladder, leading the page. The
          timeline collapses out when no alert is in play, letting the card fill. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 lg:flex-[1.6]">
          <HostEarlyWarningCard />
        </div>
        <EscalationTimeline />
      </div>

      {/* AI Incident PREVENTION (Phase 1) — predictive breach forecast (API layer) */}
      <EarlyWarningCard />

      {/* Deep dive on the most at-risk endpoint — score gauge + breach forecast */}
      <PreventionSpotlight />

      {/* KPI overview — animated roll-up of the live service list */}
      <StaggerGroup className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StaggerItem>
          <StatTile
            label="Services"
            value={services.length}
            icon={Boxes}
            caption={`${healthy} healthy`}
          />
        </StaggerItem>
        <StaggerItem>
          <StatTile
            label="Active incidents"
            value={activeIncidents}
            icon={AlertTriangle}
            accent={activeIncidents > 0 ? 'var(--critical)' : 'var(--ok)'}
            caption={activeIncidents > 0 ? 'needs attention' : 'all clear'}
          />
        </StaggerItem>
        <StaggerItem>
          <StatTile
            label="Peak error rate"
            value={worstErrorRate}
            format={(n) => pct(n)}
            icon={Activity}
            accent="var(--series-error)"
            caption="across services"
          />
        </StaggerItem>
        <StaggerItem>
          <StatTile
            label="Peak p95 latency"
            value={worstP95}
            format={(n) => ms(n)}
            icon={Gauge}
            caption="across services"
          />
        </StaggerItem>
      </StaggerGroup>

      <SectionHeader title="Service health" icon={Activity} className="pt-1" />
      {/* Row A — ServiceHealth strip */}
      <ServiceHealth
        selectedService={selectedService}
        onSelectService={setSelectedService}
        onServicesLoaded={onServicesLoaded}
      />

      {/* Row B — split (desktop) / stacked (tablet, mobile) */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6 lg:col-start-1 lg:row-start-1">
          <MetricsChart
            service={selectedService}
            windowSec={windowSec}
            variant="error"
            height={chartHeight}
          />
          <MetricsChart
            service={selectedService}
            windowSec={windowSec}
            variant="latency"
            height={chartHeight}
          />
        </div>

        <div className="lg:col-start-2 lg:row-start-1 lg:row-span-2">
          <div className="lg:sticky lg:top-[84px] lg:max-h-[calc(100vh-160px)]">
            <IncidentListSlot />
          </div>
        </div>

        <div className="lg:col-start-1 lg:row-start-2">
          <LogStream service={selectedService} height={logHeight} />
        </div>
      </div>

      <DemoControlLauncher />
    </Entrance>
  );
}
