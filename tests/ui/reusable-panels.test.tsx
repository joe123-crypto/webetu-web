import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { CredentialsVault } from "@/app/_components/credentials-vault";
import { RestaurantPicker } from "@/app/_components/restaurant-picker";
import { CREDENTIALS_STATUS_EVENT, RESTAURANT_SELECTED_EVENT } from "@/src/lib/onboarding";

// These components ship their behavior as an inline <script>. Mount the server
// markup and run the script the way the browser would on page load.
function mountWithScript(element: ReactElement) {
  document.body.innerHTML = renderToStaticMarkup(element);
  const script = document.querySelector("script");
  if (!script?.textContent) throw new Error("component rendered no inline script");
  new Function(script.textContent)();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function pillLabel(selector: string) {
  return document.querySelector(`${selector} [data-status-label]`)?.textContent;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("CredentialsVault", () => {
  const notSaved = {
    configured: false,
    connected: false,
    status: "not_saved",
    updatedAt: null,
    lastVerifiedAt: null,
  };

  it("derives its initial state from the credential status", () => {
    mountWithScript(<CredentialsVault status={notSaved} savedUsername={null} />);
    expect(pillLabel("[data-webetu-status]")).toBe("Not saved");
    expect(document.querySelector("[data-webetu-save]")?.textContent).toBe("Save credentials");
    expect(document.querySelector<HTMLButtonElement>("[data-webetu-revoke]")?.hidden).toBe(true);
  });

  it("shows an unavailable state when the status could not be loaded", () => {
    mountWithScript(<CredentialsVault status={null} />);
    expect(pillLabel("[data-webetu-status]")).toBe("Unavailable");
  });

  it("saves credentials and announces the new status", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/webetu/credentials") return json({ connected: true });
      if (url === "/webetu/credentials/status") return json({ configured: true, status: "active" });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const announced = vi.fn();
    document.addEventListener(CREDENTIALS_STATUS_EVENT, announced);

    mountWithScript(<CredentialsVault status={notSaved} savedUsername="student" />);
    (document.querySelector("[data-webetu-password]") as HTMLInputElement).value = "secret";
    fireEvent.submit(document.querySelector("[data-webetu-form]")!);

    await waitFor(() => expect(announced).toHaveBeenCalledTimes(1));
    expect((announced.mock.calls[0][0] as CustomEvent).detail).toEqual({ configured: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/webetu/credentials",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ username: "student", password: "secret" }),
      }),
    );
    expect(pillLabel("[data-webetu-status]")).toBe("Saved");
    expect(document.querySelector<HTMLButtonElement>("[data-webetu-revoke]")?.hidden).toBe(false);

    document.removeEventListener(CREDENTIALS_STATUS_EVENT, announced);
  });
});

describe("RestaurantPicker", () => {
  const fallback = { catalogId: "fallback", name: "Fallback Restaurant" };
  const chosen = { catalogId: "campus-a", name: "Campus A" };

  function stubRestaurantApi() {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/webetu/preferences" && init?.method === "POST") return json({ defaultRestaurant: chosen });
      if (url === "/webetu/preferences") return json({ defaultRestaurant: fallback, overrides: {} });
      if (url === "/webetu/restaurants/live") return json({ restaurants: [fallback, chosen] });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function option(catalogId: string) {
    return document.querySelector<HTMLButtonElement>(`[data-your-restaurants] [data-catalog-id="${catalogId}"]`);
  }

  it("shows the saved default as selected on the restaurants page", async () => {
    stubRestaurantApi();
    mountWithScript(<RestaurantPicker />);

    await waitFor(() => expect(option("fallback")).toHaveAttribute("aria-pressed", "true"));
    expect(pillLabel("[data-restaurant-status]")).toBe("Fallback Restaurant");
    expect(document.querySelector("[data-restaurant-panel] .restaurant-option")).toBeNull();
  });

  it("does not present the fallback as a choice when an explicit pick is required", async () => {
    stubRestaurantApi();
    mountWithScript(<RestaurantPicker requireExplicitChoice hasSavedDefault={false} />);

    await waitFor(() => expect(option("fallback")).not.toBeNull());
    expect(option("fallback")).toHaveAttribute("aria-pressed", "false");
    expect(pillLabel("[data-restaurant-status]")).toBe("Not set");
  });

  it("saves a selection and announces it", async () => {
    const fetchMock = stubRestaurantApi();
    const announced = vi.fn();
    document.addEventListener(RESTAURANT_SELECTED_EVENT, announced);

    mountWithScript(<RestaurantPicker requireExplicitChoice hasSavedDefault={false} />);
    await waitFor(() => expect(option("campus-a")).not.toBeNull());
    fireEvent.click(option("campus-a")!);

    await waitFor(() => expect(announced).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/webetu/preferences",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ restaurant: chosen }) }),
    );
    expect(option("campus-a")).toHaveAttribute("aria-pressed", "true");
    expect(pillLabel("[data-restaurant-status]")).toBe("Campus A");

    document.removeEventListener(RESTAURANT_SELECTED_EVENT, announced);
  });

  it("matches the saved default to the live list by depot despite a different catalogId", async () => {
    // The saved default may come from the built-in catalog, which names the canteen differently.
    const catalogEntry = { catalogId: "bab-ezzouar-03", name: "Bab Ezzouar 03", idDepot: 190 };
    const liveEntry = { catalogId: "onou-depot-190", name: "Bab Ezzouar 03", idDepot: 190 };
    const other = { catalogId: "onou-depot-42", name: "Other", idDepot: 42 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/webetu/preferences" && init?.method === "POST") return json({ defaultRestaurant: liveEntry });
        if (url === "/webetu/preferences") return json({ defaultRestaurant: catalogEntry, overrides: {} });
        if (url === "/webetu/restaurants/live") return json({ restaurants: [liveEntry, other] });
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    const live = (catalogId: string) =>
      document.querySelector<HTMLButtonElement>(`[data-your-restaurants] [data-catalog-id="${catalogId}"]`);

    mountWithScript(<RestaurantPicker />);
    await waitFor(() => expect(live("onou-depot-190")).toHaveAttribute("aria-pressed", "true"));
    expect(live("onou-depot-42")).toHaveAttribute("aria-pressed", "false");
  });
});
