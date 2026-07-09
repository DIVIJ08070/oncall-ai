import { useCallback, useRef, useState } from 'react';
import { CheckCircle, AlertTriangle, Info } from 'lucide-react';
import { Icon } from '../primitives/Icon';
import { v } from '../../lib/tokens';

/**
 * Minimal, self-contained toast (DESIGN_SPEC §7) — kept local to the C15 `demo/`
 * directory to avoid adding a shared primitive C13/C14 might touch concurrently.
 * `--surface-2` + `--elev-2`, radius 8, leading status icon, 2px left accent,
 * auto-dismiss 4s, `role="status"` (polite).
 */

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  variant: ToastVariant;
  message: string;
}

const VARIANT: Record<ToastVariant, { token: string; icon: typeof Info }> = {
  success: { token: 'ok', icon: CheckCircle },
  error: { token: 'critical', icon: AlertTriangle },
  info: { token: 'accent', icon: Info },
};

export function useToasts(): {
  toasts: ToastItem[];
  push: (variant: ToastVariant, message: string) => void;
} {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const push = useCallback((variant: ToastVariant, message: string) => {
    const id = ++seq.current;
    setToasts((prev) => [...prev, { id, variant, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return { toasts, push };
}

export function ToastStack({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-toast flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-5 sm:items-end">
      {toasts.map((t) => {
        const cfg = VARIANT[t.variant];
        return (
          <div
            key={t.id}
            role="status"
            aria-live="polite"
            className="pointer-events-auto flex max-w-[380px] items-center gap-2 rounded-lg border-l-2 bg-surface-2 py-2.5 pl-3 pr-4 text-body text-ink shadow-elev-2 ring-1 ring-border"
            style={{ borderLeftColor: v(cfg.token) }}
          >
            <span style={{ color: v(cfg.token) }}>
              <Icon icon={cfg.icon} size={16} />
            </span>
            <span>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
