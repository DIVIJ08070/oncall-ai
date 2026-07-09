import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import type { ServiceHealth as ServiceHealthDto } from '@oncall/shared';
import { ServiceHealth } from '../components/ServiceHealth';
import { MetricsChart } from '../components/MetricsChart';
import { LogStream } from '../components/LogStream';
import { IncidentListSlot } from '../components/seams/IncidentListSlot';
import { DemoControlLauncher } from '../components/seams/DemoControlLauncher';
import { Button } from '../components/primitives/Button';
import { Icon } from '../components/primitives/Icon';
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

  return (
    <div className="flex flex-col gap-6">
      {/* Title row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 font-semibold text-ink">Dashboard</h1>
        <div className="flex flex-wrap items-center gap-2">
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
    </div>
  );
}
