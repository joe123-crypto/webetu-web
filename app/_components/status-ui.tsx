import type { ComponentPropsWithRef, ReactNode } from "react";
import {
  Ban,
  Check,
  CircleAlert,
  CircleDashed,
  Info,
  LoaderCircle,
  Unlink,
  X,
} from "lucide-react";

export type StatusKind =
  | "complete"
  | "unlinked"
  | "pending"
  | "warning"
  | "revoked"
  | "loading"
  | "error"
  | "info";

function StatusGlyph() {
  return (
    <span className="status-icon-set" aria-hidden="true">
      <Check data-status-icon="complete" />
      <Unlink data-status-icon="unlinked" />
      <CircleDashed data-status-icon="pending" />
      <CircleAlert data-status-icon="warning" />
      <Ban data-status-icon="revoked" />
      <LoaderCircle data-status-icon="loading" />
      <CircleAlert data-status-icon="error" />
      <Info data-status-icon="info" />
    </span>
  );
}

type StatusProps = Omit<ComponentPropsWithRef<"span">, "children"> & {
  children: ReactNode;
  kind: StatusKind;
};

export function StatusPill({ children, className = "", kind, ...props }: StatusProps) {
  return (
    <span
      {...props}
      className={`status-pill status-ui ${className}`.trim()}
      data-status-kind={kind}
    >
      <StatusGlyph />
      <span data-status-label>{children}</span>
    </span>
  );
}

type NoticeProps = Omit<ComponentPropsWithRef<"div">, "children"> & {
  children?: ReactNode;
  kind?: StatusKind;
  variant?: "message" | "block";
};

export function StatusNotice({
  children = "",
  className = "",
  kind = "info",
  variant = "message",
  ...props
}: NoticeProps) {
  return (
    <div
      {...props}
      className={`${variant === "block" ? "status" : "message"} status-ui ${className}`.trim()}
      data-status-kind={kind}
    >
      <StatusGlyph />
      <span data-status-label>{children}</span>
      <span className="status-dismiss" aria-hidden="true">
        <X />
      </span>
    </div>
  );
}
