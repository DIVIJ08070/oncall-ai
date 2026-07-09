import { useState } from 'react';
import { Copy, CheckCircle2 } from 'lucide-react';
import { Icon } from './Icon';
import { IconButton } from './Button';

/**
 * CodeBlock (DESIGN_SPEC §7): `--surface-2`, radius 6, 1px border, mono, padding
 * 12–16, horizontal scroll (never wrap SHAs/URLs). Top-right Copy: `copy` → on
 * click `check-circle` `--ok`, revert after 1.5s.
 */
export function CodeBlock({
  code,
  className = '',
  maxHeight = 320,
}: {
  code: string;
  className?: string;
  maxHeight?: number;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable (insecure origin) — no-op */
    }
  };

  return (
    <div className={`relative rounded-md border border-border bg-surface-2 ${className}`}>
      <IconButton
        aria-label={copied ? 'Copied' : 'Copy to clipboard'}
        onClick={() => void onCopy()}
        className="absolute right-1.5 top-1.5"
      >
        {copied ? (
          <span className="text-ok">
            <Icon icon={CheckCircle2} size={16} />
          </span>
        ) : (
          <Icon icon={Copy} size={16} />
        )}
      </IconButton>
      <pre
        className="overflow-auto p-3 pr-10 text-mono-sm text-ink-2"
        style={{ maxHeight }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
