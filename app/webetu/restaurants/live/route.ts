import { NextRequest, NextResponse } from "next/server";
import { config } from "@/src/config";
import { verifyFirebaseRequest } from "@/src/security/session";
import { listWebetuRestaurantCatalog } from "@/src/domains/webetu";
import { liveWebetuRestaurantFromPayload } from "@/src/lib/utils";

export const runtime = "nodejs";

const FETCH_TIMEOUT_MS = 10_000;

// Map a worker read-API restaurant into the shape the meal-reservation UI and the
// preferences save path expect. Reuses liveWebetuRestaurantFromPayload — the same
// normalizer/validator the save path runs — so every restaurant we surface here is
// guaranteed saveable (matching idDepot / catalogId keys) and no shape drift can
// slip a selection past the picker that the save path would then reject. Entries
// missing a usable depot id or name are dropped rather than shown as broken buttons.
function normalizeLiveRestaurant(entry: any) {
  if (!entry || typeof entry !== "object") return null;
  // The worker may express meal availability as a `meals` array; project it onto the
  // explicit breakfast/lunch/dinner flags the shared normalizer reads.
  const source = Array.isArray(entry.meals)
    ? (() => {
        const meals = entry.meals.map(String);
        return {
          ...entry,
          breakfast: entry.breakfast ?? meals.includes("breakfast"),
          lunch: entry.lunch ?? meals.includes("lunch"),
          dinner: entry.dinner ?? meals.includes("dinner"),
        };
      })()
    : entry;
  try {
    return liveWebetuRestaurantFromPayload(source);
  } catch {
    return null;
  }
}

// Fetch the user's live ONOU restaurants from the backend worker read-API. Returns
// null on any failure (unconfigured, unreachable, non-ok, empty) so the caller can
// fall back to the static catalog. Never leaks the key or backend URL to the client.
async function fetchLiveRestaurants(uid: string) {
  if (!config.webetuApiBaseUrl || !config.internalApiKey) return null;
  try {
    const res = await fetch(
      `${config.webetuApiBaseUrl}/api/webetu/users/${encodeURIComponent(uid)}/restaurants`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${config.internalApiKey}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }
    );
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    if (!body || body.ok === false || !Array.isArray(body.restaurants)) return null;
    const restaurants = body.restaurants.map(normalizeLiveRestaurant).filter(Boolean);
    return restaurants.length ? restaurants : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const decoded = await verifyFirebaseRequest(req);
    const live = await fetchLiveRestaurants(decoded.uid);
    const restaurants = live ?? (await listWebetuRestaurantCatalog());
    return NextResponse.json({ restaurants });
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status }
    );
  }
}
