import { Entrance } from '../components/motion/primitives';
import { DemoControlPanel } from '../components/demo/DemoControlPanel';

/**
 * DemoControlPage (`/demo`) — DESIGN_SPEC §6.4, C15. Full-page redesign of the shared
 * DemoControlPanel (FailureModeSwitch + current-state readout + traffic generator),
 * organised into SectionHeader bands with a StatTile KPI readout. Drives the victim's
 * failure mode and generates load so the live demo produces the incident →
 * investigation → PR loop.
 */
export function DemoControlPage() {
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-8">
      <Entrance className="flex flex-col gap-2">
        <h1 className="font-playfair text-h1 italic text-ink">Demo controls</h1>
        <p className="max-w-[60ch] text-body text-ink-2">
          Flip the victim app's failure mode and drive traffic to trigger the live
          detection → investigation → fix-as-PR loop.
        </p>
      </Entrance>

      <DemoControlPanel variant="page" />
    </div>
  );
}
