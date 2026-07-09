import { useState } from 'react';
import {
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import type { RepoRef, IntegrationSnippetResponse } from '@oncall/shared';
import { usePolling } from '../../hooks/usePolling';
import { Button, IconButton } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { CodeBlock } from '../primitives/CodeBlock';
import { Skeleton } from '../primitives/Skeleton';
import { getIntegrationSnippet } from './api';

type Tab = 'middleware' | 'tailer';

/**
 * Step 3 — Install the snippet (DESIGN_SPEC §6.1/§13). Fetches
 * `GET /integration-snippet`; tabs [SDK middleware | Tailer] each show a
 * copyable `CodeBlock`. The ingest URL is shown plain; the **API key is masked**
 * (`dev-local-••••`) with an eye reveal toggle + copy. Helper copy, then Continue.
 */
export function IntegrationSnippet({
  repo,
  onContinue,
  onBack,
}: {
  repo: RepoRef | null;
  onContinue: () => void;
  onBack: () => void;
}) {
  const { data, loading, error, refetch } = usePolling(
    (signal) => getIntegrationSnippet(signal),
    [],
  );
  const [tab, setTab] = useState<Tab>('middleware');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-h2 font-semibold text-ink">Install the OnCall AI snippet</h2>
        <p className="text-sm text-ink-2">
          {repo ? (
            <>
              Fixes will target{' '}
              <span className="font-medium text-ink">
                {repo.owner}/{repo.repo}
              </span>
              . Ship logs from your service to start detecting incidents.
            </>
          ) : (
            'Ship logs from your service to start detecting incidents.'
          )}
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-56" rounded="rounded-md" />
          <Skeleton className="h-24 w-full" rounded="rounded-md" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-between rounded-md border border-border bg-surface-2 px-3 py-3 text-sm text-ink-2">
          <span>Couldn&apos;t load the snippet — {error.message}</span>
          <Button variant="ghost" onClick={refetch}>
            Retry
          </Button>
        </div>
      ) : data ? (
        <SnippetBody data={data} tab={tab} onTab={setTab} />
      ) : null}

      <div className="flex items-center justify-between pt-1">
        <Button variant="ghost" onClick={onBack} leadingIcon={<Icon icon={ArrowLeft} size={16} />}>
          Back
        </Button>
        <Button
          variant="primary"
          onClick={onContinue}
          leadingIcon={<Icon icon={ArrowRight} size={16} />}
        >
          I&apos;ve added it
        </Button>
      </div>
    </div>
  );
}

function SnippetBody({
  data,
  tab,
  onTab,
}: {
  data: IntegrationSnippetResponse;
  tab: Tab;
  onTab: (t: Tab) => void;
}) {
  const code = tab === 'middleware' ? data.middleware_snippet : data.tailer_snippet;

  return (
    <div className="flex flex-col gap-4">
      {/* Ingest URL (plain) + masked API key */}
      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
        <Field label="Ingest URL">
          <span className="truncate text-mono-sm text-ink-2" title={data.ingest_url}>
            {data.ingest_url}
          </span>
        </Field>
        <KeyField value={data.ingest_api_key} />
      </div>

      {/* Tabs */}
      <div>
        <div
          role="tablist"
          aria-label="Integration method"
          className="mb-2 inline-flex rounded-md bg-surface-2 p-0.5"
        >
          <TabButton active={tab === 'middleware'} onClick={() => onTab('middleware')}>
            SDK middleware
          </TabButton>
          <TabButton active={tab === 'tailer'} onClick={() => onTab('tailer')}>
            Tailer
          </TabButton>
        </div>
        <CodeBlock code={code} maxHeight={200} />
      </div>

      <p className="text-sm text-ink-muted-text">
        Add this to your service, then deploy or restart.
      </p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`h-8 rounded-md px-3 text-body-md font-medium transition-colors duration-fast ${
        active ? 'bg-surface text-ink shadow-elev-1' : 'text-ink-2 hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-label uppercase text-ink-muted-text">{label}</span>
      <span className="flex min-w-0 items-center gap-1">{children}</span>
    </div>
  );
}

/** Masked ingest key with a reveal toggle + copy (DESIGN_SPEC §6.1). */
function KeyField({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure origin) — no-op */
    }
  };

  return (
    <Field label="API key">
      <code className="truncate text-mono-sm text-ink-2" title={revealed ? value : 'Hidden'}>
        {revealed ? value : maskKey(value)}
      </code>
      <IconButton
        aria-label={revealed ? 'Hide API key' : 'Reveal API key'}
        onClick={() => setRevealed((r) => !r)}
        className="h-7 w-7"
      >
        <Icon icon={revealed ? EyeOff : Eye} size={14} />
      </IconButton>
      <IconButton
        aria-label={copied ? 'Copied' : 'Copy API key'}
        onClick={() => void onCopy()}
        className="h-7 w-7"
      >
        {copied ? (
          <span className="text-ok">
            <Icon icon={CheckCircle2} size={14} />
          </span>
        ) : (
          <Icon icon={Copy} size={14} />
        )}
      </IconButton>
    </Field>
  );
}

/** Keep a short readable prefix, mask the rest (e.g. `dev-local-ingest-key` → `dev-local-••••`). */
function maskKey(k: string): string {
  if (k.length <= 4) return '••••';
  const prefix = k.slice(0, Math.min(10, k.length - 4));
  return `${prefix}••••`;
}
