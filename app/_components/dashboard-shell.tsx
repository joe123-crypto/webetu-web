import type { ReactNode } from "react";
import { DashboardAccountMenu } from "@/app/_components/dashboard-account-menu";
import { DashboardNavMenu, type DashboardSection } from "@/app/_components/dashboard-nav-menu";
import {
  PARENT_BRAND,
  PARENT_LOGO_SRC,
  PRODUCT_NAME,
} from "@/src/lib/brand";

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
        <div className="dashboard-brand-block">
          <a className="dashboard-brand" href={basePath} aria-label={`${PRODUCT_NAME} home`}>
            <span className="brand-wordmark brand-wordmark-sm">{PRODUCT_NAME}</span>
          </a>
          <span className="dashboard-endorsement" aria-label={`a ${PARENT_BRAND} product`}>
            <span>by</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={PARENT_LOGO_SRC} alt={PARENT_BRAND} />
          </span>
        </div>
        <div className="dashboard-header-actions">
          <DashboardNavMenu active={active} basePath={basePath} />
          <DashboardAccountMenu userLabel={userLabel} />
        </div>
      </aside>
      <section className="dashboard-content">{children}</section>
    </main>
  );
}
