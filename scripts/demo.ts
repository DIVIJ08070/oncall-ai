/**
 * OnCall AI — end-to-end demo rehearsal harness + traffic generator (C15).
 *
 * Drives the full live loop against an already-running stack (platform + victim):
 *
 *   healthy baseline (light traffic)
 *     → flip to a failing mode under traffic
 *     → detector opens an incident (~15s)
 *     → agent investigation runs (feed + PR)
 *     → report the PR / findings
 *     → recovery: flip healthy (+ optional --wait-for-merge for the true end-to-end)
 *
 * It talks ONLY to the platform's demo control plane (SPEC §7.7): the same
 * `POST /api/v1/demo/failure-mode` + `POST /api/v1/demo/traffic` seams the dashboard
 * DemoControl panel uses (DESIGN_SPEC §6.4). So a green run here rehearses exactly
 * what the live demo does.
 *
 * Prereqs (start these first, e.g. in separate terminals):
 *   AGENT_MODE=cached DEV_NO_AUTH=true DETECTION_INTERVAL_MS=5000 \
 *     npm run --workspace @oncall/server start          # platform :3001
 *   npm run --workspace oncall-ai-victim dev            # victim   :4000
 * Then:
 *   npm run demo                                        # default bad_deploy
 *   npm run demo -- --scenario slow_db --rate 90
 *   npm run demo -- --wait-for-merge                    # pauses until you merge the PR
 *
 * Flags:
 *   --scenario <bad_deploy|slow_db|config_error>  (default bad_deploy)
 *   --rate <req/min>                              (default 80)
 *   --platform <url>   (default $PUBLIC_BASE_URL or http://localhost:3001)
 *   --victim <url>     (default $VICTIM_CONTROL_URL or http://localhost:4000)
 *   --wait-for-merge   after the PR, poll until the incident resolves (human merges)
 *   --no-recover       skip the healthy recovery step (leave the victim broken)
 */

type Mode = 'healthy' | 'bad_deploy' | 'slow_db' | 'config_error';

const SCENARIO_TARGET: Record<Exclude<Mode, 'healthy'>, string> = {
  bad_deploy: 'checkout',
  slow_db: 'reports',
  config_error: 'pricing',
};

/* ── args ─────────────────────────────────────────────────────────────────── */

function arg(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return dflt;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const PLATFORM = (arg('platform', process.env.PUBLIC_BASE_URL || 'http://localhost:3001') as string).replace(/\/+$/, '');
const VICTIM = (arg('victim', process.env.VICTIM_CONTROL_URL || 'http://localhost:4000') as string).replace(/\/+$/, '');
const SCENARIO = (arg('scenario', 'bad_deploy') as Mode);
const RATE = Number(arg('rate', '80'));
const WAIT_FOR_MERGE = flag('wait-for-merge');
const RECOVER = !flag('no-recover');
const API = `${PLATFORM}/api/v1`;

/* ── tiny console helpers ─────────────────────────────────────────────────── */

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};
function step(n: number, msg: string): void {
  console.log(`\n${c.bold(c.cyan(`[${n}]`))} ${c.bold(msg)}`);
}
function info(msg: string): void {
  console.log(`    ${msg}`);
}
function ok(msg: string): void {
  console.log(`    ${c.green('✓')} ${msg}`);
}
function warn(msg: string): void {
  console.log(`    ${c.yellow('!')} ${msg}`);
}
function fail(msg: string): never {
  console.error(`\n${c.red('✗')} ${msg}\n`);
  process.exit(1);
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* ── platform demo-control seam (SPEC §7.7) ───────────────────────────────── */

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = body?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`${init?.method ?? 'GET'} ${url} → ${res.status}: ${msg}`);
  }
  return body as T;
}

async function flipMode(mode: Mode): Promise<{ mode: Mode; deployed_sha: string | null }> {
  return getJson(`${API}/demo/failure-mode`, {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });
}

async function burst(target: string, count: number): Promise<{ sent: number }> {
  return getJson(`${API}/demo/traffic`, {
    method: 'POST',
    body: JSON.stringify({ target, count }),
  });
}

/* ── a continuous traffic driver over the platform seam ────────────────────── */

const TICK_MS = 1500;
class TrafficDriver {
  private timer: NodeJS.Timeout | null = null;
  private carry = 0;
  sent = 0;
  constructor(private target: string, private ratePerMin: number) {}

