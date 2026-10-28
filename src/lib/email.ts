import { config } from "@/src/config";
import { PRODUCT_NAME } from "@/src/lib/brand";
import { getFirebaseAdminAuth } from "@/src/firebase/admin";
import { getWebetuEmailNotificationForUid } from "@/src/domains/webetu";
import {
  backendProbeReasonLabel,
  escapeHtmlAttribute,
  formatDurationShort,
} from "@/src/lib/utils";
import type { DashboardRunResult } from "@/src/domains/dashboard";

// Resend REST API — no npm dependency, plain fetch.
const RESEND_API_URL = "https://api.resend.com/emails";

type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
};

/**
 * Returns whether Resend accepted the message. Callers that treat email as fire-and-forget
 * can keep ignoring the result; the downtime alert uses it to decide whether to retry,
 * because it marks itself sent before it gets here and would otherwise go silent on a
 * rejection.
 */
async function sendEmail({ to, subject, html }: SendEmailParams): Promise<boolean> {
  const apiKey = config.resendApiKey || process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log("[email] RESEND_API_KEY is not set — skipping email send.");
    return false;
  }

  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: config.emailFrom, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[email] Resend API error ${res.status}: ${body}`);
    // Do not throw — email is best-effort.
    return false;
  }
  return true;
}

// Seam: swap in an SMTP implementation by replacing sendEmail above.

type ReservationResultEmailParams = {
  userId: string;
  lastRunStatus: string | null;
  lastRunSummary: string | null;
  results?: DashboardRunResult[];
};

const statusLabels: Record<string, string> = {
  success: "Succeeded",
  partial: "Partially succeeded",
  failed: "Failed",
  skipped: "Skipped",
  action_required: "Action required",
};

// Per-date statuses the worker reports. "ok" statuses mean the meals are booked
// for that day (already_booked counts as a success — no action needed).
const perDateLabels: Record<string, string> = {
  success: "Reserved",
  already_booked: "Already booked",
  dry_run: "Dry run",
  partial: "Partially reserved",
  failed: "Not completed",
  error: "Not completed",
  unknown: "Not completed",
};
const perDateOkStatuses = new Set(["success", "already_booked", "dry_run"]);

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildResultsHtml(results: DashboardRunResult[]) {
  const rows = results
    .map((r) => {
      const ok = perDateOkStatuses.has(r.status);
      const mark = ok ? "✓" : "✗";
      const color = ok ? "#047857" : "#b91c1c";
      const label = perDateLabels[r.status] ?? r.status ?? "Unknown";
      // Only show a meal count for booked days — "0/3" on a failure is misleading.
      const meals = ok && r.mealsTotal > 0 ? ` (${r.mealsBooked}/${r.mealsTotal} meals)` : "";
      const restaurant = r.restaurant ? ` · ${escapeHtml(r.restaurant)}` : "";
      return `<li style="margin:4px 0;color:#374151;"><span style="color:${color};font-weight:600;">${mark} ${escapeHtml(
        r.date,
      )}</span> — ${escapeHtml(label)}${meals}${restaurant}</li>`;
    })
    .join("");
  return `
    <p style="margin:16px 0 4px;color:#111827;font-weight:600;">Reservation results:</p>
    <ul style="margin:0;padding-left:18px;font-size:14px;list-style:none;">${rows}</ul>`;
}

export function buildResultHtml(
  lastRunStatus: string | null,
  lastRunSummary: string | null,
  results?: DashboardRunResult[],
) {
  const label = (lastRunStatus && statusLabels[lastRunStatus]) ?? lastRunStatus ?? "Unknown";
  const siteUrl = config.publicBaseUrl;
  const invitation = `Get your meals reserved automatically with ${PRODUCT_NAME}! Sign up here: ${siteUrl}`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(invitation)}`;
  // Prefer the structured per-date breakdown; fall back to the plain summary
  // line only when no per-date results were sent — never fabricate detail.
  const detail =
    results && results.length > 0
      ? buildResultsHtml(results)
      : lastRunSummary
        ? `<p style="margin:12px 0;color:#374151;">${escapeHtml(lastRunSummary)}</p>`
        : "";
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Meal Reservation Result</title></head>
<body style="font-family:sans-serif;background:#f9fafb;padding:32px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;border:1px solid #e5e7eb;">
    <h2 style="margin:0 0 8px;color:#111827;">Meal Reservation Update</h2>
    <p style="margin:0 0 16px;color:#6b7280;font-size:14px;">Your latest reservation run has completed.</p>
    <p style="margin:0 0 8px;"><strong>Status:</strong> ${label}</p>
    ${detail}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
    <p style="margin:0 0 16px;font-size:14px;color:#374151;">Don’t forget to share ${escapeHtml(PRODUCT_NAME)} with your friends so they can get their meals reserved automatically too!</p>
    <a href="${escapeHtmlAttribute(whatsappUrl)}" style="display:inline-block;background:#15803d;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">Share on WhatsApp</a>
    <p style="margin:12px 0 20px;font-size:14px;color:#374151;">Or share the site: <a href="${escapeHtmlAttribute(siteUrl)}" style="color:#1d4ed8;">${escapeHtml(siteUrl)}</a></p>
    <p style="font-size:12px;color:#9ca3af;">This is an automated notification from ${PRODUCT_NAME}.</p>
  </div>
