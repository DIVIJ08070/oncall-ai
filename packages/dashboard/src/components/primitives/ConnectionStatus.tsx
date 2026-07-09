import { Radio, Loader2 } from 'lucide-react';
import type { ConnStatus } from '../../sse/useEventStream';
import { Icon } from './Icon';
import { v } from '../../lib/tokens';

/**
 * ConnectionStatus (DESIGN_SPEC §7): the shared pill behind every SSE surface.
 * live = `radio` + pulsing `--ok` dot + "LIVE"; connecting = `--warn` dot;
 * reconnecting = `--warn` spinner; closed = `--ink-muted` dot + "Offline · Retry".
 * `role="status"` `aria-live="polite"`.
 */
export function ConnectionStatus({
  status,
  onRetry,
  className = '',
}: {
  status: ConnStatus;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex h-6 items-center gap-1.5 rounded-pill bg-surface-3 px-2 text-sm ${className}`}
    >
      {status === 'live' && (
        <>
          <Icon icon={Radio} size={13} className="text-ink-2" />
          <span
            className="h-1.5 w-1.5 rounded-full animate-pulse-live"
            style={{ backgroundColor: v('ok') }}
          />
          <span className="font-medium text-ink">LIVE</span>
        </>
      )}
      {status === 'connecting' && (
        <>
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: v('warn') }} />
          <span className="text-ink-2">Connecting…</span>
        </>
      )}
      {status === 'reconnecting' && (
        <>
          <Icon icon={Loader2} size={13} className="animate-spin text-warn" />
          <span className="text-ink-2">Reconnecting…</span>
        </>
      )}
      {status === 'closed' && (
        <>
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: v('ink-muted') }}
          />
          <span className="text-ink-muted-text">Offline</span>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="font-medium text-accent-text hover:underline"
            >
              Retry
            </button>
          ) : null}
        </>
      )}
    </span>
  );
}
