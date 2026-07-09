import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FlaskConical, X, ExternalLink } from 'lucide-react';
import { Icon } from '../primitives/Icon';
import { IconButton } from '../primitives/Button';
import { DemoControlPanel } from '../demo/DemoControlPanel';

/**
 * Floating DemoControl launcher (DESIGN_SPEC §6.2, C15). A bottom-right button
 * (`--elev-2`) that expands a 340px panel (`--elev-3` + scrim) holding the shared
 * DemoControlPanel — the FailureModeSwitch + traffic generator, without leaving the
 * dashboard. `Esc` / scrim-click closes; a "Full page" link deep-links to `/demo`.
 * Desktop-only (≥640); on mobile the bottom tab bar's "Demo" tab opens the full
 * `/demo` page instead (avoids overlapping the tab bar).
 */
export function DemoControlLauncher() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Demo controls"
          aria-haspopup="dialog"
          className="fixed bottom-5 right-5 z-drawer hidden h-11 items-center gap-2 rounded-pill bg-surface-2 px-4 text-body-md font-medium text-ink shadow-elev-2 ring-1 ring-border transition-colors duration-fast hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring sm:inline-flex"
        >
          <span className="text-accent">
            <Icon icon={FlaskConical} size={18} />
          </span>
          Simulate incident
        </button>
      ) : null}

      {open ? (
        <>
          <div
            className="fixed inset-0 z-drawer hidden bg-scrim sm:block"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Demo controls"
            className="fixed bottom-5 right-5 z-drawer hidden max-h-[calc(100vh-80px)] w-[340px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-elev-3 sm:flex"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-accent">
                  <Icon icon={FlaskConical} size={18} />
                </span>
                <h2 className="text-h3 font-semibold text-ink">Demo controls</h2>
              </div>
              <div className="flex items-center gap-1">
                <Link
                  to="/demo"
                  onClick={() => setOpen(false)}
                  title="Open the full demo page"
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-accent-text hover:bg-surface-3"
                >
                  Full page
                  <Icon icon={ExternalLink} size={12} />
                </Link>
                <IconButton aria-label="Close demo controls" onClick={() => setOpen(false)}>
                  <Icon icon={X} size={16} />
                </IconButton>
              </div>
            </div>
            <div className="overflow-y-auto p-4">
              <DemoControlPanel />
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
