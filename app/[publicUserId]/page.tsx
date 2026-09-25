import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Webetu | Reservation Dashboard",
  description: "Your meal reservation status and run history.",
};

import { DashboardShell } from "@/app/_components/dashboard-shell";
import { StatusPill, StatusNotice } from "@/app/_components/status-ui";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { listDashboardTasksForUser, type DashboardTaskSnapshot } from "@/src/domains/dashboard";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { validatePublicUserId } from "@/src/lib/utils";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ publicUserId: string }>;
};

function statusKindForTask(task: DashboardTaskSnapshot) {
  if (task.status === "running") return "loading" as const;
  if (task.status === "failed") return "error" as const;
  if (task.status === "disabled" || !task.enabled) return "revoked" as const;
  if (task.status === "paused") return "warning" as const;
  if (task.lastRunStatus === "success") return "complete" as const;
  if (task.lastRunStatus === "failed") return "error" as const;
  if (task.lastRunStatus === "action_required") return "warning" as const;
  if (task.lastRunStatus === "partial") return "warning" as const;
  return "info" as const;
}

function statusLabel(task: DashboardTaskSnapshot) {
  if (!task.enabled) return "Disabled";
  const map: Record<string, string> = {
    active: "Active",
    running: "Running",
    paused: "Paused",
    failed: "Failed",
    disabled: "Disabled",
  };
  return map[task.status] ?? task.status;
}

function lastRunLabel(task: DashboardTaskSnapshot) {
  const map: Record<string, string> = {
    success: "Success",
    partial: "Partial",
    failed: "Failed",
    skipped: "Skipped",
    action_required: "Action required",
  };
  return task.lastRunStatus ? (map[task.lastRunStatus] ?? task.lastRunStatus) : "—";
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

function ReservationTaskCard({ task }: { task: DashboardTaskSnapshot }) {
  return (
    <div className="status block" data-status-kind={statusKindForTask(task)} style={{ marginBottom: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <strong style={{ flex: 1, minWidth: "120px" }}>
          {task.taskId === "reserve_meals" ? "Meal Reservation" : "Deliver Results"}
        </strong>
        <StatusPill kind={statusKindForTask(task)}>{statusLabel(task)}</StatusPill>
      </div>
      {task.scheduleLabel && (
        <p style={{ margin: "6px 0 0", fontSize: "0.875rem", color: "#6b7280" }}>
          Schedule: {task.scheduleLabel}
          {task.timezone ? ` (${task.timezone})` : ""}
        </p>
      )}
      <dl style={{ margin: "8px 0 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", fontSize: "0.875rem" }}>
        <dt style={{ color: "#6b7280" }}>Last run</dt>
        <dd style={{ margin: 0 }}>{formatDate(task.lastRunAt)}</dd>
        <dt style={{ color: "#6b7280" }}>Last result</dt>
        <dd style={{ margin: 0 }}>{lastRunLabel(task)}</dd>
        {task.nextRunAt && (
          <>
            <dt style={{ color: "#6b7280" }}>Next run</dt>
            <dd style={{ margin: 0 }}>{formatDate(task.nextRunAt)}</dd>
          </>
        )}
      </dl>
      {task.lastRunSummary && (
        <p style={{ margin: "8px 0 0", fontSize: "0.875rem", color: "#374151" }}>{task.lastRunSummary}</p>
      )}
    </div>
  );
}

export default async function UserDashboardPage({ params }: Props) {
  const { publicUserId } = await params;
  validatePublicUserId(publicUserId);

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) redirect(`/login?next=/${publicUserId}`);

  const verified = await verifyFirebaseSessionCookie(sessionCookie).catch(() => null);
  if (!verified) redirect(`/login?next=/${publicUserId}`);

  const uid = verified.uid;

  const { tasks } = await listDashboardTasksForUser(uid).catch(() => ({ tasks: [] }));

  const userLabel = verified.name ?? verified.email ?? "Account";

  return (
    <DashboardShell active="overview" publicUserId={publicUserId} userLabel={userLabel}>
      <div className="dashboard-topbar">
        <h1>Reservation Dashboard</h1>
      </div>

      {tasks.length === 0 ? (
        <StatusNotice kind="info" variant="block">
          No reservation runs reported yet.
        </StatusNotice>
      ) : (
        <div style={{ marginTop: "16px" }}>
          {tasks.map((task) => (
            <ReservationTaskCard key={task.taskId} task={task} />
          ))}
        </div>
      )}
    </DashboardShell>
  );
}
