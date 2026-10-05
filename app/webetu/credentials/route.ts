import { NextRequest, NextResponse } from "next/server";
import { config } from "@/src/config";
import { verifyFirebaseRequest } from "@/src/security/session";
import { saveWebetuCredentials } from "@/src/domains/webetu";
import {
  classifyVerifyResponse,
  httpError,
  normalizeWebetuCredentials,
} from "@/src/lib/utils";

export const runtime = "nodejs";

const VERIFY_TIMEOUT_MS = 15_000;

// Verify a username/password against the real Webetu service via the backend worker
// before we store anything. Returns a shape classifyVerifyResponse understands:
//   { skip: true }              when no worker is configured (local/preview) -> save as-is
//   { ok: true, valid: bool }   the worker's verdict
//   { ok: false }               the worker was unreachable/errored -> treated as unavailable
// Never leaks the internal key or backend URL to the client, and never logs the creds.
async function verifyWithWorker(
  uid: string,
  creds: { username: string; password: string }
): Promise<{ skip?: boolean; ok?: boolean; valid?: boolean }> {
  if (!config.webetuApiBaseUrl || !config.internalApiKey) return { skip: true };
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
    return { ok: true, valid: body.valid === true };
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

    // Then verify the credentials actually work against Webetu before saving, so a
    // user cannot store a non-existent account or wrong password. Runs on every
    // insert and update (this route backs both onboarding and settings).
    const verdict = classifyVerifyResponse(await verifyWithWorker(decoded.uid, creds));
    if (verdict === "invalid") {
      throw httpError(422, "No such user is found.");
    }
    if (verdict === "unavailable") {
      throw httpError(
        503,
        "Couldn't verify your Webetu credentials right now. Please try again."
      );
    }
    // "valid" or "skip" -> proceed to save.

    const result = await saveWebetuCredentials(decoded.uid, body);
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
