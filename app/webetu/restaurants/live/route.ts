import { NextRequest, NextResponse } from "next/server";
import { config } from "@/src/config";
import { verifyFirebaseRequest } from "@/src/security/session";
import {
  listWebetuRestaurantCatalog,
  getWebetuMetadataForUid,
  saveWebetuMetadataForUid,
} from "@/src/domains/webetu";
import { liveRestaurantFromWorkerEntry, webetuLocationToPersist } from "@/src/lib/utils";

export const runtime = "nodejs";

const FETCH_TIMEOUT_MS = 10_000;

// Fetch the user's live ONOU restaurants from the backend worker read-API. Returns
// null on any failure (unconfigured, unreachable, non-ok, empty) so the caller can
// fall back to the static catalog. Never leaks the key or backend URL to the client.
//
// Caches the user's ONOU location: when webetuMetadata/{uid} holds a fresh
// wilaya/residence we pass it to the worker so it skips re-discovery, and we save
// what the worker genuinely discovers (see webetuLocationToPersist). A location past
// its re-verification window is deliberately *not* reused: sending it makes the
// worker answer "override" without checking anything, so reusing it forever is how a
// wrong entry would become permanent.
//
// Everything here stays inside the try: the Firestore read and `new URL` can both
// throw — on a malformed WEBETU_API_BASE_URL the guard below only checks that the
// value is non-empty — and this function promises null rather than an exception, so
// a misconfigured backend serves the static catalog instead of a 500.
async function fetchLiveRestaurants(uid: string) {
  if (!config.webetuApiBaseUrl || !config.internalApiKey) return null;

  try {
    const saved = await getWebetuMetadataForUid(uid).catch(() => null);
    const reused =
      saved && !saved.stale ? { wilaya: saved.wilaya, residence: saved.residence } : null;
    const url = new URL(
      `${config.webetuApiBaseUrl}/api/webetu/users/${encodeURIComponent(uid)}/restaurants`
    );
    if (reused) {
      url.searchParams.set("wilaya", reused.wilaya);
      url.searchParams.set("residence", String(reused.residence));
    }

    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${config.internalApiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    if (!body || body.ok === false || !Array.isArray(body.restaurants)) return null;

    const location = webetuLocationToPersist(body, reused);
    if (location) {
      await saveWebetuMetadataForUid(uid, location).catch(() => {});
    } else if (!reused && body.wilayaSource === "default") {
      // We asked the worker to discover and it fell back to its own hardcoded
      // location, so this user is being served another wilaya's restaurants.
      // Nothing is cached (correctly), but say so: otherwise a discovery
      // regression looks like a working list.
      console.warn("[webetu] worker could not discover this user's ONOU location");
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
