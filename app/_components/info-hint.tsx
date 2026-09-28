"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";

type InfoHintProps = {
  /** Explanation shown when the icon is clicked. */
  children: ReactNode;
  /**
   * Accessible label for the trigger, e.g. the section it explains.
   * Falls back to a generic label when omitted.
   */
  label?: string;
  /**
   * When true, the icon pulses to draw attention until the user interacts with
   * it once. The pulse stops permanently after the first click.
   */
  attention?: boolean;
};

/**
 * A small "more info" icon placed next to a section heading. Clicking it
 * reveals the explanation in a popover so the surrounding interface stays
 * uncluttered. Closes on outside click or Escape.
 */
export function InfoHint({ children, label, attention = false }: InfoHintProps) {
  const [open, setOpen] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const popoverId = useId();
  const triggerLabel = label ? `More information about ${label}` : "More information";
  const triggerClassName =
    attention && !hasInteracted
      ? "info-hint-trigger is-attention"
      : "info-hint-trigger";

  useEffect(() => {
    if (!open) return;

    function handlePointer(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <span className="info-hint" ref={containerRef}>
      <button
        type="button"
        className={triggerClassName}
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => {
          setHasInteracted(true);
          setOpen((value) => !value);
        }}
      >
        <Info aria-hidden="true" />
      </button>
      <span
        id={popoverId}
        role="tooltip"
        className="info-hint-popover"
        data-open={open ? "true" : "false"}
        hidden={!open}
      >
        {children}
      </span>
    </span>
  );
}
