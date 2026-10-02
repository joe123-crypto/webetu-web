import { config } from "@/src/config";
import { getFirebaseAdminAuth } from "@/src/firebase/admin";
import { getWebetuEmailNotificationForUid } from "@/src/domains/webetu";
import type { DashboardRunResult } from "@/src/domains/dashboard";

// Resend REST API — no npm dependency, plain fetch.
const RESEND_API_URL = "https://api.resend.com/emails";

type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
};

async function sendEmail({ to, subject, html }: SendEmailParams): Promise<void> {
  const apiKey = config.resendApiKey || process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log("[email] RESEND_API_KEY is not set — skipping email send.");
    return;
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
  }
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
    <p style="font-size:12px;color:#9ca3af;">This is an automated notification from Webetu.</p>
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
