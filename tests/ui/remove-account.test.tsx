import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RemoveAccount } from "@/app/_components/remove-account";

vi.mock("@/src/firebase/client", () => ({ loadFirebaseClientSettings: async () => ({}), initializeFirebaseClient: () => ({}) }));
vi.mock("firebase/auth", () => ({ getAuth: vi.fn(), signOut: vi.fn() }));
vi.mock("@/app/_components/dashboard-account-menu", () => ({ endDashboardSession: vi.fn() }));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.stubGlobal("fetch", vi.fn());
});

function confirm() {
  fireEvent.click(screen.getByRole("button", { name: "Remove Account" }));
  fireEvent.change(screen.getByLabelText(/Type DELETE/), { target: { value: "DELETE" } });
  fireEvent.click(screen.getByRole("button", { name: "Permanently Delete Account" }));
}

it("requires deliberate typed confirmation, warns about Firebase and irreversibility, and cancels without a request", () => {
  render(<RemoveAccount />);
  fireEvent.click(screen.getByRole("button", { name: "Remove Account" }));
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Permanently remove your account?");
  expect(screen.getByText("This action cannot be undone.")).toBeVisible();
  expect(screen.getByText(/Firebase sign-in account/)).toBeVisible();
  const submit = screen.getByRole("button", { name: "Permanently Delete Account" });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Type DELETE/), { target: { value: "delete" } });
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps pending deletion busy, prevents duplicate requests, and only shows success after confirmed deletion", async () => {
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<RemoveAccount />);
  confirm();
  expect(screen.getByRole("button", { name: "Removing account…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.queryByText("Account removed")).not.toBeInTheDocument();
  fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
  expect(fetch).toHaveBeenCalledTimes(1);
  finish(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  expect(await screen.findByText("Account removed")).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it.each(["server", "network", "invalid-success"])("never reports success on %s failure and allows retry", async (failure) => {
  if (failure === "network") vi.mocked(fetch).mockRejectedValueOnce(new Error("Failed to fetch"));
  else vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "Removal incomplete. Retry removal here." }), { status: failure === "server" ? 500 : 200 }));
  render(<RemoveAccount />);
  confirm();
  expect(await screen.findByText(/Retry removal here/)).toBeVisible();
  expect(screen.queryByText("Account removed")).not.toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeVisible();
  await waitFor(() => expect(screen.getByRole("button", { name: "Permanently Delete Account" })).toBeEnabled());
});
