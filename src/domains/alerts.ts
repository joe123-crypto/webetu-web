import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/src/firebase/admin";
import { config } from "@/src/config";
import { sendBackendAlertEmail } from "@/src/lib/email";
import {
  backendAlertDecision,
  BACKEND_ALERT_MAX_SEND_ATTEMPTS,
  type BackendAlertDecision,
} from "@/src/lib/utils";

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
          // `reachable` is what decides whether this failure continues the stored outage
          // or starts a new one, so it must be read back, not just written.
          reachable: data.reachable,
          consecutiveFailures: data.consecutiveFailures,
          firstFailureAtMs: data.firstFailureAtMs,
          alerted: data.alerted,
          sendAttempts: data.sendAttempts,
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
          sendAttempts: decision.next.sendAttempts,
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
    // of a Resend round-trip.
    if (!decision || !(decision as BackendAlertDecision).shouldAlert) return;
    const { failureCount, outageStartedAtMs, next } = decision as BackendAlertDecision;
    console.log(
      `[alert] backend unreachable (${failureCount} failed probes seen) — emailing the owner.`,
    );
    const delivered = await sendBackendAlertEmail({
      detectedAtMs: now,
      outageStartedAtMs,
      failureCount,
      reason: input.reason,
    });

    // The "sent" marker is committed before the send, so a rejection would otherwise mark
    // this outage alerted and never mail at all. Giving the marker back lets the next probe
    // retry. Attempts are capped in the decision helper, so a permanently broken sender
    // cannot keep retrying for the length of the outage.
    if (!delivered) {
      console.error(
        `[alert] alert email was not delivered (attempt ${next.sendAttempts} of ` +
          `${BACKEND_ALERT_MAX_SEND_ATTEMPTS}) — clearing the sent marker so the next probe retries.`,
      );
      await releaseAlertedMarker(ref, outageStartedAtMs);
    }
  } catch (err) {
    // Best-effort — never propagate.
    console.error("[alert] recordBackendProbe error:", err);
  }
}

/**
 * Undo the `alerted` marker after a failed send, so the next failed probe tries again.
 *
 * Narrowly guarded, because this runs after the main transaction committed and the world
 * may have moved on: it only clears the marker if the record still describes the *same*
 * outage (same first-failure stamp) and the backend is still unreachable. Without that, a
 * recovery that landed in between would be overwritten and a finished outage resurrected.
 *
 * The attempt counter is deliberately left alone -- it is what bounds the retries.
 */
async function releaseAlertedMarker(
  ref: DocumentReference,
  outageStartedAtMs: number | null,
): Promise<void> {
  if (outageStartedAtMs === null) return;
  const db = getFirestoreDb();
  await db.runTransaction(async (t) => {
    const doc = await t.get(ref);
    const data = doc.data();
    if (!data) return;
    if (data.reachable !== false) return;
    if (data.firstFailureAtMs !== outageStartedAtMs) return;
    if (data.alerted !== true) return;
    t.set(ref, { alerted: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
