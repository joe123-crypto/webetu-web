import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  records: new Map<string, Record<string, unknown>>(),
  events: [] as string[],
  failPath: "",
  authExists: true,
  disabled: false,
  authTime: 0,
  deleteAuthFails: false,
  verified: true,
}));
const missing = () => Object.assign(new Error("missing"), { code: "auth/user-not-found" });
const auth = vi.hoisted(() => ({
  verifySessionCookie: vi.fn(), getUser: vi.fn(), updateUser: vi.fn(), deleteUser: vi.fn(),
}));
vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "timestamp" } }));
function reference(path: string): any {
  return {
    path,
    get: async () => snapshot(path),
    collection: (name: string) => collection(`${path}/${name}`),
    listCollections: async () => {
      const children = [...state.records.keys()].filter((key) => key.startsWith(`${path}/`))
        .map((key) => key.slice(path.length + 1).split("/")[0]);
      return [...new Set(children)].map((name) => collection(`${path}/${name}`));
    },
    delete: async () => {
      state.events.push(`delete:${path}`);
      if (state.failPath === path) throw new Error("Firestore unavailable");
      state.records.delete(path);
    },
  };
}
function snapshot(path: string) {
  return { exists: state.records.has(path), data: () => state.records.get(path), ref: reference(path) };
}
function collection(path: string): any {
  return {
    path,
    doc: (id = "generated") => reference(`${path}/${id}`),
    where: (key: string, _op: string, value: unknown) => ({
      limit: (limit: number) => ({ get: async () => {
        const docs = [...state.records.entries()].filter(([p, d]) => p.startsWith(`${path}/`) && p.split("/").length === path.split("/").length + 1 && d[key] === value).slice(0, limit).map(([p]) => snapshot(p));
        return { empty: docs.length === 0, docs };
      } }),
    }),
  };
}
const db = {
  collection,
  runTransaction: async (fn: (t: any) => unknown) => {
    const writes: (() => void)[] = [];
    const result = await fn({
      get: async (ref: any) => snapshot(ref.path),
      update: (ref: any, data: any) => writes.push(() => {
        state.events.push(`fence:${ref.path}`);
        state.records.set(ref.path, { ...state.records.get(ref.path), ...data });
      }),
      set: (ref: any, data: any, options?: { merge: boolean }) => writes.push(() => {
        if (data.deletionRequested) state.events.push(`fence:${ref.path}`);
        state.records.set(ref.path, options?.merge ? { ...state.records.get(ref.path), ...data } : data);
      }),
      delete: (ref: any) => writes.push(() => state.records.delete(ref.path)),
    });
    writes.forEach((write) => write());
    return result;
  },
  recursiveDelete: async (ref: any) => {
    state.events.push(`delete:${ref.path}`);
    if (state.failPath === ref.path) {
      // Bulk deletion is not atomic: one child can disappear before a later
      // descendant fails. The owned root must remain discoverable for retry.
      const first = [...state.records.keys()].find((key) => key.startsWith(`${ref.path}/`));
      if (first) state.records.delete(first);
      throw new Error("Firestore unavailable");
    }
    for (const key of state.records.keys()) {
      if (key === ref.path || key.startsWith(`${ref.path}/`)) state.records.delete(key);
    }
  },
};
vi.mock("@/src/firebase/admin", () => ({ getFirestoreDb: () => db, getFirebaseAdminAuth: () => auth }));

import { authorizeAccountRemoval, removeAccount } from "@/src/domains/account-removal";
import { assertAccountWritable } from "@/src/domains/account-state";
import { setWebetuEmailNotificationForUid, saveWebetuMetadataForUid } from "@/src/domains/webetu";
import { upsertDashboardTaskStatus } from "@/src/domains/dashboard";
import { getOrCreateUserAccount, markOnboardingCompleted } from "@/src/domains/users";
import { POST } from "@/app/auth/account/remove/route";
import { SESSION_COOKIE_NAME } from "@/src/config";

beforeEach(() => {
  vi.clearAllMocks();
  state.records.clear();
  state.events = [];
  state.failPath = "";
  state.authExists = true;
  state.disabled = false;
  state.authTime = Date.now() / 1000;
  state.deleteAuthFails = false;
  state.verified = true;
  state.records.set("users/owner", { publicUserId: "usr_abcdefghijklmnop" });
  auth.verifySessionCookie.mockImplementation(async (_session, checkRevoked) => {
    if (!state.verified || (checkRevoked && (!state.authExists || state.disabled))) throw new Error("invalid session");
    return { uid: "owner", auth_time: state.authTime };
  });
  auth.getUser.mockImplementation(async () => {
    if (!state.authExists) throw missing();
    return { uid: "owner", disabled: state.disabled };
  });
  auth.updateUser.mockImplementation(async () => {
    if (!state.authExists) throw missing();
    state.events.push("disable-auth");
    state.disabled = true;
  });
  auth.deleteUser.mockImplementation(async () => {
    state.events.push("delete-auth");
    if (state.deleteAuthFails) throw new Error("Auth unavailable");
    if (!state.authExists) throw missing();
    state.authExists = false;
  });
});

function request(body: unknown = { confirmation: "DELETE" }, origin = "http://localhost", session = true) {
  return new NextRequest("http://localhost/auth/account/remove", {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...(session ? { cookie: `${SESSION_COOKIE_NAME}=signed-session` } : {}) },
    body: JSON.stringify(body),
  });
}

