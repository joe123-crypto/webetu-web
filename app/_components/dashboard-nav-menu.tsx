"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Home,
  Menu,
  Settings,
  Utensils,
  X,
} from "lucide-react";

export type DashboardSection =
  | "overview"
  | "meal-reservation"
  | "settings";

type DashboardNavMenuProps = {
  active: DashboardSection;
  basePath: string;
};

const navItems: ReadonlyArray<{
  key: DashboardSection;
  label: string;
  href: string;
  icon: LucideIcon;
}> = [
  { key: "overview", label: "Overview", href: "", icon: Home },
  { key: "meal-reservation", label: "Restaurants", href: "/meal-reservation", icon: Utensils },
  { key: "settings", label: "Settings", href: "/settings", icon: Settings },
];

export function DashboardNavMenu({ active, basePath }: DashboardNavMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const TriggerIcon = open ? X : Menu;

  return (
    <div className="dashboard-nav-wrap" ref={rootRef}>
      <button
        className="dashboard-nav-trigger"
        type="button"
        ref={buttonRef}
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={open ? "Close dashboard navigation" : "Open dashboard navigation"}
        onClick={() => setOpen((value) => !value)}
      >
        <TriggerIcon aria-hidden="true" />
      </button>
      <nav
        className={open ? "dashboard-nav is-open" : "dashboard-nav"}
        id={menuId}
        aria-label="Primary dashboard navigation"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.key;
          return (
            <a
              key={item.key}
              className={isActive ? "dashboard-nav-link is-active" : "dashboard-nav-link"}
              href={`${basePath}${item.href}`}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}
