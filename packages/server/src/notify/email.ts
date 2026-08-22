/**
 * Real email delivery (nodemailer) for OnCall AI alerts.
 *
 * Sends to the inbox configured in `.env` (`SMTP_*` + `ALERT_EMAIL_TO`). When
 * SMTP is not configured the sender is a no-op that returns `simulated: true`,
 * so every call site works with or without credentials — the dashboard
 * timeline still records the alert either way.
 *
 * Fail-soft: a delivery error is logged and swallowed; alerting must never
 * throw into the incident/escalation path.
 */

import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../config.js';

export interface EmailResult {
  ok: boolean;
  simulated: boolean;
  to?: string;
  error?: string;
}

let transporter: Transporter | null = null;
let initFor: string | null = null;

function getTransport(config: Config): Transporter | null {
  const smtp = config.notify.smtp;
  if (!smtp) return null;
  const key = `${smtp.host}:${smtp.port}:${smtp.user}`;
  if (transporter && initFor === key) return transporter;
  transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465, // 465 = implicit TLS; 587 = STARTTLS
    auth: { user: smtp.user, pass: smtp.pass },
  });
  initFor = key;
  return transporter;
}

/**
 * Send one alert email. Returns `{ simulated: true }` when SMTP isn't
 * configured (so the caller still records a timeline entry). Never throws.
 */
export async function sendAlertEmail(
  config: Config,
  subject: string,
  text: string,
  html?: string,
): Promise<EmailResult> {
  const smtp = config.notify.smtp;
  const tx = getTransport(config);
  if (!smtp || !tx) return { ok: false, simulated: true };
  try {
    await tx.sendMail({
      from: smtp.from,
      to: smtp.to,
      subject,
      text,
      html: html ?? `<pre style="font:14px/1.5 ui-monospace,monospace">${text}</pre>`,
    });
    return { ok: true, simulated: false, to: smtp.to };
  } catch (err) {
    return {
      ok: false,
      simulated: false,
      to: smtp.to,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** True when real email delivery is configured (for logging / UI hints). */
export function emailConfigured(config: Config): boolean {
  return config.notify.smtp != null;
}
