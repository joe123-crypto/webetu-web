import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import VaultPage from "@/app/[publicUserId]/vault/page";
import SettingsPage from "@/app/[publicUserId]/settings/page";
import { DashboardNavMenu } from "@/app/_components/dashboard-nav-menu";

const mocks = vi.hoisted(() => ({
  cookie: vi.fn(), verify: vi.fn(), onboarding: vi.fn(), status: vi.fn(), username: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }) }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
  notFound: () => { throw new Error("not-found"); },
}));
vi.mock("@/src/security/session", () => ({ verifyFirebaseSessionCookie: mocks.verify }));
vi.mock("@/src/domains/users", () => ({ isOnboardingRequired: mocks.onboarding }));
vi.mock("@/src/domains/webetu", () => ({
  getWebetuCredentialStatus: mocks.status, getWebetuUsername: mocks.username,
}));
vi.mock("@/app/_components/dashboard-account-menu", () => ({ DashboardAccountMenu: () => null }));
vi.mock("@/app/_components/email-notification-toggle", () => ({
  EmailNotificationToggle: () => <button role="switch" aria-checked="true">Email notification</button>,
}));
const publicUserId = "usr_abcdefghijklmnop";
const params = () => Promise.resolve({ publicUserId });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookie.mockReturnValue({ value: "session" });
  mocks.verify.mockResolvedValue({ uid: "authenticated-user", name: "Student" });
  mocks.onboarding.mockResolvedValue(false);
  mocks.status.mockResolvedValue({ configured: true, status: "active" });
  mocks.username.mockResolvedValue("student-username");
});

describe("Vault page split", () => {
  it("places Vault between Restaurants and Settings and marks it active", () => {
    render(<DashboardNavMenu active="vault" basePath={`/${publicUserId}`} />);
    const links = within(screen.getByRole("navigation")).getAllByRole("link");
    expect(links.map(link => link.textContent)).toEqual(["Overview", "Restaurants", "Vault", "Settings"]);
    expect(screen.getByRole("link", { name: "Vault" })).toHaveAttribute("href", `/${publicUserId}/vault`);
    expect(screen.getByRole("link", { name: "Vault" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Settings" })).not.toHaveAttribute("aria-current");
  });

  it("loads the authenticated user's credentials on Vault without email preferences", async () => {
    render(await VaultPage({ params: params() }));
    expect(screen.getByRole("heading", { name: "Vault" })).toBeInTheDocument();
    expect(screen.getByLabelText("Webetu username")).toHaveValue("student-username");
    expect(screen.getByRole("button", { name: "Update credentials" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(mocks.status).toHaveBeenCalledWith("authenticated-user");
    expect(mocks.username).toHaveBeenCalledWith("authenticated-user");
  });

  it("keeps Settings limited to email preferences without reading credentials", async () => {
    render(await SettingsPage({ params: params() }));
    expect(screen.getByRole("switch", { name: "Email notification" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Webetu username")).not.toBeInTheDocument();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.username).not.toHaveBeenCalled();
  });

  it.each(["missing", "invalid"])("redirects a %s session to login with the Vault return path", async (session) => {
    if (session === "missing") mocks.cookie.mockReturnValue(undefined);
    else mocks.verify.mockRejectedValue(new Error("expired"));
    await expect(VaultPage({ params: params() })).rejects.toThrow(
      `redirect:/login?next=${encodeURIComponent(`/${publicUserId}/vault`)}`,
    );
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it("keeps incomplete users in onboarding before loading credentials", async () => {
    mocks.onboarding.mockResolvedValue(true);
    await expect(VaultPage({ params: params() })).rejects.toThrow(`redirect:/${publicUserId}/onboarding`);
    expect(mocks.status).not.toHaveBeenCalled();
  });
});
