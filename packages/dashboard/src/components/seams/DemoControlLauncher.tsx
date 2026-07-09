import { Link } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import { Icon } from '../primitives/Icon';

/**
 * SEAM for C15. DESIGN_SPEC §6.2 places a floating DemoControl launcher bottom-right
 * (`--elev-2`) that expands the FailureModeSwitch panel. C15 owns the panel + traffic
 * generator; C12 provides the launcher affordance, which for now routes to the `/demo`
 * placeholder. Hidden on mobile where the design opens it as a bottom sheet (C15).
 */
export function DemoControlLauncher() {
  return (
    <Link
      to="/demo"
      title="Demo controls"
      className="fixed bottom-5 right-5 z-drawer hidden h-11 items-center gap-2 rounded-pill bg-surface-2 px-4 text-body-md font-medium text-ink shadow-elev-2 ring-1 ring-border hover:bg-surface-3 sm:inline-flex"
    >
      <span className="text-accent">
        <Icon icon={FlaskConical} size={18} />
      </span>
      Simulate incident
    </Link>
  );
}
