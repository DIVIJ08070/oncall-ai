import { useState } from 'react';
import {
  GitPullRequest,
  GitMerge,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Copy,
  ArrowRight,
} from 'lucide-react';
import type { PullRequestSummary, IncidentStatus } from '@oncall/shared';
import { v, tint } from '../lib/tokens';
import { Card, CardHeader } from './primitives/Card';
import { Icon } from './primitives/Icon';
import { Chip } from './primitives/Badge';
import { Button, IconButton } from './primitives/Button';

/**
 * PRCard (DESIGN_SPEC §8.6) — binds the reconciled `GET /incidents/:id` →
 * `pull_request` DTO (SPEC §7.3, 8 fields). Header + branch→base + head_sha (copy)
 * + state pill + verification row + "View on GitHub". No-PR states cover escalated
 * (no automated fix) and still-investigating (waiting).
 */
export function PRCard({
  pr,
  incidentStatus,
  onViewFindings,
}: {
  pr: PullRequestSummary | null;
  incidentStatus: IncidentStatus;
  onViewFindings?: () => void;
}) {
  if (!pr) {
    return (
      <Card>
        <CardHeader
          title="Pull request"
          icon={
            <span className="text-ink-2">
              <Icon icon={GitPullRequest} size={18} />
            </span>
          }
        />
        {incidentStatus === 'escalated' ? (
          <div className="flex flex-col gap-2">
            <div
              className="flex items-start gap-2 rounded-md p-3 text-sm text-ink"
              style={{ backgroundColor: tint('serious', 14) }}
            >
              <span className="mt-0.5 shrink-0" style={{ color: v('serious') }}>
                <Icon icon={AlertTriangle} size={16} />
              </span>
              <span>Escalated to a human — no automated fix proposed.</span>
            </div>
            {onViewFindings ? (
              <button
                type="button"
                onClick={onViewFindings}
                className="self-start text-sm font-medium text-accent-text hover:underline"
              >
                View findings
              </button>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-ink-muted-text">
            Waiting for the agent to propose a fix…
          </p>
        )}
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span>Pull request #{pr.number}</span>
          </span>
        }
        icon={
          <span className="text-ink-2">
            <Icon icon={GitPullRequest} size={18} />
          </span>
        }
        right={<KindChip kind={pr.kind} />}
      />

      <div className="flex flex-col gap-3">
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-body-md font-medium text-accent-text hover:underline"
        >
          {pr.kind === 'revert' ? 'Revert fix' : 'Patch fix'} · #{pr.number}
          <Icon icon={ExternalLink} size={14} />
        </a>

        {/* branch → base */}
        <div className="flex flex-wrap items-center gap-1.5 text-mono-sm">
          <Chip className="font-mono" title={pr.branch}>
            {pr.branch}
          </Chip>
          <span className="text-ink-muted-text">
            <Icon icon={ArrowRight} size={14} />
          </span>
          <Chip className="font-mono">{pr.base}</Chip>
        </div>

        {/* head sha + copy */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-ink-muted-text">head</span>
          <ShaCopy sha={pr.head_sha} />
        </div>

        <div className="flex items-center gap-2">
          <StatePill state={pr.state} />
        </div>

        <VerificationRow status={pr.verification_status} />

        <a href={pr.url} target="_blank" rel="noopener noreferrer" className="self-start">
          <Button variant="secondary" leadingIcon={<Icon icon={ExternalLink} size={16} />}>
            View on GitHub
          </Button>
        </a>
      </div>
    </Card>
  );
}

function KindChip({ kind }: { kind: PullRequestSummary['kind'] }) {
  return (
    <span className="rounded-pill bg-surface-3 px-2 py-0.5 text-label uppercase text-ink-2">
      {kind}
    </span>
  );
}

function StatePill({ state }: { state: PullRequestSummary['state'] }) {
  if (state === 'merged') {
    return (
      <span
        className="inline-flex h-6 items-center gap-1.5 rounded-pill px-2.5 text-sm font-medium text-ink"
        style={{ backgroundColor: tint('pr-merged', 14) }}
      >
        <span style={{ color: v('pr-merged') }}>
          <Icon icon={GitMerge} size={13} />
        </span>
        Merged
      </span>
    );
  }
  if (state === 'closed') {
    return (
      <span className="inline-flex h-6 items-center gap-1.5 rounded-pill bg-surface-3 px-2.5 text-sm font-medium text-ink-muted-text">
        Closed
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-6 items-center gap-1.5 rounded-pill px-2.5 text-sm font-medium text-ink"
      style={{ backgroundColor: tint('ok', 14) }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: v('ok') }} />
      Open
    </span>
  );
}

function VerificationRow({
  status,
}: {
  status: PullRequestSummary['verification_status'];
}) {
  if (status === 'recovered') {
    return (
      <div className="flex items-center gap-2 text-sm text-ink">
        <span style={{ color: v('ok') }}>
          <Icon icon={CheckCircle2} size={16} />
        </span>
        Recovery confirmed
      </div>
    );
  }
  if (status === 'not_recovered') {
    return (
      <div className="flex items-center gap-2 text-sm text-ink">
        <span style={{ color: v('serious') }}>
          <Icon icon={AlertTriangle} size={16} />
        </span>
        Not recovered
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-sm text-ink-2">
      <Icon icon={Loader2} size={16} className="animate-spin text-ink-muted-text" />
      Verifying recovery…
    </div>
  );
}

function ShaCopy({ sha }: { sha: string }) {
  const [copied, setCopied] = useState(false);
  const short = sha.slice(0, 7);

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(sha);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure origin) — no-op */
    }
  };

  return (
    <span className="inline-flex items-center gap-1">
      <code className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-mono-sm text-ink-2" title={sha}>
        {short}
      </code>
      <IconButton aria-label={copied ? 'Copied' : 'Copy full SHA'} onClick={() => void onCopy()}>
        {copied ? (
          <span className="text-ok">
            <Icon icon={CheckCircle2} size={14} />
          </span>
        ) : (
          <Icon icon={Copy} size={14} />
        )}
      </IconButton>
    </span>
  );
}
