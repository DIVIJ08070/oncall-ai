// QA C12 re-verify (cycle 1) — BUG-010 breach dots + BUG-011 log-tag legibility + no-regression.
// Compares the running dashboard against DESIGN_SPEC §9.1 / §8.2 / §11.
import { chromium } from '/Users/mac/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
import fs from 'fs';

const OUT = '/Users/mac/Desktop/HACKATHON/agent-team-claude/features/oncall-ai/qa/qa-c12-reverify';
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:5173';
const API = 'http://localhost:3001/api/v1';
const results = { bug010: {}, bug011: {}, regression: {}, consoleByPage: {} };

// ── WCAG contrast helpers ─────────────────────────────────────────────
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const L1 = lum(a), L2 = lum(b); const hi = Math.max(L1, L2), lo = Math.min(L1, L2); return (hi + 0.05) / (lo + 0.05); };
function hexToRgb(h) { h = h.trim().replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }; }
function parseColor(s) {
  s = s.trim();
  let m = s.match(/rgba?\(([^)]+)\)/);
  if (m) { const p = m[1].split(/[,\/\s]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; }
  if (s.startsWith('#')) return { ...hexToRgb(s), a: 1 };
  return null;
}
const over = (fg, bg) => { const a = fg.a ?? 1; return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) }; };

async function fetchMetrics(service, windowSec = 900) {
  const r = await fetch(`${API}/metrics?service=${service}&window_sec=${windowSec}`);
  const j = await r.json();
  const breach = j.series.filter((p) => p.error_rate >= 0.20).length;
  const nonBreach = j.series.filter((p) => p.error_rate < 0.20).length;
  return { len: j.series.length, breach, nonBreach };
}

// Count `--critical` breach circles inside the "Error rate" chart svg.
async function countBreachDots(page) {
  return page.evaluate(() => {
    const box = document.querySelector('[role="img"][aria-label^="Error rate"]');
    if (!box) return { found: false, dots: -1, totalCircles: -1 };
    const circles = Array.from(box.querySelectorAll('circle'));
    const dots = circles.filter((c) => (c.getAttribute('fill') || '').includes('--critical')).length;
    return { found: true, dots, totalCircles: circles.length };
  });
}

async function selectService(page, name) {
  await page.selectOption('#service-filter', name);
  await page.waitForTimeout(1600); // let poll + chart animation settle
}

function attachConsole(page, key) {
  results.consoleByPage[key] = [];
  page.on('console', (m) => { if (m.type() === 'error') results.consoleByPage[key].push('console.error: ' + m.text()); });
  page.on('pageerror', (e) => results.consoleByPage[key].push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => results.consoleByPage[key].push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')));
}

async function measureLogTags(page, theme) {
  return page.evaluate((theme) => {
    const root = getComputedStyle(document.documentElement);
    const tok = (n) => root.getPropertyValue(n).trim();
    const container = document.querySelector('[role="log"]') || document.body;
    const spans = Array.from(container.querySelectorAll('span')).filter((s) => {
      const t = (s.textContent || '').trim().toLowerCase();
      return ['warn', 'error', 'info', 'debug'].includes(t) && s.className.includes('uppercase');
    });
    const seen = {};
    const out = [];
    for (const s of spans) {
      const label = (s.textContent || '').trim().toLowerCase();
      if (seen[label]) continue;
      seen[label] = true;
      const cs = getComputedStyle(s);
      const row = s.closest('.animate-enter-up');
      const rowBg = row ? getComputedStyle(row).backgroundColor : '';
      out.push({ label, color: cs.color, rowBg });
    }
    return {
      theme,
      dataTheme: document.documentElement.getAttribute('data-theme'),
      tokens: { ink: tok('--ink'), surface: tok('--surface'), critical: tok('--critical'), warn: tok('--warn'), inkMutedText: tok('--ink-muted-text'), ink2: tok('--ink-2') },
      tags: out,
    };
  }, theme);
}

async function themedContext(browser, theme) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, colorScheme: theme });
  await ctx.addInitScript((t) => localStorage.setItem('oncall-theme', t), theme);
  return ctx;
}

