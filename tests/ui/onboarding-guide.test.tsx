import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { OnboardingGuide } from "@/app/_components/onboarding-guide";
import { CREDENTIALS_STATUS_EVENT, RESTAURANT_SELECTED_EVENT } from "@/src/lib/onboarding";

function dispatch(name: string, detail?: unknown) {
  act(() => {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  });
}

describe("OnboardingGuide", () => {
  // Guard the desktop tests against a stub leaking from a failed mobile test.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("highlights the current step and lists all steps", () => {
    render(<OnboardingGuide step={2} publicUserId="abc123" ready={false} />);

    const current = screen.getByText("Restaurants", { selector: ".onboarding-guide-step-label" }).closest("li");
    expect(current).toHaveClass("is-current");
    expect(current).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Settings", { selector: ".onboarding-guide-step-label" }).closest("li")).toHaveClass("is-done");
    expect(screen.queryByText("Overview", { selector: ".onboarding-guide-step-label" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Restaurants" })).toBeInTheDocument();
  });

  it("blocks Next on settings until credentials are saved", () => {
    render(<OnboardingGuide step={1} publicUserId="abc123" ready={false} />);

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByText("Save your credentials to continue.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Back" })).not.toBeInTheDocument();

    dispatch(CREDENTIALS_STATUS_EVENT, { configured: true });
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/abc123/onboarding?step=2");

    // Revoking the credentials locks the step again.
    dispatch(CREDENTIALS_STATUS_EVENT, { configured: false });
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("gates finishing on the restaurants step until a restaurant is selected", () => {
    render(<OnboardingGuide step={2} publicUserId="abc123" ready={false} />);

    const finishName = "Finish & go to dashboard";
    expect(screen.getByRole("button", { name: finishName })).toBeDisabled();
    expect(screen.getByText("Select a restaurant to continue.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/abc123/onboarding?step=1");

    // Credential events don't belong to this step.
    dispatch(CREDENTIALS_STATUS_EVENT, { configured: true });
    expect(screen.getByRole("button", { name: finishName })).toBeDisabled();

    dispatch(RESTAURANT_SELECTED_EVENT);
    expect(screen.getByRole("button", { name: finishName })).toBeEnabled();
  });

  it("enables Next immediately when the step was already done", () => {
    render(<OnboardingGuide step={1} publicUserId="abc123" ready />);
    expect(screen.getByRole("link", { name: "Next" })).toBeInTheDocument();
    expect(screen.queryByText("Save your credentials to continue.")).not.toBeInTheDocument();
  });

  it("auto-advances on mobile once the step's requirement is met", async () => {
    // Report the phone breakpoint so the guide runs its buttonless auto-advance.
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    // jsdom's real location.assign is a non-configurable no-op, so swap the
    // whole location object to capture the navigation.
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, href: "http://localhost/" });

    const { unmount } = render(<OnboardingGuide step={1} publicUserId="abc123" ready />);
    await act(async () => {});
    expect(assign).toHaveBeenCalledWith("/abc123/onboarding?step=2");
    unmount();

    // The final step (restaurants) finishes and opens the dashboard once ready.
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<OnboardingGuide step={2} publicUserId="abc123" ready />);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledWith(
      "/webetu/onboarding/complete",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );

    vi.unstubAllGlobals();
  });

  it("shows the server's reason when finishing is refused", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: "Finish the remaining steps first." }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<OnboardingGuide step={2} publicUserId="abc123" ready />);
    const finish = screen.getByRole("button", { name: "Finish & go to dashboard" });
    await act(async () => {
      fireEvent.click(finish);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/webetu/onboarding/complete",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Finish the remaining steps first.");
    expect(screen.getByRole("button", { name: "Finish & go to dashboard" })).toBeEnabled();

    vi.unstubAllGlobals();
  });
});
