import { NextRequest, NextResponse } from "next/server";
import { config } from "@/src/config";
import { verifyFirebaseRequest } from "@/src/security/session";
import {
  consumeWebetuVerifyAttempt,
  refundWebetuVerifyAttempt,
  resetWebetuVerifyAttempts,
  saveWebetuCredentials,
} from "@/src/domains/webetu";
import {
  classifyVerifyResponse,
  httpError,
  normalizeWebetuCredentials,
} from "@/src/lib/utils";

export const runtime = "nodejs";
// Saving now includes a Webetu login round-trip through the worker, so the request
// outlives the platform's short default window.
export const maxDuration = 60;

// Must stay above the worker's own Webetu timeout (request_timeout_seconds, 30s): if we
// gave up first, a slow-but-successful login would be reported to the user as "couldn't
// verify" and their correct credentials would be refused.
const VERIFY_TIMEOUT_MS = 35_000;

// Verify a username/password against the real Webetu service via the backend worker
// before we store anything. Returns a shape classifyVerifyResponse understands:
//   { skip: true }              when no worker is configured (local/preview) -> save as-is
//   { ok: true, valid: bool }   the worker's verdict
//   { ok: false }               the worker was unreachable/errored -> treated as unavailable
// `valid` is passed through EXACTLY as the worker sent it (hence unknown, not boolean):
// coercing a missing/non-boolean verdict to false would report "No such user is found."
// for an account that is actually fine. classifyVerifyResponse maps anything that is not
// a real boolean to "unavailable".
// Never leaks the internal key or backend URL to the client, and never logs the creds.
// Whether a real verification can happen at all. When it can't (no worker configured,
// e.g. local/preview) we neither call Webetu nor spend the user's throttle budget.
function verificationConfigured() {
  return Boolean(config.webetuApiBaseUrl && config.internalApiKey);
}

async function verifyWithWorker(
  uid: string,
  creds: { username: string; password: string }
): Promise<{ skip?: boolean; ok?: boolean; valid?: unknown }> {
  if (!verificationConfigured()) return { skip: true };
  try {
    const res = await fetch(
      `${config.webetuApiBaseUrl}/api/webetu/users/${encodeURIComponent(uid)}/verify-credentials`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.internalApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ username: creds.username, password: creds.password }),
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      }
    );
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.ok === false) return { ok: false };
    return { ok: true, valid: body.valid };
  } catch {
    return { ok: false };
  }
}

export async function POST(req: NextRequest) {
  try {
    const decoded = await verifyFirebaseRequest(req);
    const body = await req.json().catch(() => ({}));
    // Format-validate first (cheap, no worker round-trip) so the 400s are unchanged.
    const creds = normalizeWebetuCredentials(body);

    // Spend a verify attempt before making our backend log in on the caller's behalf,
    // so this endpoint can't be used to brute-force Webetu accounts through us. Only
    // when a real verification will follow; throws 429 once the budget is spent.
    const willVerify = verificationConfigured();
    if (willVerify) await consumeWebetuVerifyAttempt(decoded.uid);

    // Then verify the credentials actually work against Webetu before saving, so a
    // user cannot store a non-existent account or wrong password. Runs on every
    // insert and update (this route backs both onboarding and settings).
    const verdict = classifyVerifyResponse(await verifyWithWorker(decoded.uid, creds));
    if (verdict === "invalid") {
      throw httpError(422, "No such user is found.");
    }
    if (verdict === "unavailable") {
      // No verdict came back, so don't charge the user for our outage.
      if (willVerify) await refundWebetuVerifyAttempt(decoded.uid).catch(() => {});
      throw httpError(
        503,
        "Couldn't verify your Webetu credentials right now. Please try again."
      );
    }
    // "valid" or "skip" -> proceed to save.

    const result = await saveWebetuCredentials(decoded.uid, body);
    // Credentials are confirmed good, so clear the budget: a user who mistyped a few
    // times before getting it right should not stay throttled. Best-effort -- the save
    // already succeeded and must not fail on a bookkeeping error.
    if (willVerify && verdict === "valid") {
      await resetWebetuVerifyAttempts(decoded.uid).catch(() => {});
    }
    return NextResponse.json(result);
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status }
    );
  }
}
