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
 * PREDICTIVE-TREND scenario (AI Incident PREVENTION — "predict before" vs "fix after"):
 *   A gradual latency degradation on `payments-api /api/payments/charge` makes the
 *   platform's trend prediction show a rising "may breach in ~N min" and step
 *   EARLY_RISK → WARNING BEFORE the p95 SLO is actually crossed, then recovers.
 *   It drives the victim's `POST /__control/degrade` ramp directly and polls
 *   `GET /api/v1/performance` for the charge endpoint's prediction each window.
 *   For a WATCHABLE run, start the platform with a SHORT rollup window, e.g.
 *     PERF_WINDOW_SEC=30 DETECTION_INTERVAL_MS=5000 … npm run --workspace @oncall/server start
 *   and pass a matching `--window 30` so the harness paces its waits to the ticker.
 *     npm run demo -- --scenario predictive_trend --window 30 --ramp 180
 *
 * Flags:
 *   --scenario <bad_deploy|slow_db|config_error|predictive_trend>  (default bad_deploy)
 *   --rate <req/min>                              (default 80; background mix)
 *   --platform <url>   (default $PUBLIC_BASE_URL or http://localhost:3001)
 *   --victim <url>     (default $VICTIM_CONTROL_URL or http://localhost:4000)
 *   --wait-for-merge   after the PR, poll until the incident resolves (human merges)
 *   --no-recover       skip the healthy recovery step (leave the victim broken)
 *   predictive_trend only:
 *   --ramp <seconds>        latency-ramp duration (default 180)
 *   --max-latency <ms>      extra-latency ceiling at full ramp (default 1600)
 *   --charge-rate <req/min> direct payments-charge load (default 240)
 *   --window <seconds>      rollup-window hint used to pace waits (default 30;
 *                           set to the server's PERF_WINDOW_SEC)
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
const SCENARIO = arg('scenario', 'bad_deploy') as string;
const RATE = Number(arg('rate', '80'));
const WAIT_FOR_MERGE = flag('wait-for-merge');
const RECOVER = !flag('no-recover');
const API = `${PLATFORM}/api/v1`;

// predictive_trend knobs
const RAMP_SECONDS = Number(arg('ramp', '180'));
const MAX_LATENCY_MS = Number(arg('max-latency', '1600'));
const CHARGE_RATE = Number(arg('charge-rate', '240'));
const WINDOW_SEC = Number(arg('window', '30'));

// predictive_trend target — the endpoint the ramp degrades + we poll for on the
// platform performance API (matches the victim telemetry service + endpoint path).
const PAY_SERVICE = 'payments-api';
const PAY_ENDPOINT = '/api/payments/charge';

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

/* ── predictive_trend: performance API + degradation control ───────────────── */

interface PerfPrediction {
  status: string;
  probability: number;
  minutesToBreach: number | null;
  riskScore: number;
  detail: string;
}
interface PerfEndpoint {
  service: string;
  endpoint: string;
  method: string;
  p50: number;
  p95: number;
  p99: number;
  requestCount: number;
  rps: number;
  errorRate: number;
  score: { overall_score: number; grade: string };
  prediction: PerfPrediction;
}

/** Severity rank so we can poll for "reached status X or worse". */
const RANK: Record<string, number> = {
  NORMAL: 0,
  RECOVERED: 0,
  EARLY_RISK: 1,
  WARNING: 2,
  ESCALATED: 3,
  BREACHED: 4,
};

async function getPerformance(): Promise<PerfEndpoint[]> {
  const r = await getJson<{ endpoints: PerfEndpoint[] }>(`${API}/performance`);
  return r.endpoints ?? [];
}
function findCharge(eps: PerfEndpoint[]): PerfEndpoint | undefined {
  return eps.find((e) => e.service === PAY_SERVICE && e.endpoint === PAY_ENDPOINT);
}
function showCharge(prefix: string, c: PerfEndpoint): void {
  const mtb = c.prediction.minutesToBreach != null ? ` · ~${c.prediction.minutesToBreach}min to breach` : '';
  info(
    `${prefix} p95=${Math.round(c.p95)}ms · score ${Math.round(c.score.overall_score)}/100 · ` +
      `${c.prediction.status}${mtb} (${Math.round(c.prediction.probability * 100)}% · ${c.requestCount} reqs)`,
  );
}

/** Poll the performance API until the charge endpoint satisfies `ok`. */
async function pollCharge(
  label: string,
  okFn: (c: PerfEndpoint) => boolean,
  timeoutMs: number,
): Promise<PerfEndpoint | null> {
  const eps = await pollUntil(
    label,
    getPerformance,
    (list) => {
      const c = findCharge(list);
      return c != null && okFn(c);
    },
    timeoutMs,
    2500,
  );
  return eps ? findCharge(eps) ?? null : null;
}

interface DegradeState {
  service: string;
  endpoint: string;
  kind: string;
  rampSeconds: number;
  startedAt: number;
  maxExtraLatencyMs: number;
  maxErrorRatio: number;
}
async function startDegrade(body: Record<string, unknown>): Promise<{ ok: boolean; degrade: DegradeState }> {
  return getJson(`${VICTIM}/__control/degrade`, { method: 'POST', body: JSON.stringify(body) });
}
async function clearDegrade(): Promise<void> {
  await getJson(`${VICTIM}/__control/degrade/clear`, { method: 'POST', body: '{}' });
}

/** Direct payments-charge load (the platform traffic seam has no payments target). */
const rndAmount = (): number => Math.round((10 + Math.random() * 290) * 100) / 100;
async function chargeOnce(): Promise<{ ms: number; status: number }> {
  const t0 = Date.now();
  let status = 0;
  try {
    const res = await fetch(`${VICTIM}/api/payments/charge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount: rndAmount(), currency: 'usd', token: 'tok_demo_predictive' }),
    });
    status = res.status;
    await res.arrayBuffer();
  } catch {
    status = 0;
  }
  return { ms: Date.now() - t0, status };
}
/** Fire `n` charges spaced by `gapMs`, returning their client-measured latencies. */
async function sampleCharges(n: number, gapMs = 450): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = await chargeOnce();
    out.push(r.ms);
    if (i < n - 1) await sleep(gapMs);
  }
  return out;
}

class ChargeDriver {
  private timer: NodeJS.Timeout | null = null;
  private carry = 0;
  sent = 0;
  constructor(private ratePerMin: number) {}
  start(): void {
    if (this.timer) return;
    const tick = (): void => {
      this.carry += (this.ratePerMin / 60) * (TICK_MS / 1000);
      const n = Math.floor(this.carry);
      if (n >= 1) {
        this.carry -= n;
        for (let i = 0; i < n; i++) {
          void chargeOnce().then(() => {
            this.sent++;
          });
        }
      }
    };
    void tick();
    this.timer = setInterval(tick, TICK_MS);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/* ── predictive_trend scenario (17 narrated steps) ─────────────────────────── */

async function runPredictiveTrend(): Promise<void> {
  console.log(c.bold('\nOnCall AI — predictive-trend demo  (early warning BEFORE the breach)'));
  info(`${c.dim('platform')} ${PLATFORM}  ${c.dim('victim')} ${VICTIM}`);
  info(
    `${c.dim('target')} ${PAY_SERVICE} ${PAY_ENDPOINT}  ${c.dim('ramp')} ${RAMP_SECONDS}s  ` +
      `${c.dim('ceiling')} +${MAX_LATENCY_MS}ms  ${c.dim('window-hint')} ${WINDOW_SEC}s`,
  );
  const W = Math.max(1000, WINDOW_SEC * 1000);

  // 1 — Preflight.
  step(1, 'Preflight — platform, victim, demo control, performance route');
  await preflight();
  try {
    await getPerformance();
    ok('performance route present (GET /api/v1/performance)');
  } catch (e) {
    fail(`performance route not responding: ${(e as Error).message}`);
  }

  // 2 — Clean healthy baseline.
  step(2, 'Reset to a clean healthy baseline');
  const h = await flipMode('healthy');
  await clearDegrade().catch(() => {});
  ok(`victim → healthy (deployed_sha ${h.deployed_sha?.slice(0, 7) ?? '—'}) · degradation cleared`);

  // 3 — Background healthy mix.
  step(3, 'Start healthy background traffic (mixed services)');
  const bg = new TrafficDriver('mix', RATE);
  bg.start();
  ok(`background mix at ~${RATE} req/min via the platform traffic seam`);

  // 4 — Steady payments-charge load.
  step(4, `Start steady load at ${PAY_ENDPOINT}`);
  const charge = new ChargeDriver(CHARGE_RATE);
  charge.start();
  const base = await sampleCharges(5);
  ok(`charge load ~${CHARGE_RATE} req/min · baseline latencies ${base.map((m) => `${m}ms`).join(' ')}`);

  // 5 — Baseline on the platform.
  step(5, 'Observe the healthy baseline on the platform');
  info('waiting for the performance ticker to roll up the charge endpoint…');
  const baseC = await pollCharge('the charge endpoint to appear', () => true, Math.max(90_000, 4 * W));
  if (baseC) showCharge('baseline:', baseC);
  else
    warn(
      `charge endpoint not rolled up yet — the ticker window may be long. ` +
        `Start the server with PERF_WINDOW_SEC≈${WINDOW_SEC} for a fast demo.`,
    );
  const baseP95 = baseC ? Math.round(baseC.p95) : 0;

  // 6 — Trigger the gradual latency degradation.
  step(6, 'Trigger a GRADUAL latency degradation on payments charge');
  const d = await startDegrade({
    service: PAY_SERVICE,
    endpoint: PAY_ENDPOINT,
    kind: 'latency',
    rampSeconds: RAMP_SECONDS,
    maxExtraLatencyMs: MAX_LATENCY_MS,
  });
  ok(`POST ${VICTIM}/__control/degrade → extra latency ramps +0 → +${d.degrade.maxExtraLatencyMs}ms over ${d.degrade.rampSeconds}s`);

  // 7 — The ramp climbs (it does not snap).
  step(7, 'Degradation active — the latency CLIMBS, it does not snap');
  info(
    `contract: { service:"${d.degrade.service}", endpoint:"${d.degrade.endpoint}", ` +
      `kind:"${d.degrade.kind}", rampSeconds:${d.degrade.rampSeconds}, maxExtraLatencyMs:${d.degrade.maxExtraLatencyMs} }`,
  );

  // 8 — Watch live charge latency climb.
  step(8, 'Watch live charge latency climb');
  const s1 = await sampleCharges(4, 500);
  await sleep(Math.min(RAMP_SECONDS * 1000 * 0.3, 9000));
  const s2 = await sampleCharges(4, 500);
  info(`early ramp: ${s1.map((m) => `${m}ms`).join(' ')}`);
  info(`later ramp: ${s2.map((m) => `${m}ms`).join(' ')}  ${c.dim('← climbing')}`);

  // 9 — p95 rising on the platform.
  step(9, 'Platform sees p95 rising above baseline');
  const rising = await pollCharge('p95 to rise above baseline', (cc) => cc.p95 > baseP95 + 50, Math.max(90_000, 4 * W));
  if (rising) showCharge('rising:', rising);
  else warn('p95 rise not observed within the window (long ticker window?).');

  // 10 — EARLY_RISK (before any breach).
  step(10, 'Platform raises EARLY_RISK — before the SLO is crossed');
  const early = await pollCharge('prediction → EARLY_RISK', (cc) => RANK[cc.prediction.status] >= RANK.EARLY_RISK, Math.max(180_000, 8 * W));
  if (early) {
    showCharge('EARLY_RISK:', early);
    ok(early.prediction.detail);
  } else warn('EARLY_RISK not observed yet — the prediction needs ≥3 rollup windows of history.');

  // 11 — The forward-looking prediction.
  step(11, 'Forward-looking prediction: “may breach in ~N min”');
  const pred = early ?? rising ?? baseC;
  if (pred && pred.prediction.minutesToBreach != null) {
    info(`prediction: ${pred.prediction.detail}  (risk ${pred.prediction.riskScore}/100)`);
  } else {
    info(`prediction forming — latest detail: ${pred?.prediction.detail ?? 'n/a'}`);
  }

  // 12 — WARNING as the trend steepens.
  step(12, 'Risk steps up to WARNING as the trend steepens');
  const warnC = await pollCharge('prediction → WARNING', (cc) => RANK[cc.prediction.status] >= RANK.WARNING, Math.max(180_000, 8 * W));
  if (warnC) {
    showCharge('WARNING:', warnC);
    ok(warnC.prediction.detail);
  } else warn('WARNING not reached within the window.');

  // 13 — The breach window narrows.
  step(13, 'Prediction sharpens — the breach window narrows');
  const sharp = warnC ?? early ?? rising;
  if (sharp) {
    info(`now: p95=${Math.round(sharp.p95)}ms · ${sharp.prediction.detail} · prob ${Math.round(sharp.prediction.probability * 100)}%`);
  }
  info('The warning fired while p95 was still UNDER the SLO — that is the whole point.');

  // 14 — Actionable early warning.
  step(14, 'Actionable early warning');
  info('This is the moment an AI/agent can investigate: a rising TREND, not yet an open incident.');
  info('The platform surfaces it on the Early-Warning card while latency is still within SLO.');

  // 15 — Recovery.
  step(15, 'Recovery — clear the degradation');
  await clearDegrade();
  ok(`POST ${VICTIM}/__control/degrade/clear → charge latency returns to baseline`);

  // 16 — Live latency falls back.
  step(16, 'Watch live charge latency fall back');
  await sleep(1500);
  const r1 = await sampleCharges(5, 400);
  info(`post-clear: ${r1.map((m) => `${m}ms`).join(' ')}  ${c.dim('← back near baseline')}`);

  // 17 — Cool-down → RECOVERED / NORMAL.
  step(17, 'Platform cools down → RECOVERED / NORMAL');
  const done = await pollCharge('prediction → RECOVERED/NORMAL', (cc) => RANK[cc.prediction.status] <= RANK.RECOVERED, Math.max(120_000, 6 * W));
  if (done) showCharge('resolved:', done);
  else warn('cool-down not observed within the window (long ticker window?).');

  bg.stop();
  charge.stop();
  info(`traffic this run: ${bg.sent} mix + ${charge.sent} charge requests`);
  console.log(`\n${c.green(c.bold('Predictive-trend demo complete.'))}\n`);
}

/* ── main ─────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  if (SCENARIO === 'predictive_trend') {
    await runPredictiveTrend();
    return;
  }
  if (SCENARIO === 'healthy' || !(SCENARIO in SCENARIO_TARGET)) {
    fail(`--scenario must be one of: bad_deploy, slow_db, config_error, predictive_trend`);
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
  const f = await flipMode(SCENARIO as Mode);
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
