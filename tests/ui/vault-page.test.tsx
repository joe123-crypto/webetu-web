import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import VaultPage from "@/app/[publicUserId]/vault/page";
import SettingsPage from "@/app/[publicUserId]/settings/page";
import { DashboardNavMenu } from "@/app/_components/dashboard-nav-menu";

const mocks = vi.hoisted(() => ({
  pending: vi.fn(), rawVerify: vi.fn(), cookie: vi.fn(), verify: vi.fn(), onboarding: vi.fn(), status: vi.fn(), username: vi.fn(),
}));
vi.mock("@/src/domains/account-removal", () => ({ accountRemovalPending: mocks.pending }));
vi.mock("@/src/firebase/admin", () => ({ getFirebaseAdminAuth: () => ({ verifySessionCookie: mocks.rawVerify }) }));
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
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  mocks.pending.mockResolvedValue(false);
  mocks.rawVerify.mockResolvedValue(null);
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

  it("places account removal directly below the email toggle without reading credentials", async () => {
    render(await SettingsPage({ params: params() }));
    expect(screen.getByRole("switch", { name: "Email notification" })).toBeInTheDocument();
    const remove = screen.getByRole("button", { name: "Remove Account" });
    expect(screen.getByRole("switch", { name: "Email notification" }).compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByLabelText("Webetu username")).not.toBeInTheDocument();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.username).not.toHaveBeenCalled();
  });

  it("allows account removal before onboarding without requiring saved credentials", async () => {
    mocks.onboarding.mockResolvedValue(true);
    render(await SettingsPage({ params: params() }));
    expect(screen.getByRole("button", { name: "Remove Account" })).toBeInTheDocument();
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.username).not.toHaveBeenCalled();
  });

  it("shows only the removal retry control for a disabled identity with pending deletion", async () => {
    mocks.verify.mockRejectedValue(new Error("disabled"));
    mocks.rawVerify.mockResolvedValue({ uid: "authenticated-user" });
    mocks.pending.mockResolvedValue(true);
    render(await SettingsPage({ params: params() }));
    expect(screen.getByRole("heading", { name: "Finish account removal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Account Removal" })).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
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
