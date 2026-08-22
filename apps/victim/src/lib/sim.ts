/**
 * Realistic simulation helpers for the demo commerce platform (no deps).
 *
 * The victim ships telemetry `{service, endpoint, method, status, latency_ms}` per
 * request; the platform groups by (service, endpoint). To make the dashboard look
 * like a real product, each commerce endpoint uses these helpers to fake sensible
 * per-domain latency, a small in-memory catalog / users, id generators, and a
 * *low* baseline error rate (1–3%) so service scores are not a flat 100.
 *
 * Nothing here touches the failure-mode demo (checkout/reports/pricing) — that is
 * still driven entirely by `getActiveMode()` in `control.ts`.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

/* ── timing ──────────────────────────────────────────────────────────────── */

/** Resolve after `ms` milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

/**
 * A latency sample around `base` ms, spread by ±`spreadPct` (default ±30%).
 * e.g. `jitter(40)` → roughly 28–52ms. Always ≥1.
 */
export function jitter(base: number, spreadPct = 0.3): number {
  const spread = base * spreadPct;
  return Math.max(1, Math.round(base + (Math.random() * 2 - 1) * spread));
}

/** `true` with probability `rate` (0..1). Used for realistic low error rates. */
export function maybeFail(rate: number): boolean {
  return Math.random() < rate;
}

/** Uniformly pick one element of a non-empty array. */
export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

/** Round `n` to `dp` decimal places (default 2). */
export function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * A pseudo model confidence / relevance score in `[min, max]`, rounded to `dp`
 * places. Used by the AI services to shape responses like real model output.
 */
export function score(min = 0.6, max = 0.99, dp = 3): number {
  return round(min + Math.random() * (max - min), dp);
}

/* ── id generators ───────────────────────────────────────────────────────── */

function rand(len: number): string {
  let s = '';
  while (s.length < len) s += Math.random().toString(36).slice(2);
  return s.slice(0, len);
}

export const orderId = (): string => `ord_${rand(12)}`;
export const txnId = (): string => `txn_${rand(14)}`;
export const reservationId = (): string => `rsv_${rand(10)}`;
export const newUserId = (): string => `usr_${rand(8)}`;
export const authToken = (): string => `tok_${rand(28)}`;

/* ── fake users ──────────────────────────────────────────────────────────── */

export interface FakeUser {
  id: string;
  email: string;
  name: string;
  role: 'customer' | 'admin';
}

export const USERS: readonly FakeUser[] = [
  { id: 'usr_ava01', email: 'ava.chen@example.com', name: 'Ava Chen', role: 'customer' },
  { id: 'usr_leo02', email: 'leo.park@example.com', name: 'Leo Park', role: 'customer' },
  { id: 'usr_mia03', email: 'mia.rossi@example.com', name: 'Mia Rossi', role: 'customer' },
  { id: 'usr_kai04', email: 'kai.nakamura@example.com', name: 'Kai Nakamura', role: 'admin' },
  { id: 'usr_zoe05', email: 'zoe.abara@example.com', name: 'Zoe Abara', role: 'customer' },
  { id: 'usr_sam06', email: 'sam.oconnor@example.com', name: 'Sam O’Connor', role: 'customer' },
];

/* ── fake product catalog (~12 items) ────────────────────────────────────── */

export interface Product {
  sku: string;
  name: string;
  price: number; // in whole currency units (USD)
  category: string;
}

export const CATALOG: readonly Product[] = [
  { sku: 'SKU-1001', name: 'Aurora Wireless Headphones', price: 129.99, category: 'electronics' },
  { sku: 'SKU-1002', name: 'Nimbus Mechanical Keyboard', price: 89.0, category: 'electronics' },
  { sku: 'SKU-1003', name: 'Volt 65W USB-C Charger', price: 34.5, category: 'electronics' },
  { sku: 'SKU-2001', name: 'Cedar Pour-Over Coffee Set', price: 42.0, category: 'home' },
  { sku: 'SKU-2002', name: 'Linen Throw Blanket', price: 58.75, category: 'home' },
  { sku: 'SKU-2003', name: 'Terra Ceramic Planter', price: 24.0, category: 'home' },
  { sku: 'SKU-3001', name: 'Summit Merino Beanie', price: 28.0, category: 'apparel' },
  { sku: 'SKU-3002', name: 'Drift Everyday Sneakers', price: 96.0, category: 'apparel' },
  { sku: 'SKU-4001', name: 'The Pragmatic Roadmap (Paperback)', price: 21.99, category: 'books' },
  { sku: 'SKU-4002', name: 'Deep Work Journal', price: 16.5, category: 'books' },
  { sku: 'SKU-5001', name: 'Orchard Cold-Brew Concentrate', price: 12.0, category: 'grocery' },
  { sku: 'SKU-5002', name: 'Wildflower Raw Honey 500g', price: 14.25, category: 'grocery' },
];

/** Distinct category names, in first-seen order. */
export const CATEGORIES: readonly string[] = Array.from(
  new Set(CATALOG.map((p) => p.category)),
);

/** Look up a product by SKU (case-insensitive), or `undefined`. */
export function findProduct(sku: string): Product | undefined {
  const want = sku.trim().toLowerCase();
  return CATALOG.find((p) => p.sku.toLowerCase() === want);
}

/* ── async route wrapper ─────────────────────────────────────────────────── */

/**
 * Wrap an async handler so a rejected promise / thrown async error is forwarded
 * to `next(err)` — which routes it into the per-service telemetry error handler
 * (and then the normalized 500 responder) instead of crashing the process.
 */
export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
