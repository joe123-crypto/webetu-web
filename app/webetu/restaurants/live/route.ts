import { NextRequest, NextResponse } from "next/server";
import { config } from "@/src/config";
import { verifyFirebaseRequest } from "@/src/security/session";
import {
  listWebetuRestaurantCatalog,
  getWebetuMetadataForUid,
  saveWebetuMetadataForUid,
} from "@/src/domains/webetu";
import { liveRestaurantFromWorkerEntry } from "@/src/lib/utils";

export const runtime = "nodejs";

const FETCH_TIMEOUT_MS = 10_000;

// Fetch the user's live ONOU restaurants from the backend worker read-API. Returns
// null on any failure (unconfigured, unreachable, non-ok, empty) so the caller can
// fall back to the static catalog. Never leaks the key or backend URL to the client.
//
// Caches the user's ONOU location: when webetuMetadata/{uid} already holds a
// wilaya/residence we pass it to the worker so it skips re-discovery; when it
// doesn't, we persist what the worker discovers (only genuinely discovered values,
// not its default fallback) so subsequent calls can reuse it.
async function fetchLiveRestaurants(uid: string) {
  if (!config.webetuApiBaseUrl || !config.internalApiKey) return null;

  const saved = await getWebetuMetadataForUid(uid).catch(() => null);
  const url = new URL(
    `${config.webetuApiBaseUrl}/api/webetu/users/${encodeURIComponent(uid)}/restaurants`
  );
  if (saved) {
    url.searchParams.set("wilaya", saved.wilaya);
    url.searchParams.set("residence", String(saved.residence));
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.internalApiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    if (!body || body.ok === false || !Array.isArray(body.restaurants)) return null;

    // Persist the discovered location on first successful discovery so later
    // lookups reuse it. Skip the worker's default fallback to avoid pinning a
    // wrong location for non-Algiers users.
    if (!saved && body.wilayaSource === "discovered" && body.wilaya && body.residence != null) {
      await saveWebetuMetadataForUid(uid, {
        wilaya: String(body.wilaya),
        residence: Number(body.residence),
      }).catch(() => {});
    }

    const restaurants = body.restaurants.map(liveRestaurantFromWorkerEntry).filter(Boolean);
    const dropped = body.restaurants.length - restaurants.length;
    if (dropped > 0) {
      // Unsaveable entries (usually a missing idDepot) are hidden; surface it so a worker
      // payload regression doesn't silently collapse the list to the static catalog.
      console.warn(
        `[webetu] dropped ${dropped}/${body.restaurants.length} live restaurants without a usable idDepot or name`
      );
    }
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
