import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/src/firebase/admin";
import { config } from "@/src/config";
import { sendBackendAlertEmail } from "@/src/lib/email";
import { backendAlertDecision, type BackendAlertDecision } from "@/src/lib/utils";

// One global doc -- this is about the shared backend worker, not about any user. Same
// "named collection + known doc id" shape as webetuCatalogMeta/status.
const ALERT_COLLECTION = "systemAlerts";
const ALERT_DOC_ID = "backendReachability";

/**
 * Record one reachability probe and, when it is the moment to do so, email the owner.
 *
 * Cross-instance state is the whole point of this function. The probe cache in
 * app/health/route.ts is module-level, so each serverless instance has its own and none of
 * them can answer "has an alert already gone out for this outage?". Firestore can, and the
 * transaction is what makes "one email" true when several instances observe the same
 * failed probe at once: the decision to email and the `alerted: true` marker recording it
 * commit together, so a losing transaction is retried with a fresh read, sees the marker,
 * and sends nothing.
 *
 * Nothing escapes this function. It runs after the response has been sent, on behalf of a
 * route whose job is to answer a status badge, so a Firestore outage here must not become
 * an unhandled rejection.
 */
export async function recordBackendProbe(input: {
  reachable: boolean;
  reason: string;
  at: number;
}): Promise<void> {
  try {
    // Guards before any Firestore access, so a deployment with alerting switched off does
    // zero reads and zero writes.
    if (!config.alertEmailTo) {
      console.log("[alert] ALERT_EMAIL_TO is not set — skipping backend reachability alerting.");
      return;
    }
    // Checked here and not only at send time: without it we would commit `alerted: true`
    // for an email that could never be delivered, muting the outage entirely.
    if (!(config.resendApiKey || process.env.RESEND_API_KEY)) {
      console.log("[alert] RESEND_API_KEY is not set — skipping backend reachability alerting.");
      return;
    }
    // A missing base URL is a misconfiguration, not an outage. Without this a preview
    // deployment would report a permanent outage on every visit.
    if (!input.reachable && input.reason === "not_configured") {
      console.log("[alert] WEBETU_API_BASE_URL is not set — misconfiguration, not an outage.");
      return;
    }

    const db = getFirestoreDb();
    const ref = db.collection(ALERT_COLLECTION).doc(ALERT_DOC_ID);
    const now = Number.isFinite(input.at) ? input.at : Date.now();
    let decision: BackendAlertDecision | null = null;

    await db.runTransaction(async (t) => {
      const doc = await t.get(ref);
      const data = doc.data() || {};
      decision = backendAlertDecision({
        now,
        reachable: input.reachable,
        stored: {
          consecutiveFailures: data.consecutiveFailures,
          firstFailureAtMs: data.firstFailureAtMs,
          alerted: data.alerted,
          updatedAtMs: data.updatedAtMs,
        },
      });
      t.set(
        ref,
        {
          reachable: input.reachable,
          reason: input.reason,
          consecutiveFailures: decision.next.consecutiveFailures,
          firstFailureAtMs: decision.next.firstFailureAtMs,
          alerted: decision.next.alerted,
          // Plain millis drive every comparison in backendAlertDecision, because
          // serverTimestamp() cannot be read back inside the transaction that writes it --
          // the decision would end up comparing the server's clock against this instance's
          // for a 20-second threshold. updatedAt is kept alongside purely so the document
          // reads well in the Firebase console.
          updatedAtMs: now,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });

    // Sent after the commit, never inside the callback: a transaction can re-run, which
    // would double-send, and an outbound HTTP call would hold the read lock for the length
    // of a Resend round-trip. The cost of this ordering is that delivery is at-most-once --
    // a Resend failure loses this alert until the staleness window resets the record.
    if (!decision || !(decision as BackendAlertDecision).shouldAlert) return;
    const { failureCount, outageStartedAtMs } = decision as BackendAlertDecision;
    console.log(
      `[alert] backend unreachable (${failureCount} consecutive failures) — emailing the owner.`,
    );
    await sendBackendAlertEmail({
      detectedAtMs: now,
      outageStartedAtMs,
      failureCount,
      reason: input.reason,
    });
  } catch (err) {
    // Best-effort — never propagate.
    console.error("[alert] recordBackendProbe error:", err);
  }
}
