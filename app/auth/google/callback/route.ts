import { NextRequest, NextResponse } from "next/server";
import { verifyState } from "@/src/security/crypto";
import { escapeHtml, escapeHtmlAttribute } from "@/src/lib/utils";

export const runtime = "nodejs";

const CALLBACK_HTML_CSS = `:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fff;color:#090909;font-weight:400;line-height:1.5;min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(520px,100%);background:#fff;border:1px solid #e5e5e2;border-radius:8px;padding:24px;box-shadow:0 10px 26px rgba(22,28,36,.06);text-align:center;display:grid;gap:12px}h2{margin:0;color:#050505;font-size:1.5rem;font-weight:700;line-height:1.2}p{margin:0;color:#676767;font-weight:400}a{color:#090909;text-decoration:none;font-weight:500}a:hover{text-decoration:underline}`;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const state = searchParams.get("state");
    const errorParam = searchParams.get("error");

    if (errorParam) {
      throw new Error(`OAuth Error: ${errorParam}`);
    }
    if (!state) {
      throw new Error("Missing state parameter.");
    }

    const payload = verifyState(state);
    if (!payload) throw new Error("Invalid state payload.");

    if (Date.now() - payload.ts > 10 * 60 * 1000) {
      throw new Error("State parameter expired. Please try again.");
    }

    // Sign-in flow: redirect to the finish page (Google ID token exchange happens there).
    if (payload.flow === "signin") {
      const finishUrl = new URL("/auth/google/finish", req.nextUrl.origin);
      // The code is forwarded to the finish endpoint via a form-post style redirect.
      // For simplicity in this scaffold, redirect with code in query string.
      const code = searchParams.get("code");
      if (code) finishUrl.searchParams.set("code", code);
      if (payload.next) finishUrl.searchParams.set("next", payload.next);
      return NextResponse.redirect(finishUrl, 302);
    }

    const redirectUrl = "/";
    return new NextResponse(
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Connected</title>
  <meta http-equiv="refresh" content="2;url=${escapeHtmlAttribute(redirectUrl)}">
  <style>${CALLBACK_HTML_CSS}</style>
</head>
<body>
  <div class="card">
    <h2>Connected Successfully!</h2>
    <p>Redirecting you back...</p>
    <p><a href="${escapeHtmlAttribute(redirectUrl)}">Click here if you are not redirected</a></p>
  </div>
</body>
</html>`,
      {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    );
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 400;
    return new NextResponse(
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Connection Error</title>
  <style>${CALLBACK_HTML_CSS}.card{border-color:#f1a7a1}h2{color:#9f2419}</style>
</head>
<body>
  <div class="card">
    <h2>Connection Failed</h2>
    <p>${escapeHtml(error.message || "An unknown error occurred.")}</p>
    <p><a href="/">Return to Home</a></p>
  </div>
</body>
</html>`,
      {
        status,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    );
  }
}
