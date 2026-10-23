import { beforeAll, describe, expect, it } from "vitest";
import { config } from "@/src/config";
import { signState, verifySigninState, SIGNIN_STATE_MAX_AGE_MS } from "@/src/security/crypto";

// /auth/google/finish/token only completes a Google sign-in when the state was issued
// by us for this browser. Without this, a link carrying an attacker's own code would
// sign the victim into the attacker's account (login CSRF).
describe("verifySigninState", () => {
  const now = 1_700_000_000_000;
  const nonce = "n0nce-abcdefghijkl";

  beforeAll(() => {
    config.oauthStateSecret = "test-oauth-state-secret";
  });

  function state(overrides: Record<string, unknown> = {}) {
    return signState({ flow: "signin", nonce, next: "/", ts: now - 1000, ...overrides });
  }

  function statusOf(fn: () => unknown) {
    try {
      fn();
    } catch (err) {
      return (err as { status?: number }).status;
    }
    return "no error";
  }

  it("accepts a fresh signed state whose nonce matches the cookie", () => {
    expect(verifySigninState(state(), nonce, now)).toMatchObject({ flow: "signin", nonce });
  });

  it("rejects a missing state", () => {
    expect(statusOf(() => verifySigninState(undefined, nonce, now))).toBe(400);
    expect(statusOf(() => verifySigninState("", nonce, now))).toBe(400);
  });

  it("rejects a tampered or forged state", () => {
    const [body, sig] = state().split(".");
    const forged = Buffer.from(
      JSON.stringify({ flow: "signin", nonce: "attacker", ts: now }),
      "utf8",
    ).toString("base64url");
    expect(statusOf(() => verifySigninState(`${forged}.${sig}`, "attacker", now))).toBe(400);
    expect(statusOf(() => verifySigninState(`${body}.AAAA`, nonce, now))).toBe(400);
  });

  it("tolerates small clock skew", () => {
    expect(verifySigninState(state({ ts: now + 30_000 }), nonce, now)).toBeTruthy();
  });

  it("rejects a state from a different flow", () => {
    expect(statusOf(() => verifySigninState(state({ flow: undefined }), nonce, now))).toBe(400);
  });

  it("rejects an expired or future state", () => {
    const expired = state({ ts: now - SIGNIN_STATE_MAX_AGE_MS - 1 });
    expect(statusOf(() => verifySigninState(expired, nonce, now))).toBe(400);
    expect(statusOf(() => verifySigninState(state({ ts: now + 120_000 }), nonce, now))).toBe(400);
  });

  it("rejects when the browser has no nonce cookie or a different one", () => {
    expect(statusOf(() => verifySigninState(state(), undefined, now))).toBe(400);
    expect(statusOf(() => verifySigninState(state(), "", now))).toBe(400);
    expect(statusOf(() => verifySigninState(state(), "n0nce-zzzzzzzzzzzz", now))).toBe(400);
  });

  it("rejects a state without a nonce even if the cookie is empty", () => {
    expect(statusOf(() => verifySigninState(state({ nonce: "" }), "", now))).toBe(400);
  });
});
