import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BackendStatus } from "@/app/_components/backend-status";

function healthResponse(reachable: boolean) {
  return new Response(JSON.stringify({ ok: true, reachable, checkedAt: new Date().toISOString() }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

/** The badge label, which is the status wording the user actually sees. */
function label() {
  return document.querySelector(".backend-status-label")?.textContent ?? "";
}

/** Lets the mocked fetch promise settle and React flush the resulting state. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("BackendStatus", () => {
  beforeEach(() => {
    setVisibility("visible");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("starts neutral and busy, with no label, before the first answer", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    render(<BackendStatus />);

    const button = screen.getByRole("button", { name: "Checking server status" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("data-status", "checking");
    expect(button.querySelector(".backend-status-label")).toHaveTextContent("");
  });

  it("shows the online label once the backend answers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(healthResponse(true)));

    render(<BackendStatus />);

    await waitFor(() => expect(label()).toBe("Server online"));
    expect(screen.getByRole("button", { name: /^Server online\./ })).toHaveAttribute(
      "data-status",
      "online",
    );
  });

  it("polls the same-origin route without caching", async () => {
    const fetchMock = vi.fn().mockResolvedValue(healthResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    render(<BackendStatus />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/health");
    expect(init).toMatchObject({ cache: "no-store", credentials: "same-origin" });
  });

  it("stays online after a single failure and only flips on the second", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(healthResponse(true))
      .mockResolvedValueOnce(healthResponse(false))
      .mockResolvedValueOnce(healthResponse(false));
    vi.stubGlobal("fetch", fetchMock);

    render(<BackendStatus />);
    await settle();
    expect(label()).toBe("Server online");

    // First miss: a blip, so the badge must not move.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(label()).toBe("Server online");

    // Second miss in a row: now it is an outage. Retries are faster while down.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(label()).toBe("Server offline");
    expect(screen.getByRole("button", { name: /^Server offline\./ })).toHaveAttribute(
      "data-status",
      "offline",
    );
  });

  it("treats a non-2xx from the route itself as offline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 502 })));

    render(<BackendStatus />);
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(label()).toBe("Server offline");
  });

  it("recovers to online once the backend comes back", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(healthResponse(false))
        .mockResolvedValueOnce(healthResponse(false))
        .mockResolvedValue(healthResponse(true)),
    );

    render(<BackendStatus />);
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(label()).toBe("Server offline");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(label()).toBe("Server online");
  });

  it("explains in the popover that an outage is normal, and closes on Escape", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(healthResponse(false)));

    render(<BackendStatus />);
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(label()).toBe("Server offline");

    const trigger = screen.getAllByRole("button")[0];
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText(/happens from time to time and usually clears within a few minutes/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Your settings and reservations are safe/i)).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("re-checks immediately when Check again is pressed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(healthResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    render(<BackendStatus />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getAllByRole("button")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("stops polling while the tab is hidden and catches up on return", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(healthResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    render(<BackendStatus />);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-checks when the browser regains its network connection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(healthResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    render(<BackendStatus />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps polling after a request times out", async () => {
    vi.useFakeTimers();
    // A request that never settles until its own 8s abort. Aborting the
    // controller must not be mistaken for "a newer check took over", or the
    // polling loop would end here and the badge would freeze forever.
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<BackendStatus />);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // First probe gives up at 8s, then the 20s unhealthy retry fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Two timed-out probes in a row is an outage.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(label()).toBe("Server offline");
  });

  it("stops polling after unmount", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(healthResponse(true));
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = render(<BackendStatus />);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
