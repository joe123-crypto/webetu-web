import { after } from "next/server";

/**
 * Run best-effort work once the response has already been sent.
 *
 * On Vercel the function can be frozen the moment a response is returned, so a floating
 * promise is not reliably executed to completion -- `after` is what keeps the invocation
 * alive for it.
 *
 * Both the scheduling and the task itself are swallowed. `after` throws when there is no
 * request scope (a unit test calling a route handler directly, a one-off script), and the
 * callers here are all doing optional work: none of it is worth turning a healthy response
 * into a 500.
 */
export function runAfterResponse(task: () => Promise<void> | void): void {
  try {
    after(async () => {
      try {
        await task();
      } catch (err) {
        console.error("[after] background task failed:", err);
      }
    });
  } catch {
    // No request scope -- nothing to attach the work to, and nothing that must happen.
  }
}
