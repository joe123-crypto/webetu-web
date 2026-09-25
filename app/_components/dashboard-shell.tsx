import type { ReactNode } from "react";
import { DashboardAccountMenu } from "@/app/_components/dashboard-account-menu";
import { DashboardNavMenu, type DashboardSection } from "@/app/_components/dashboard-nav-menu";

type DashboardShellProps = {
  active: DashboardSection;
  children: ReactNode;
  publicUserId: string;
  userLabel?: string | null;
};

export function DashboardShell({
  active,
  children,
  publicUserId,
  userLabel = "Account",
}: DashboardShellProps) {
  const basePath = `/${publicUserId}`;

  return (
    <main className="dashboard-app">
      <aside className="dashboard-sidebar" aria-label="Dashboard navigation">
        <a className="dashboard-brand" href={basePath} aria-label="Webetu home">
          <span style={{ fontWeight: 800, fontSize: "1.4rem" }}>Webetu</span>
        </a>
        <div className="dashboard-header-actions">
          <DashboardNavMenu active={active} basePath={basePath} />
          <DashboardAccountMenu userLabel={userLabel} />
        </div>
      </aside>
      <section className="dashboard-content">{children}</section>
    </main>
  );
}
