import type { ReactNode } from 'react';
import {
  BookOpen,
  Check,
  FlaskConical,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { GlassCard, MONO } from '../../../components/shell/UnifiedChrome';
import type { HealthIssue, HealthReport, IssueSeverity } from '../../../api/healthReport';
import { ScoreRing, scoreColor } from './ScoreRing';

/**
 * ReportView — the "done" state: hero (score ring + summary + engine badge)
 * over a responsive grid of glass cards, one per report section.
 */

const SEVERITY_ORDER: IssueSeverity[] = ['critical', 'warning', 'info'];

const SEVERITY_META: Record<IssueSeverity, { label: string; dot: string; text: string }> = {
  critical: { label: 'Critical', dot: '#FF3B30', text: '#FF6B61' },
  warning: { label: 'Warning', dot: '#FF8233', text: '#FF8233' },
  info: { label: 'Info', dot: '#4A9EFF', text: '#7CB8FF' },
};

const METHOD_COLOR: Record<string, string> = {
  GET: '#52D273',
  POST: '#FF8233',
  PUT: '#4A9EFF',
  PATCH: '#A78BFA',
  DELETE: '#FF6B61',
};

/** "https://github.com/owner/repo.git" → "owner/repo". */
export function repoDisplayName(repoUrl: string): string {
  const m = /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(repoUrl);
  return m ? `${m[1]}/${m[2]}` : repoUrl;
}

export function ReportView({
  report,
  repoUrl,
  onReset,
}: {
  report: HealthReport;
  repoUrl: string;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <HeroCard report={report} repoUrl={repoUrl} onReset={onReset} />

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <LanguagesCard report={report} />
        <FrameworksCard frameworks={report.frameworks} />
        <DatabasesCard databases={report.databases} />
        <ApisCard apis={report.apis} />
        <QualityCard quality={report.quality} />
        <SecurityCard security={report.security} />
        <TestsDocsCard tests={report.tests} docs={report.docs} />
      </div>
    </div>
  );
}

/* ── hero ────────────────────────────────────────────────────────────────── */

function HeroCard({
  report,
  repoUrl,
  onReset,
}: {
  report: HealthReport;
  repoUrl: string;
  onReset: () => void;
}) {
  const engine = report.engine === 'claude' ? 'Claude' : 'Gemini';
  return (
    <GlassCard className="p-6 sm:p-8">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start sm:gap-8">
        <ScoreRing score={report.score} grade={report.grade} />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <span
              className="text-[10px] uppercase tracking-[0.2em] text-white/40"
              style={{ fontFamily: MONO }}
            >
              Health Report
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] ${
                report.engine === 'claude'
                  ? 'border-[#F16524]/30 bg-[#F16524]/15 text-[#FF8233]'
                  : 'border-[#4A9EFF]/30 bg-[#4A9EFF]/10 text-[#7CB8FF]'
              }`}
              style={{ fontFamily: MONO }}
            >
              Engine · {engine}
            </span>
          </div>
          <h2 className="mt-2 truncate text-xl font-bold text-white" title={repoUrl}>
            {repoDisplayName(repoUrl)}
          </h2>
          <p className="mt-2.5 text-sm leading-relaxed text-white/60">{report.summary}</p>
          <div
            className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[10px] uppercase tracking-[0.14em] text-white/40 sm:justify-start"
            style={{ fontFamily: MONO }}
          >
            <span>
              <span className="text-white/75 tabular-nums">
                {report.stats.files.toLocaleString()}
              </span>{' '}
              files
            </span>
            <span>
              <span className="text-white/75 tabular-nums">
                {report.stats.linesOfCode.toLocaleString()}
              </span>{' '}
              lines of code
            </span>
            <span>
              score{' '}
              <span className="tabular-nums" style={{ color: scoreColor(report.score) }}>
                {report.score}/100
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={onReset}
            className="mt-5 inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold text-white/70 transition-colors hover:border-[#F16524]/50 hover:bg-[#F16524]/10 hover:text-[#FF8233]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Analyze another
          </button>
        </div>
      </div>
    </GlassCard>
  );
}

/* ── shared bits ─────────────────────────────────────────────────────────── */

function CardLabel({ children }: { children: ReactNode }) {
  return (
    <span
      className="text-[10px] uppercase tracking-[0.18em] text-white/40"
      style={{ fontFamily: MONO }}
    >
      {children}
    </span>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-xs leading-relaxed text-white/35">{children}</p>;
}

/* ── languages ───────────────────────────────────────────────────────────── */

function LanguagesCard({ report }: { report: HealthReport }) {
  const langs = report.stats.languages;
  return (
    <GlassCard className="p-5">
      <CardLabel>Languages</CardLabel>
      {langs.length === 0 ? (
        <EmptyNote>No source languages detected.</EmptyNote>
      ) : (
        <ul className="mt-3.5 flex flex-col gap-3">
          {langs.map((l) => (
            <li key={l.name}>
              <div
                className="flex items-center justify-between text-[11px]"
                style={{ fontFamily: MONO }}
              >
                <span className="truncate text-white/75">{l.name}</span>
                <span className="shrink-0 pl-2 text-white/45 tabular-nums">
                  {l.pct.toFixed(1)}%
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#F16524] to-[#FF8233]"
                  style={{ width: `${Math.max(1, Math.min(100, l.pct))}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}

/* ── frameworks ──────────────────────────────────────────────────────────── */

function FrameworksCard({ frameworks }: { frameworks: string[] }) {
  return (
    <GlassCard className="p-5">
      <CardLabel>Frameworks &amp; Libraries</CardLabel>
      {frameworks.length === 0 ? (
        <EmptyNote>No frameworks detected.</EmptyNote>
      ) : (
        <div className="mt-3.5 flex flex-wrap gap-2">
          {frameworks.map((f) => (
            <span
              key={f}
              className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] text-white/75"
              style={{ fontFamily: MONO }}
            >
              {f}
            </span>
          ))}
        </div>
      )}
    </GlassCard>
  );
}

