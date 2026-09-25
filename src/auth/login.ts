export const AUTH_NEXT_STORAGE_KEY = "webetuNextAfterSignIn";
export const AUTH_REDIRECT_PENDING_STORAGE_KEY = "webetuGoogleRedirectPending";

type AuthStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function normalizeAuthHost(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase().replace(/\.$/, "") ?? "";
  if (!normalized || normalized.includes("://") || /[/?#@\s]/.test(normalized)) return null;
  return normalized;
}

export function canUseRedirectSignIn(
  authDomain: string | null | undefined,
  currentHost: string,
  storage: AuthStorageLike | null | undefined,
) {
  const configuredHost = normalizeAuthHost(authDomain);
  const browserHost = normalizeAuthHost(currentHost);
  if (!configuredHost || !browserHost || configuredHost !== browserHost || !storage) return false;

  const probeKey = "__webetuRedirectStorageProbe__";
  try {
    storage.setItem(probeKey, "1");
    const available = storage.getItem(probeKey) === "1";
    storage.removeItem(probeKey);
    return available;
  } catch {
    try {
      storage.removeItem(probeKey);
    } catch {
      // The storage is unavailable; redirect sign-in will stay disabled.
    }
    return false;
  }
}

export type SessionResult = {
  ok: true;
  publicUserId?: string;
  isNewUser?: boolean;
  onboardingRequired?: boolean;
  plan?: "free" | "pro" | "ultra" | null;
  planRequired?: boolean;
};

type ErrorPayload = {
  error?: string;
  requestId?: string;
};

export class AuthFlowError extends Error {
  code?: string;
  requestId?: string;

  constructor(message: string, options: { code?: string; requestId?: string } = {}) {
    super(message);
    this.name = "AuthFlowError";
    this.code = options.code;
    this.requestId = options.requestId;
  }
}

export function safeNext(value: string | null | undefined) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export function destinationForSession(session: SessionResult, nextPath: string) {
  const safePath = safeNext(nextPath);
  const publicUserId = session.publicUserId;

  if (session.onboardingRequired && publicUserId) {
    return `/${publicUserId}/onboarding`;
  }
  if (!publicUserId) return safePath;
  if (safePath === "/") return `/${publicUserId}`;

  return safePath;
}

type NavigatorLike = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { mobile?: boolean };
};

export function isMobileBrowser(browser: NavigatorLike) {
  if (browser.userAgentData?.mobile === true) return true;
  const userAgent = browser.userAgent ?? "";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return true;
  return browser.platform === "MacIntel" && (browser.maxTouchPoints ?? 0) > 1;
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({}));
}

export async function createAndVerifyServerSession(
  idToken: string,
  expectedUid: string,
  fetcher: typeof fetch = fetch,
): Promise<SessionResult> {
  const response = await fetcher("/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ idToken }),
  });
  const body = await responseJson(response);
  if (!response.ok) {
    const error = body as ErrorPayload;
    throw new AuthFlowError(error.error || "Could not create your app session.", {
      requestId: error.requestId,
    });
  }

  const verification = await fetcher("/auth/session", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  const verificationBody = await responseJson(verification);
  if (!verification.ok || verificationBody.uid !== expectedUid) {
    const error = verificationBody as ErrorPayload;
    throw new AuthFlowError(
      error.error || "Your browser did not save the sign-in session. Please try again.",
      { requestId: error.requestId },
    );
  }
  return body as SessionResult;
}

export function authErrorDetails(error: unknown) {
  const candidate = error as { code?: string; message?: string; requestId?: string };
  const code = candidate?.code;
  let message = candidate?.message || "Could not complete sign-in. Please try again.";
  let retryWithRedirect = false;

  if (code === "auth/popup-closed-by-user") {
    message = "Google sign-in was closed before it finished. Please try again.";
    retryWithRedirect = true;
  } else if (code === "auth/popup-blocked") {
    message = "Your browser blocked the Google sign-in window. Allow pop-ups and try again, or use a magic link.";
    retryWithRedirect = true;
  } else if (code === "auth/cancelled-popup-request") {
    message = "Another sign-in attempt interrupted this one. Please try again.";
  } else if (code === "auth/network-request-failed") {
    message = "The sign-in network request failed. Check your connection and try again.";
  } else if (code === "auth/unauthorized-domain") {
    message = "Google sign-in is not configured for this site. Please contact support.";
  }

  if (candidate?.requestId) message += ` Reference: ${candidate.requestId}`;
  return { message, retryWithRedirect };
}
