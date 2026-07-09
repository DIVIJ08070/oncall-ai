import { FlaskConical } from 'lucide-react';
import { Card, CardHeader } from '../components/primitives/Card';
import { Icon } from '../components/primitives/Icon';
import { DemoControlPanel } from '../components/demo/DemoControlPanel';

/**
 * DemoControlPage (`/demo`) — DESIGN_SPEC §6.4, C15. A centered 640px card wrapping
 * the shared DemoControlPanel (FailureModeSwitch + current-state readout + traffic
 * generator). Drives the victim's failure mode and generates load so the live demo
 * produces the incident → investigation → PR loop.
 */
export function DemoControlPage() {
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-h1 font-semibold text-ink">Demo controls</h1>
        <p className="text-body text-ink-2">
          Flip the victim app's failure mode and drive traffic to trigger the live
          detection → investigation → fix-as-PR loop.
        </p>
      </div>

      <Card>
        <CardHeader
          title="Failure &amp; traffic"
          icon={
            <span className="text-accent">
              <Icon icon={FlaskConical} size={18} />
            </span>
          }
        />
        <DemoControlPanel />
      </Card>
    </div>
  );
}
