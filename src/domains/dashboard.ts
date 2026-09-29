import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/src/firebase/admin";
import { httpError, validateFirebaseUid } from "@/src/lib/utils";

// Webetu-only task ids and services.
export type DashboardTaskId = "reserve_meals" | "deliver_results";
export type DashboardTaskService = "webetu" | "delivery";
export type DashboardTaskStatus = "active" | "running" | "paused" | "failed" | "disabled";
export type DashboardLastRunStatus = "success" | "partial" | "failed" | "skipped" | "action_required";

export type DashboardTaskSnapshot = {
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: DashboardLastRunStatus | null;
  lastRunSummary: string | null;
  nextRunAt: string | null;
  scheduleLabel: string | null;
  service: DashboardTaskService;
  status: DashboardTaskStatus;
  taskId: DashboardTaskId;
  timezone: string | null;
  updatedAt: string | null;
};

const taskIds = new Set<string>(["reserve_meals", "deliver_results"]);
const services = new Set<string>(["webetu", "delivery"]);
const statuses = new Set<string>(["active", "running", "paused", "failed", "disabled"]);
const lastRunStatuses = new Set<string>(["success", "partial", "failed", "skipped", "action_required"]);

function dashboardTaskStatusId(userId: string, taskId: DashboardTaskId) {
  return `${validateFirebaseUid(userId)}_${taskId}`;
}

function normalizeEnum<T extends string>(value: unknown, allowed: Set<string>, field: string): T {
  const text = String(value ?? "").trim();
  if (!allowed.has(text)) throw httpError(400, `${field} is invalid.`);
  return text as T;
}

function normalizeOptionalDate(value: unknown, field: string) {
  if (value == null || value === "") return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw httpError(400, `${field} must be an ISO date.`);
  return date;
}

function normalizeOptionalString(value: unknown, maxLength: number, field: string) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.includes("\0")) throw httpError(400, `${field} is invalid.`);
  return text.slice(0, maxLength);
}

function dateToIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null && typeof (value as any).toDate === "function") {
    return (value as any).toDate().toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function taskMatchesService(taskId: DashboardTaskId, service: DashboardTaskService) {
  return (
    (taskId === "reserve_meals" && service === "webetu")
    || (taskId === "deliver_results" && service === "delivery")
  );
}

function taskSnapshotFromData(data: Record<string, unknown>): DashboardTaskSnapshot | null {
  const taskId = String(data?.taskId ?? "");
  const service = String(data?.service ?? "");
  const status = String(data?.status ?? "");
  if (!taskIds.has(taskId) || !services.has(service) || !statuses.has(status)) return null;
  return {
    enabled: data.enabled !== false,
    lastRunAt: dateToIso(data.lastRunAt),
    lastRunStatus: lastRunStatuses.has(String(data.lastRunStatus ?? ""))
      ? (data.lastRunStatus as DashboardLastRunStatus)
      : null,
    lastRunSummary: typeof data.lastRunSummary === "string" ? data.lastRunSummary : null,
    nextRunAt: dateToIso(data.nextRunAt),
    scheduleLabel: typeof data.scheduleLabel === "string" ? data.scheduleLabel : null,
    service: service as DashboardTaskService,
    status: status as DashboardTaskStatus,
    taskId: taskId as DashboardTaskId,
    timezone: typeof data.timezone === "string" ? data.timezone : null,
    updatedAt: dateToIso(data.updatedAt),
  };
}

export async function listDashboardTasksForUser(userIdInput: string) {
  const userId = validateFirebaseUid(userIdInput);
  const snap = await getFirestoreDb()
    .collection("dashboardTaskStatus")
    .where("userId", "==", userId)
    .get();
  const tasks = snap.docs
    .map((doc) => taskSnapshotFromData(doc.data() as Record<string, unknown>))
    .filter((task): task is DashboardTaskSnapshot => Boolean(task));
  return { tasks };
}

export async function upsertDashboardTaskStatus(body: Record<string, unknown>) {
  const userId = validateFirebaseUid(body.userId);
  const taskId = normalizeEnum<DashboardTaskId>(body.taskId, taskIds, "taskId");
  const service = normalizeEnum<DashboardTaskService>(body.service, services, "service");
  if (!taskMatchesService(taskId, service)) throw httpError(400, "service does not match taskId.");

  const status = normalizeEnum<DashboardTaskStatus>(body.status ?? "active", statuses, "status");
  const lastRunStatus =
    body.lastRunStatus == null || body.lastRunStatus === ""
      ? null
      : normalizeEnum<DashboardLastRunStatus>(body.lastRunStatus, lastRunStatuses, "lastRunStatus");
  const nextRunAt = normalizeOptionalDate(body.nextRunAt, "nextRunAt");
  const lastRunAt = normalizeOptionalDate(body.lastRunAt, "lastRunAt");
  const scheduleLabel = normalizeOptionalString(body.scheduleLabel, 160, "scheduleLabel");
  const timezone = normalizeOptionalString(body.timezone, 80, "timezone");
  const lastRunSummary = normalizeOptionalString(body.lastRunSummary, 240, "lastRunSummary");
  const enabled = body.enabled === false ? false : true;

  const payload = {
    userId,
    taskId,
    service,
    enabled,
    status,
    scheduleLabel,
    timezone,
    nextRunAt,
    lastRunAt,
    lastRunStatus,
    lastRunSummary,
    source: "agent",
    updatedAt: FieldValue.serverTimestamp(),
  };

  const docId = dashboardTaskStatusId(userId, taskId);
  const db = getFirestoreDb();
  const docRef = db.collection("dashboardTaskStatus").doc(docId);

  // Decide whether this update represents a NEW run result before we overwrite
  // the snapshot. A run is any update carrying a `lastRunStatus`; `lastRunAt` is
  // often absent, so we don't require it. De-dup against the stored snapshot so a
  // worker re-posting identical status (heartbeat/config update) doesn't add a
  // duplicate history entry.
  const existing = (await docRef.get()).data();
  const isNewRun =
    lastRunStatus != null &&
    (dateToIso(existing?.lastRunAt) !== (lastRunAt ? lastRunAt.toISOString() : null) ||
      (existing?.lastRunStatus ?? null) !== lastRunStatus ||
      (existing?.lastRunSummary ?? null) !== lastRunSummary);

  await docRef.set(payload, { merge: true });

  if (isNewRun) {
    await docRef.collection("runs").add({
      status: lastRunStatus,
      summary: lastRunSummary,
      runAt: lastRunAt, // may be null
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  return { ok: true as const, userId, taskId };
}

export type DashboardTaskRun = {
  id: string;
  runAt: string | null;
  createdAt: string | null;
  status: DashboardLastRunStatus | null;
  summary: string | null;
};

export async function listDashboardTaskRunsForUser(
  userIdInput: string,
  taskId: DashboardTaskId,
  limit = 10,
): Promise<{ runs: DashboardTaskRun[] }> {
  const userId = validateFirebaseUid(userIdInput);
  const snap = await getFirestoreDb()
    .collection("dashboardTaskStatus")
    .doc(dashboardTaskStatusId(userId, taskId))
    .collection("runs")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  const runs = snap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    return {
      id: doc.id,
      runAt: dateToIso(data.runAt),
      createdAt: dateToIso(data.createdAt),
      status: lastRunStatuses.has(String(data.status ?? ""))
        ? (data.status as DashboardLastRunStatus)
        : null,
      summary: typeof data.summary === "string" ? data.summary : null,
    };
  });

  return { runs };
}
