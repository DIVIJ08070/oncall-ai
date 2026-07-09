import { z } from 'zod';

/**
 * Incident domain (SPEC §7.3 API, §8 `incidents`, §10 detection lifecycle).
 */

/** Which detector opened the incident (SPEC §8 / §10.3). */
export const DetectorSchema = z.enum(['error_rate', 'latency', 'silence']);
export type Detector = z.infer<typeof DetectorSchema>;

/** Incident lifecycle states (SPEC §8 / §10.4 state machine). */
export const IncidentStatusSchema = z.enum([
  'open',
  'investigating',
  'fix_proposed',
  'escalated',
  'awaiting_merge',
  'verifying',
  'resolved',
  'closed',
]);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

/** Incident severity (SPEC §8). */
export const SeveritySchema = z.enum(['high', 'medium', 'low']);
export type Severity = z.infer<typeof SeveritySchema>;

/**
 * Dedup key: `sha1(service + "|" + detector + "|" + dominant_sig)` (SPEC §10.2).
 * A plain string at the type level; the constant documents its provenance.
 */
export const FingerprintSchema = z.string();
export type Fingerprint = z.infer<typeof FingerprintSchema>;

/** Full incident record (SPEC §8 `incidents`, §7.3 detail `incident`). */
export const IncidentSchema = z.object({
  id: z.string(),
  customer_id: z.string(),
  service: z.string(),
  detector: DetectorSchema,
  fingerprint: FingerprintSchema,
  title: z.string(),
  status: IncidentStatusSchema,
  severity: SeveritySchema,
  threshold_value: z.number(),
  observed_value: z.number(),
  first_error_at: z.number().int().nullable(),
  detected_at: z.number().int(),
  opened_at: z.number().int(),
  root_cause: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  pr_id: z.string().nullable(),
  suspect_deploy_sha: z.string().nullable(),
  resolved_at: z.number().int().nullable(),
  postmortem: z.string().nullable(),
  updated_at: z.number().int(),
});
export type Incident = z.infer<typeof IncidentSchema>;

/** Lightweight incident for list views (SPEC §7.3 `GET /incidents`). */
export const IncidentSummarySchema = z.object({
  id: z.string(),
  service: z.string(),
  detector: DetectorSchema,
  title: z.string(),
  status: IncidentStatusSchema,
  severity: SeveritySchema,
  observed_value: z.number(),
  threshold_value: z.number(),
  confidence: z.number().min(0).max(1).nullable(),
  opened_at: z.number().int(),
  resolved_at: z.number().int().nullable(),
  active: z.boolean().optional(),
});
export type IncidentSummary = z.infer<typeof IncidentSummarySchema>;

/** Lifecycle-timeline entry kinds (SPEC §7.3 `timeline[].kind`). */
export const TimelineKindSchema = z.enum([
  'detected',
  'investigating',
  'pr_opened',
  'merged',
  'verifying',
  'resolved',
  'escalated',
]);
export type TimelineKind = z.infer<typeof TimelineKindSchema>;

/** One timeline row (SPEC §7.3 `timeline[]`). */
export const TimelineEntrySchema = z.object({
  ts: z.number().int(),
  kind: TimelineKindSchema,
  label: z.string(),
});
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;