/* ── databases ───────────────────────────────────────────────────────────── */

function DatabasesCard({ databases }: { databases: HealthReport['databases'] }) {
  return (
    <GlassCard className="p-5">
      <CardLabel>Databases</CardLabel>
      {databases.length === 0 ? (
        <EmptyNote>No database usage detected.</EmptyNote>
      ) : (
        <ul className="mt-3.5 flex flex-col gap-3">
          {databases.map((d, i) => (
            <li
              key={`${d.type}-${i}`}
              className="rounded-xl border border-white/5 bg-white/[0.03] p-3"
            >
              <span className="block text-sm font-semibold text-white">{d.type}</span>
              <span
                className="mt-1 block break-words text-[10px] leading-relaxed text-white/45"
                style={{ fontFamily: MONO }}
              >
                {d.evidence}
              </span>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}

/* ── APIs ────────────────────────────────────────────────────────────────── */

function ApisCard({ apis }: { apis: HealthReport['apis'] }) {
  return (
    <GlassCard className="p-5 md:col-span-2 xl:col-span-3">
      <div className="flex items-center justify-between gap-3">
        <CardLabel>API Endpoints</CardLabel>
        <span className="text-[10px] text-white/30 tabular-nums" style={{ fontFamily: MONO }}>
          {apis.length} found
        </span>
      </div>
      {apis.length === 0 ? (
        <EmptyNote>No HTTP endpoints detected.</EmptyNote>
      ) : (
        <div className="mt-3.5 max-h-72 overflow-auto rounded-xl border border-white/5">
          <table className="w-full text-left text-[11px]" style={{ fontFamily: MONO }}>
            <thead className="sticky top-0 bg-[#121110]">
              <tr className="text-[9px] uppercase tracking-[0.16em] text-white/35">
                <th className="px-3 py-2 font-normal">Method</th>
                <th className="px-3 py-2 font-normal">Path</th>
                <th className="px-3 py-2 font-normal">File</th>
              </tr>
            </thead>
            <tbody>
              {apis.map((a, i) => {
                const method = a.method.toUpperCase();
                return (
                  <tr
                    key={`${method}-${a.path}-${i}`}
                    className="border-t border-white/5 hover:bg-white/[0.03]"
                  >
                    <td className="whitespace-nowrap px-3 py-2">
                      <span
                        className="font-semibold"
                        style={{ color: METHOD_COLOR[method] ?? 'rgba(255,255,255,0.6)' }}
                      >
                        {method}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-white/80">{a.path}</td>
                    <td className="break-all px-3 py-2 text-white/40">{a.file}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </GlassCard>
  );
}

/* ── code quality ────────────────────────────────────────────────────────── */

function QualityCard({ quality }: { quality: HealthReport['quality'] }) {
  const grouped = SEVERITY_ORDER.map((sev) => ({
    sev,
    items: quality.issues.filter((i) => i.severity === sev),
  })).filter((g) => g.items.length > 0);

  return (
    <GlassCard className="p-5 md:col-span-2">
      <CardLabel>Code Quality</CardLabel>

      {quality.strengths.length > 0 && (
        <div className="mt-3.5">
          <p className="text-[9px] uppercase tracking-[0.16em] text-[#52D273]/80" style={{ fontFamily: MONO }}>
            Strengths
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {quality.strengths.map((s) => (
              <li key={s} className="flex items-start gap-2 text-xs leading-relaxed text-white/70">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#52D273]" strokeWidth={3} />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {grouped.length > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          {grouped.map(({ sev, items }) => (
            <div key={sev}>
              <p
                className="text-[9px] uppercase tracking-[0.16em]"
                style={{ fontFamily: MONO, color: SEVERITY_META[sev].text }}
              >
                {SEVERITY_META[sev].label} · {items.length}
              </p>
              <ul className="mt-2 flex flex-col gap-2.5">
                {items.map((issue, i) => (
                  <IssueRow key={`${issue.title}-${i}`} issue={issue} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {quality.issues.length === 0 && (
        <EmptyNote>No issues flagged — nice and clean.</EmptyNote>
      )}

      {quality.suggestions.length > 0 && (
        <div className="mt-4 border-t border-white/5 pt-3.5">
          <p className="text-[9px] uppercase tracking-[0.16em] text-white/40" style={{ fontFamily: MONO }}>
            Suggestions
          </p>
          <ol className="mt-2 flex flex-col gap-1.5">
            {quality.suggestions.map((s, i) => (
              <li key={s} className="flex items-start gap-2.5 text-xs leading-relaxed text-white/70">
                <span
                  className="mt-px shrink-0 text-[10px] text-[#FF8233] tabular-nums"
                  style={{ fontFamily: MONO }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </GlassCard>
  );
}

function IssueRow({ issue }: { issue: HealthIssue }) {
  const meta = SEVERITY_META[issue.severity];
  return (
    <li className="flex items-start gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] p-3">
      <span
        aria-hidden
        className="mt-1 h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: meta.dot }}
      />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-white/85">{issue.title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-white/50">{issue.detail}</p>
        {issue.file && (
          <p
            className="mt-1 break-all text-[10px] text-white/35"
            style={{ fontFamily: MONO }}
          >
            {issue.file}
          </p>
        )}
      </div>
    </li>
  );
}

/* ── security ────────────────────────────────────────────────────────────── */

function SecurityCard({ security }: { security: HealthReport['security'] }) {
  return (
    <GlassCard className="p-5">
      <CardLabel>Security</CardLabel>
      <div
        className={`mt-3.5 flex items-center gap-2.5 rounded-xl border p-3 ${
          security.secretsFound
            ? 'border-[#FF3B30]/40 bg-[#FF3B30]/10'
            : 'border-[#52D273]/25 bg-[#52D273]/[0.06]'
        }`}
      >
        {security.secretsFound ? (
          <ShieldAlert className="h-4 w-4 shrink-0 text-[#FF6B61]" />
        ) : (
          <ShieldCheck className="h-4 w-4 shrink-0 text-[#52D273]" />
        )}
        <span
          className={`text-[10px] uppercase tracking-[0.14em] ${
            security.secretsFound ? 'text-[#FF6B61]' : 'text-[#52D273]'
          }`}
          style={{ fontFamily: MONO }}
        >
          {security.secretsFound
            ? 'Possible secrets committed to the repo'
            : 'No committed secrets detected'}
        </span>
      </div>
      {security.findings.length === 0 ? (
        <EmptyNote>No other security findings.</EmptyNote>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {security.findings.map((f) => (
            <li key={f} className="flex items-start gap-2 text-xs leading-relaxed text-white/65">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#FF8233]" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}

/* ── tests & docs ────────────────────────────────────────────────────────── */

function TestsDocsCard({
  tests,
  docs,
}: {
  tests: HealthReport['tests'];
  docs: HealthReport['docs'];
}) {
  return (
    <GlassCard className="p-5">
      <CardLabel>Tests &amp; Docs</CardLabel>
      <div className="mt-3.5 flex flex-col gap-3">
        <PresenceRow icon={FlaskConical} label="Tests" present={tests.present} note={tests.note} />
        <PresenceRow icon={BookOpen} label="Docs" present={docs.present} note={docs.note} />
      </div>
    </GlassCard>
  );
}

function PresenceRow({
  icon: Icon,
  label,
  present,
  note,
}: {
  icon: typeof FlaskConical;
  label: string;
  present: boolean;
  note: string;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-white/45" />
        <span className="text-xs font-semibold text-white/85">{label}</span>
        <span
          className={`ml-auto rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] ${
            present
              ? 'border-[#52D273]/30 bg-[#52D273]/10 text-[#52D273]'
              : 'border-[#FF3B30]/30 bg-[#FF3B30]/10 text-[#FF6B61]'
          }`}
          style={{ fontFamily: MONO }}
        >
          {present ? 'Present' : 'Absent'}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-white/50">{note}</p>
    </div>
  );
}