describe("account removal", () => {
  it("removes all owned roots and descendants, preserves other users, and deletes Auth before the fence", async () => {
    const owned = [
      "users/owner/private/nested", "credentialRefs/webetu_username_password_owner",
      "credentialRefs/legacy", "webetuPreferences/owner", "webetuMetadata/owner",
      "webetuVerifyAttempts/owner", "webetuManualRuns/owner", "webetuOverrides/owner_date",
      "dashboardTaskStatus/owner_reserve_meals/runs/orphan", "dashboardTaskStatus/legacy/runs/history",
      "dashboardTaskStatus/legacy",
    ];
    owned.forEach((p) => state.records.set(p, { userId: "owner" }));
    state.records.set("users/other", {});
    state.records.set("webetuOverrides/other_date", { userId: "other" });
    state.records.set("webetuRestaurants/shared", {});
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect([...state.records.keys()].sort()).toEqual(["users/other", "webetuOverrides/other_date", "webetuRestaurants/shared"]);
    expect(state.authExists).toBe(false);
    expect(state.events[0]).toBe("fence:users/owner");
    expect(state.events.at(-1)).toBe("delete:users/owner");
    expect(state.events.indexOf("delete-auth")).toBeLessThan(state.events.indexOf("delete:users/owner"));
  });

  it.each(["disable-auth", "firestore", "auth", "final-fence"])("reports %s failure honestly and lets the disabled identity retry", async (failure) => {
    if (failure === "disable-auth") auth.updateUser.mockRejectedValueOnce(new Error("Auth unavailable"));
    else if (failure === "auth") state.deleteAuthFails = true;
    else state.failPath = failure === "firestore" ? "webetuMetadata/owner" : "users/owner";
    const failed = await POST(request());
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ ok: false, error: expect.stringContaining("incomplete") });
    expect(failed.headers.get("set-cookie")).toBeNull();
    expect(state.records.get("users/owner")?.deletionRequested).toBe(true);
    state.failPath = "";
    state.deleteAuthFails = false;
    state.authTime -= 86400;
    const retried = await POST(request());
    expect(retried.status).toBe(200);
    expect(state.records.size).toBe(0);
    expect(state.authExists).toBe(false);
  });

  it.each(["credentialRefs/legacy", "users/owner"])("keeps %s discoverable after partial descendant deletion", async (root) => {
    state.records.set(root, { ...state.records.get(root), userId: "owner" });
    state.records.set(`${root}/private/deleted`, {});
    state.records.set(`${root}/private/missing/runs/survivor`, {});
    state.failPath = `${root}/private`;
    const failed = await POST(request());
    expect(failed.status).toBe(500);
    expect(state.records.has(root)).toBe(true);
    expect(state.records.has(`${root}/private/deleted`)).toBe(false);
    expect(state.records.has(`${root}/private/missing/runs/survivor`)).toBe(true);
    expect(state.records.get("users/owner")?.deletionRequested).toBe(true);
    state.failPath = "";
    expect((await POST(request())).status).toBe(200);
    expect(state.records.size).toBe(0);
  });

  it("paginates ownership records and ignores a supplied target UID", async () => {
    for (let i = 0; i < 105; i++) state.records.set(`webetuOverrides/legacy_${i}`, { userId: "owner" });
    state.records.set("users/other", {});
    const response = await POST(request({ confirmation: "DELETE", uid: "other" }));
    expect(response.status).toBe(200);
    expect([...state.records.keys()]).toEqual(["users/other"]);
  });

  it("retries a lost success response without recreating data", async () => {
    await removeAccount("owner");
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(state.records.size).toBe(0);
  });

  it.each([
    [() => request({ confirmation: "yes" }), 400],
    [() => request(undefined, "https://attacker.test"), 403],
    [() => request(undefined, "http://localhost", false), 401],
  ] as const)("rejects invalid confirmation, cross-site requests, and missing sessions before mutation", async (makeRequest, status) => {
    expect((await POST(makeRequest())).status).toBe(status);
    expect(state.events).toEqual([]);
  });

  it("requires recent, valid authentication before first removal", async () => {
    state.authTime -= 301;
    await expect(authorizeAccountRemoval("session")).rejects.toMatchObject({ status: 401 });
    state.verified = false;
    await expect(authorizeAccountRemoval("session")).rejects.toMatchObject({ status: 401 });
    expect(state.events).toEqual([]);
  });

  it.each([true, false])("rejects sign-in and late writes while removal is pending or finished (%s)", async (pending) => {
    if (pending) state.records.set("users/owner", { deletionRequested: true });
    else { state.records.delete("users/owner"); state.authExists = false; }
    await expect(db.runTransaction((t) => assertAccountWritable(db as any, t, "owner"))).rejects.toMatchObject({ status: 409 });
    await expect(setWebetuEmailNotificationForUid("owner", true)).rejects.toMatchObject({ status: 409 });
    await expect(saveWebetuMetadataForUid("owner", { wilaya: "16", residence: 1 })).rejects.toMatchObject({ status: 409 });
    await expect(markOnboardingCompleted("owner")).rejects.toMatchObject({ status: 409 });
    await expect(upsertDashboardTaskStatus({ userId: "owner", taskId: "reserve_meals", service: "webetu", lastRunStatus: "success" })).rejects.toMatchObject({ status: 409 });
    await expect(getOrCreateUserAccount("owner")).rejects.toBeDefined();
    expect([...state.records.keys()]).toEqual(pending ? ["users/owner"] : []);
  });
});
