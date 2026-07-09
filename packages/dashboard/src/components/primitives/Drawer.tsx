import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Icon } from './Icon';
import { IconButton } from './Button';

/**
 * Drawer / Bottom sheet (DESIGN_SPEC §7). Desktop = right slide-in 400px (`--elev-3`,
 * scrim); mobile = slides up, rounded-top 12, max-height 88vh, drag handle. Both:
 * focus trap, `Esc` closes, `role="dialog"` `aria-modal`, restores focus on close.
 * `variant` picks the geometry (`side` desktop / `sheet` mobile).
 */
export function Drawer({
  open,
  onClose,
  title,
  variant = 'side',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  variant?: 'side' | 'sheet';
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    // Focus the panel so Tab is trapped inside and Esc reaches the handler.
    const t = window.setTimeout(() => panelRef.current?.focus(), 0);

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const isSheet = variant === 'sheet';

  return (
    <div className="fixed inset-0 z-drawer">
      {/* Self-contained keyframes (no edit to the shared C12 index.css/tailwind
          config). The global reduced-motion rule zeroes these durations. */}
      <style>{`
        @keyframes ocDrawerFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes ocDrawerSlideIn { from { transform: translateX(100%) } to { transform: translateX(0) } }
        @keyframes ocDrawerSheetUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
      `}</style>
      <div
        className="absolute inset-0"
        style={{ backgroundColor: 'var(--scrim)', animation: 'ocDrawerFade var(--dur-slow) var(--ease-out)' }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Panel'}
        tabIndex={-1}
        className={
          isSheet
            ? 'absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col rounded-t-xl border-t border-border bg-surface shadow-elev-3 outline-none'
            : 'absolute inset-y-0 right-0 flex w-[400px] max-w-full flex-col border-l border-border bg-surface shadow-elev-3 outline-none'
        }
        style={
          isSheet
            ? { animation: 'ocDrawerSheetUp var(--dur-slow) var(--ease-out)' }
            : { animation: 'ocDrawerSlideIn var(--dur-slow) var(--ease-out)' }
        }
      >
        {isSheet ? (
          <div className="flex justify-center pt-2">
            <span className="h-1 w-10 rounded-pill bg-surface-3" aria-hidden="true" />
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 text-h3 font-semibold text-ink">{title}</div>
          <IconButton aria-label="Close" onClick={onClose}>
            <Icon icon={X} size={18} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