(async () => {
  const browser = await chromium.launch();

  // ══ BUG-010 — error-rate breach dots ══════════════════════════════
  for (const theme of ['dark', 'light']) {
    const ctx = await themedContext(browser, theme);
    const page = await ctx.newPage();
    attachConsole(page, `bug010-${theme}`);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#service-filter', { timeout: 15000 });

    // reports-api — 0% series -> expect ZERO critical dots
    await selectService(page, 'reports-api');
    const mRep = await fetchMetrics('reports-api');
    const dRep = await countBreachDots(page);
    await page.locator('[role="img"][aria-label^="Error rate"]').screenshot({ path: `${OUT}/errchart-reports-${theme}.png` });
    results.bug010[`reports-${theme}`] = { metrics: mRep, dom: dRep, pass: dRep.found && dRep.dots === 0 && mRep.breach === 0 };

    // checkout-api — breaching series -> dots ONLY on breaching points
    await selectService(page, 'checkout-api');
    const mChk = await fetchMetrics('checkout-api');
    const dChk = await countBreachDots(page);
    await page.locator('[role="img"][aria-label^="Error rate"]').screenshot({ path: `${OUT}/errchart-checkout-${theme}.png` });
    results.bug010[`checkout-${theme}`] = {
      metrics: mChk, dom: dChk,
      // Allow ±1 slack for a poll landing mid-measurement between the metrics fetch and DOM read.
      pass: dChk.found && Math.abs(dChk.dots - mChk.breach) <= 1 && dChk.dots > 0 && mChk.nonBreach > 0,
    };
    await ctx.close();
  }

  // ══ BUG-011 — log level-tag legibility (both themes) ═══════════════
  for (const theme of ['dark', 'light']) {
    const ctx = await themedContext(browser, theme);
    const page = await ctx.newPage();
    attachConsole(page, `bug011-${theme}`);
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#service-filter', { timeout: 15000 });
    // "All services" so warn AND error rows both stream in
    await page.selectOption('#service-filter', '__all__');
    await page.waitForTimeout(3500);
    const meas = await measureLogTags(page, theme);

    // compute effective contrast for each tag (color over its composited row bg)
    const surface = { ...hexToRgb(meas.tokens.surface), a: 1 };
    const tintHue = { critical: hexToRgb(meas.tokens.critical), warn: hexToRgb(meas.tokens.warn) };
    for (const t of meas.tags) {
      const color = parseColor(t.color);
      // effective bg: row bg composited over card surface (error/warn rows = 8% level tint)
      let effBg = surface;
      const rb = parseColor(t.rowBg);
      if (rb && (rb.a ?? 1) < 1) effBg = over(rb, surface);
      else if (t.label === 'error') effBg = over({ ...tintHue.critical, a: 0.08 }, surface);
      else if (t.label === 'warn') effBg = over({ ...tintHue.warn, a: 0.08 }, surface);
      t.contrast_over_rowbg = +ratio(color, effBg).toFixed(2);
      t.contrast_over_surface = +ratio(color, surface).toFixed(2);
      t.colorRgb = `rgb(${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)})`;
    }
    results.bug011[theme] = meas;

    // Full log card + a warn-filtered view for the record
    await page.locator('[role="log"]').screenshot({ path: `${OUT}/logtags-all-${theme}.png` }).catch(() => {});
    // filter to warn to make the (previously-illegible on light) warn tag prominent
    const warnChip = page.getByRole('button', { name: /warn/i }).first();
    if (await warnChip.count()) { /* toggling handled below via filter chips */ }
    await ctx.close();
  }

  // Determine BUG-011 pass: warn+error tags >= 4.5 on BOTH themes
  const b011pass = ['dark', 'light'].every((th) => {
    const tags = results.bug011[th]?.tags || [];
    const warn = tags.find((t) => t.label === 'warn');
    const err = tags.find((t) => t.label === 'error');
    return warn && err && warn.contrast_over_rowbg >= 4.5 && err.contrast_over_rowbg >= 4.5;
  });
  results.bug011.pass = b011pass;

  // ══ NO-REGRESSION — full dashboard at 375/768/1280 × dark/light ════
  const viewports = [{ w: 375, h: 812 }, { w: 768, h: 1024 }, { w: 1280, h: 800 }];
  for (const theme of ['dark', 'light']) {
    for (const vp of viewports) {
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, colorScheme: theme });
      await ctx.addInitScript((t) => localStorage.setItem('oncall-theme', t), theme);
      const page = await ctx.newPage();
      const key = `dash-${vp.w}-${theme}`;
      attachConsole(page, key);
      await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#service-filter', { timeout: 15000 });
      await page.waitForTimeout(3000); // let SSE logs + charts stream in
      await page.screenshot({ path: `${OUT}/dashboard-${vp.w}-${theme}.png`, fullPage: true });
      await ctx.close();
    }
  }

  // ══ States (loading is transient; capture log-expanded + all-services live) ══
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    attachConsole(page, 'log-expanded');
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#service-filter', { timeout: 15000 });
    await selectService(page, 'checkout-api');
    await page.waitForTimeout(2500);
    // expand first log row that has detail
    const row = page.locator('[role="log"] button[aria-expanded]').first();
    if (await row.count()) { await row.click().catch(() => {}); await page.waitForTimeout(500); }
    await page.locator('[role="log"]').screenshot({ path: `${OUT}/log-expanded-checkout.png` }).catch(() => {});
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(`${OUT}/reverify-results.json`, JSON.stringify(results, null, 2));

  // ── console summary ──
  console.log('\n================ BUG-010 (breach dots) ================');
  for (const [k, v] of Object.entries(results.bug010)) {
    console.log(`${k.padEnd(18)} dots=${v.dom.dots} (svg circles ${v.dom.totalCircles}) | metrics breach=${v.metrics.breach} nonBreach=${v.metrics.nonBreach} len=${v.metrics.len} | ${v.pass ? 'PASS' : 'FAIL'}`);
  }
  console.log('\n================ BUG-011 (log tag contrast) ================');
  for (const th of ['dark', 'light']) {
    console.log(`-- ${th} (data-theme=${results.bug011[th].dataTheme}) ink=${results.bug011[th].tokens.ink} surface=${results.bug011[th].tokens.surface}`);
    for (const t of results.bug011[th].tags) {
      console.log(`   ${t.label.padEnd(6)} color=${t.colorRgb} | contrast over rowBg=${t.contrast_over_rowbg} over surface=${t.contrast_over_surface}`);
    }
  }
  console.log(`\nBUG-011 pass (warn+error >=4.5 both themes): ${results.bug011.pass}`);
  console.log('\n================ CONSOLE ERRORS per page ================');
  for (const [k, arr] of Object.entries(results.consoleByPage)) {
    const real = arr.filter((x) => !/ERR_ABORTED/.test(x));
    console.log(`${k.padEnd(16)} total=${arr.length} nonAborted=${real.length}${real.length ? ' :: ' + real.slice(0, 3).join(' | ') : ''}`);
  }
  console.log('\nDONE. results ->', `${OUT}/reverify-results.json`);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