  setTarget(target: string): void {
    this.target = target;
  }
  start(): void {
    if (this.timer) return;
    const tick = async (): Promise<void> => {
      this.carry += (this.ratePerMin / 60) * (TICK_MS / 1000);
      const count = Math.floor(this.carry);
      if (count >= 1) {
        this.carry -= count;
        try {
          const r = await burst(this.target, count);
          this.sent += r.sent;
        } catch {
          /* transient — keep driving */
        }
      }
    };
    void tick();
    this.timer = setInterval(() => void tick(), TICK_MS);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/* ── read APIs (poll for the loop to progress) ─────────────────────────────── */

interface IncidentSummary {
  id: string;
  service: string;
  title: string;
  status: string;
  severity: string;
  opened_at: number;
  confidence?: number | null;
}
interface IncidentDetail {
  incident: {
    id: string;
    status: string;
    root_cause?: string | null;
    confidence?: number | null;
    observed_value?: number | null;
    threshold_value?: number | null;
  };
  session: { status: string; decision?: string | null; iterations?: number | null; mode?: string } | null;
  steps: { seq: number; type: string; tool_name?: string | null }[];
  pull_request: { number: number; url: string; state: string; verification_status?: string | null } | null;
}

async function listIncidents(): Promise<IncidentSummary[]> {
  const r = await getJson<{ incidents: IncidentSummary[] }>(`${API}/incidents`);
  return r.incidents;
}
async function getIncident(id: string): Promise<IncidentDetail> {
  return getJson<IncidentDetail>(`${API}/incidents/${id}`);
}

/** Poll until `predicate` is truthy or the deadline passes. */
async function pollUntil<T>(
  label: string,
  fetcher: () => Promise<T>,
  predicate: (v: T) => boolean,
  timeoutMs: number,
  everyMs = 2000,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  let last: T | null = null;
  while (Date.now() < deadline) {
    try {
      last = await fetcher();
      if (predicate(last)) return last;
    } catch {
      /* keep polling */
    }
    process.stdout.write(c.dim('.'));
    await sleep(everyMs);
  }
  process.stdout.write('\n');
  warn(`timed out waiting for ${label} (${Math.round(timeoutMs / 1000)}s)`);
  return last;
}

/* ── preflight ────────────────────────────────────────────────────────────── */

async function preflight(): Promise<void> {
  try {
    await getJson(`${PLATFORM}/health`);
    ok(`platform up · ${PLATFORM}`);
  } catch {
    fail(
      `platform not reachable at ${PLATFORM}/health.\n  Start it:  AGENT_MODE=cached DEV_NO_AUTH=true DETECTION_INTERVAL_MS=5000 npm run --workspace @oncall/server start`,
    );
  }
  try {
    await getJson(`${VICTIM}/health`);
    ok(`victim up · ${VICTIM}`);
  } catch {
    fail(
      `victim not reachable at ${VICTIM}/health.\n  Start it:  npm run --workspace oncall-ai-victim dev`,
    );
  }
  // The demo control plane must be present (C15). A 404 here means an old server.
  try {
    await getJson(`${API}/demo/state`);
    ok('demo control plane present (POST /demo/failure-mode)');
  } catch (e) {
    fail(`demo control plane not responding: ${(e as Error).message}`);
  }
}

/* ── main ─────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  if (SCENARIO === 'healthy' || !(SCENARIO in SCENARIO_TARGET)) {
    fail(`--scenario must be one of: ${Object.keys(SCENARIO_TARGET).join(', ')}`);
  }
  console.log(c.bold('\nOnCall AI — demo rehearsal'));
  info(`${c.dim('platform')} ${PLATFORM}  ${c.dim('victim')} ${VICTIM}`);
  info(`${c.dim('scenario')} ${c.yellow(SCENARIO)}  ${c.dim('rate')} ${RATE} req/min  ${c.dim('wait-for-merge')} ${WAIT_FOR_MERGE}`);

  step(0, 'Preflight');
  await preflight();

  const target = SCENARIO_TARGET[SCENARIO as Exclude<Mode, 'healthy'>];
  const driver = new TrafficDriver('mix', RATE);

  // 1 — healthy baseline.
  step(1, 'Healthy baseline');
  const h = await flipMode('healthy');
  ok(`victim → healthy (deployed_sha ${h.deployed_sha?.slice(0, 7) ?? '—'})`);
  driver.setTarget('mix');
  driver.start();
  info('driving light healthy traffic for 6s so baseline metrics populate…');
  await sleep(6000);

  // 2 — break it under load.
  step(2, `Flip to ${SCENARIO} under traffic`);
  const f = await flipMode(SCENARIO);
  ok(`victim → ${f.mode} (bad SHA ${f.deployed_sha?.slice(0, 7) ?? '—'}) · deploy row recorded`);
  driver.setTarget(target);
  info(`driving traffic at /${target === 'checkout' ? 'api/checkout' : target === 'reports' ? 'api/reports' : 'api/pricing'} …`);

  // 3 — detector opens an incident. Prefer a brand-new one, but on a re-run
  // against a dirty DB fall back to any active incident (dedup reuses the id).
  step(3, 'Wait for the detector to open an incident');
  const ACTIVE = ['open', 'investigating', 'fix_proposed', 'awaiting_merge', 'verifying'];
  const beforeIds = new Set((await listIncidents().catch(() => [])).map((i) => i.id));
  const opened = await pollUntil(
    'an incident to open',
    listIncidents,
    (list) => list.some((i) => ACTIVE.includes(i.status)),
    75_000,
  );
  const activeNow = (opened ?? []).filter((i) => ACTIVE.includes(i.status));
  const incident = activeNow.find((i) => !beforeIds.has(i.id)) ?? activeNow[0];
  if (!incident) {
    driver.stop();
    fail('no incident opened — is the detection loop running? (check DETECTION_INTERVAL_MS + traffic)');
  }
  process.stdout.write('\n');
  const fresh = !beforeIds.has(incident.id);
  ok(`incident ${c.bold(incident.id)} · ${incident.title}${fresh ? '' : c.dim(' (existing, reused via dedup)')}`);
  info(`detector ${c.yellow(incident.severity)} · status ${incident.status}`);

  // 4 — investigation runs (feed + PR).
  step(4, 'Wait for the agent investigation');
  const detail = await pollUntil(
    'the investigation to finish',
    () => getIncident(incident.id),
    (d) =>
      d.session != null &&
      ['completed', 'escalated', 'failed'].includes(d.session.status) &&
      (d.pull_request != null || d.incident.status === 'escalated'),
    120_000,
  );
  process.stdout.write('\n');
  if (!detail?.session) {
    driver.stop();
    fail('investigation never produced a session — check AGENT_MODE (cached works offline) + server logs');
  }
  ok(`session ${detail.session.status} · ${detail.steps.length} steps · ${detail.session.mode ?? '?'} engine`);
  if (detail.incident.root_cause) info(`root cause: ${detail.incident.root_cause}`);
  if (detail.incident.confidence != null) info(`confidence: ${Math.round(detail.incident.confidence * 100)}%`);
  if (detail.pull_request) {
    ok(`PR #${detail.pull_request.number} (${detail.pull_request.state}) → ${c.cyan(detail.pull_request.url)}`);
  } else {
    warn('no PR — the agent escalated to a human (low confidence / FR-13).');
  }

  // 5 — recovery.
  if (!RECOVER) {
    driver.setTarget('mix');
    warn('--no-recover: leaving the victim in the failing mode. Traffic still running; Ctrl-C to stop.');
    return;
  }

  step(5, 'Recovery');
  if (WAIT_FOR_MERGE && detail.pull_request) {
    info(`merge PR #${detail.pull_request.number} on GitHub to trigger the merge poller → heal → verify → resolved`);
    info('polling the incident until it resolves…');
    const resolved = await pollUntil(
      'the incident to resolve after merge',
      () => getIncident(incident.id),
      (d) => ['resolved', 'closed'].includes(d.incident.status),
      15 * 60_000,
      4000,
    );
    process.stdout.write('\n');
    if (resolved && ['resolved', 'closed'].includes(resolved.incident.status)) {
      ok(`incident ${c.green(resolved.incident.status)} · recovery verified (${resolved.pull_request?.verification_status ?? '—'})`);
    } else {
      warn('not resolved within the window — merge the PR, or check the merge poller (needs GITHUB_TOKEN).');
    }
  } else {
    const r = await flipMode('healthy');
    ok(`victim → healthy (deployed_sha ${r.deployed_sha?.slice(0, 7) ?? '—'})`);
    driver.setTarget('mix');
    info('driving healthy traffic; polling for self-heal (pre-PR) or merge-driven recovery for 40s…');
    const final = await pollUntil(
      'recovery',
      () => getIncident(incident.id),
      (d) => ['resolved', 'closed'].includes(d.incident.status),
      40_000,
    );
    process.stdout.write('\n');
    const status = final?.incident.status ?? incident.status;
    if (['resolved', 'closed'].includes(status)) {
      ok(`incident ${c.green(status)} · recovered`);
    } else if (detail.pull_request) {
      warn(`incident still ${status}. A proposed PR does not auto-heal — merge PR #${detail.pull_request.number} (or run with --wait-for-merge) to complete recovery.`);
    } else {
      warn(`incident still ${status}.`);
    }
  }

  driver.stop();
  info(`traffic sent this run: ${driver.sent} requests`);
  console.log(`\n${c.green(c.bold('Rehearsal complete.'))}\n`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
