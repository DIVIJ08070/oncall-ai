import { z } from 'zod';

/**
 * Metrics + service-health domain (SPEC §7.2 `/metrics` & `/services`, §8 `metric_samples`, §10.2).
 */

/** One rollup row written each detection tick (SPEC §8 `metric_samples`). */
export const MetricSampleSchema = z.object({
  id: z.number().int().optional(),
  customer_id: z.string(),
  service: z.string(),
  bucket_ts: z.number().int(),
  window_sec: z.number().int(),
  request_count: z.number().int(),
  error_count: z.number().int(),
  error_rate: z.number(),
  p50_ms: z.number().int(),
  p95_ms: z.number().int(),
  p99_ms: z.number().int(),
});
export type MetricSample = z.infer<typeof MetricSampleSchema>;

/** Current-window aggregate (SPEC §7.2 `current`). */
export const MetricsCurrentSchema = z.object({
  error_rate: z.number(),
  req_count: z.number().int(),
  p50_ms: z.number().int(),
  p95_ms: z.number().int(),
  p99_ms: z.number().int(),
});
export type MetricsCurrent = z.infer<typeof MetricsCurrentSchema>;

/** Trailing baseline (SPEC §7.2 `baseline`, §10.2). */
export const MetricsBaselineSchema = z.object({
  error_rate: z.number(),
  p95_ms: z.number().int(),
});
export type MetricsBaseline = z.infer<typeof MetricsBaselineSchema>;

/** One point on a metrics time series (SPEC §7.2 `series[]`, capped to 240 points). */
export const MetricsSeriesPointSchema = z.object({
  ts: z.number().int(),
  error_rate: z.number(),
  req_count: z.number().int(),
  p50_ms: z.number().int(),
  p95_ms: z.number().int(),
  p99_ms: z.number().int(),
});
export type MetricsSeriesPoint = z.infer<typeof MetricsSeriesPointSchema>;

/** Response body of `GET /api/v1/metrics` (SPEC §7.2). */
export const MetricsSnapshotSchema = z.object({
  service: z.string(),
  window_sec: z.number().int(),
  resolution_sec: z.number().int(),
  current: MetricsCurrentSchema,
  baseline: MetricsBaselineSchema,
  series: z.array(MetricsSeriesPointSchema).max(240),
});
export type MetricsSnapshot = z.infer<typeof MetricsSnapshotSchema>;

/** Per-service health status (SPEC §7.2 `/services`). */
export const HealthStatusSchema = z.enum(['healthy', 'degraded', 'down', 'silent']);
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

/** One entry of `GET /api/v1/services` (SPEC §7.2). */
export const ServiceHealthSchema = z.object({
  name: z.string(),
  health: HealthStatusSchema,
  error_rate: z.number(),
  p95_ms: z.number().int(),
  req_per_min: z.number(),
  last_event_at: z.number().int().nullable(),
  active_incident_id: z.string().nullable(),
});
export type ServiceHealth = z.infer<typeof ServiceHealthSchema>;