</body>
</html>`.trim();
}

export async function sendReservationResultEmail({
  userId,
  lastRunStatus,
  lastRunSummary,
  results,
}: ReservationResultEmailParams): Promise<void> {
  try {
    const apiKey = config.resendApiKey || process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.log("[email] RESEND_API_KEY is not set — skipping reservation result email.");
      return;
    }

    const { enabled } = await getWebetuEmailNotificationForUid(userId);
    if (!enabled) {
      console.log(`[email] User ${userId} disabled email notifications — skipping.`);
      return;
    }

    const userRecord = await getFirebaseAdminAuth().getUser(userId);
    if (userRecord.disabled) return;
    const email = userRecord.email;
    if (!email) {
      console.log(`[email] User ${userId} has no email address — skipping.`);
      return;
    }

    const subject =
      lastRunStatus === "success"
        ? "Your meal reservation succeeded"
        : lastRunStatus === "failed"
          ? "Your meal reservation failed"
          : "Meal reservation update";

    await sendEmail({ to: email, subject, html: buildResultHtml(lastRunStatus, lastRunSummary, results) });
  } catch (err) {
    // Best-effort — never propagate.
    console.error("[email] sendReservationResultEmail error:", err);
  }
}

/**
 * Backend-downtime alert, addressed to whoever runs the deployment rather than to a user.
 *
 * That changes what belongs in the body: some upstream detail is exactly what makes the
 * message actionable. What still stays out is anything secret (API keys, service-account
 * JSON, Authorization values -- email sits in cleartext in an inbox), any raw exception
 * text (which is why `reason` arrives as a coarse code), and anything identifying the
 * visitor whose page load happened to notice. The visit is incidental to the fact being
 * reported; naming a person would be a privacy cost with no diagnostic value.
 */
export type BackendAlertEmailContext = {
  detectedAtMs: number;
  outageStartedAtMs: number | null;
  failureCount: number;
  reason: string;
};

export function backendAlertSubject(): string {
  return `${PRODUCT_NAME}: backend worker unreachable`;
}

export function buildBackendAlertHtml(ctx: BackendAlertEmailContext): string {
  const detectedAt = new Date(ctx.detectedAtMs).toISOString();
  const startedAt =
    ctx.outageStartedAtMs !== null ? new Date(ctx.outageStartedAtMs).toISOString() : null;
  const downFor =
    ctx.outageStartedAtMs !== null
      ? formatDurationShort(ctx.detectedAtMs - ctx.outageStartedAtMs)
      : null;
  const probeTarget = config.webetuApiBaseUrl ? `${config.webetuApiBaseUrl}/healthz` : "(not configured)";

  const row = (label: string, value: string) =>
    `<li style="margin:6px 0;color:#374151;"><strong style="color:#111827;">${escapeHtml(
      label,
    )}:</strong> ${escapeHtml(value)}</li>`;

  const rows = [
    // Worded as "from this app" on purpose: Vercel losing egress to the worker looks
    // identical to the worker being down, and this email should not assert which.
    row("Status", "Unreachable from the web app"),
    ...(startedAt ? [row("First failure seen (UTC)", startedAt)] : []),
    row("Latest failure (UTC)", detectedAt),
    // Not "down for": these are samples taken when visitors happened to load the app, so
    // the span between the first and latest failure is not an observed continuous outage.
    ...(downFor ? [row("Failures seen across", downFor)] : []),
    row("Failed probes seen", String(ctx.failureCount)),
    row("Last probe result", backendProbeReasonLabel(ctx.reason)),
    row("Probe target", probeTarget),
  ].join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Backend Unreachable</title></head>
<body style="font-family:sans-serif;background:#f9fafb;padding:32px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;border:1px solid #e5e7eb;">
    <h2 style="margin:0 0 8px;color:#b91c1c;">Backend worker unreachable</h2>
    <p style="margin:0 0 16px;color:#6b7280;font-size:14px;">
      A visitor loaded ${escapeHtml(PRODUCT_NAME)} and the reservation backend did not answer its health check.
    </p>
    <ul style="margin:0;padding-left:0;font-size:14px;list-style:none;">${rows}</ul>
    <p style="margin:16px 0 4px;color:#111827;font-weight:600;">What to check</p>
    <ul style="margin:0;padding-left:18px;font-size:14px;color:#374151;">
      <li style="margin:4px 0;">Is the worker process running?</li>
      <li style="margin:4px 0;">Is the tunnel or host in front of it up?</li>
      <li style="margin:4px 0;">Is WEBETU_API_BASE_URL still correct?</li>
    </ul>
    <p style="margin:16px 0 0;font-size:14px;color:#374151;">
      <a href="${escapeHtmlAttribute(config.publicBaseUrl)}" style="color:#1d4ed8;">Open the app</a>
      &middot;
      <a href="${escapeHtmlAttribute(`${config.publicBaseUrl}/health`)}" style="color:#1d4ed8;">Check /health</a>
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
    <p style="font-size:12px;color:#9ca3af;">
      The backend is only checked when someone loads the app, not continuously, so these are
      samples rather than monitoring — it may have recovered and failed again between them.
    </p>
    <p style="font-size:12px;color:#9ca3af;">
      No further email will be sent for this outage — silence does not mean it recovered.
      Re-check the app to confirm.
    </p>
    <p style="font-size:12px;color:#9ca3af;">This is an automated notification from ${escapeHtml(PRODUCT_NAME)}.</p>
  </div>
</body>
</html>`.trim();
}

/** Returns whether the alert was actually delivered, so a failure can be retried. */
export async function sendBackendAlertEmail(ctx: BackendAlertEmailContext): Promise<boolean> {
  try {
    const apiKey = config.resendApiKey || process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.log("[email] RESEND_API_KEY is not set — skipping backend alert email.");
      return false;
    }
    if (!config.alertEmailTo) {
      console.log("[email] ALERT_EMAIL_TO is not set — skipping backend alert email.");
      return false;
    }

    return await sendEmail({
      to: config.alertEmailTo,
      subject: backendAlertSubject(),
      html: buildBackendAlertHtml(ctx),
    });
  } catch (err) {
    // Best-effort — never propagate.
    console.error("[email] sendBackendAlertEmail error:", err);
    return false;
  }
}
