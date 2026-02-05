import { useEffect, useRef, type ReactNode, type SyntheticEvent } from "react";

type FilterChipProps = {
  label: string;
  value: string;
  children: ReactNode;
};

let activeInstances = 0;
let cleanupGlobal: (() => void) | null = null;

const closeAllOpenChips = (except?: HTMLDetailsElement | null) => {
  const open = document.querySelectorAll<HTMLDetailsElement>("details.admin-filter-chip[open]");
  open.forEach((node) => {
    if (except && node === except) return;
    node.removeAttribute("open");
  });
};

const ensureGlobalListeners = () => {
  if (cleanupGlobal) return;

  const handlePointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (!target) return;
    // If the user clicks inside any filter chip (including the popup), keep it open.
    const chip = (target as Element | null)?.closest?.("details.admin-filter-chip");
    if (chip) return;
    closeAllOpenChips(null);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    closeAllOpenChips(null);
  };

  document.addEventListener("pointerdown", handlePointerDown, true);
  window.addEventListener("keydown", handleKeyDown);
  cleanupGlobal = () => {
    document.removeEventListener("pointerdown", handlePointerDown, true);
    window.removeEventListener("keydown", handleKeyDown);
  };
};

export function closeFilterChip(event: SyntheticEvent) {
  const details = (event.currentTarget as HTMLElement | null)?.closest("details") as HTMLDetailsElement | null;
  if (!details) return;
  details.removeAttribute("open");
}

export default function FilterChip({ label, value, children }: FilterChipProps) {
  const ref = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    // Install one global listener for "click anywhere closes" + Escape.
    ensureGlobalListeners();
    activeInstances += 1;
    return () => {
      activeInstances -= 1;
      if (activeInstances <= 0) {
        cleanupGlobal?.();
        cleanupGlobal = null;
      }
    };
  }, []);

  return (
    <div className="admin-filter-slot">
      <div className="admin-filter-slot-hint">{label}</div>
      <details
        ref={ref}
        className="admin-filter-chip"
        onToggle={() => {
          const details = ref.current;
          if (!details?.open) return;
          // Only one filter popover can be open at a time.
          closeAllOpenChips(details);
        }}
      >
        <summary className="admin-filter-chip-summary" role="button">
          <span className="admin-filter-chip-value">{value}</span>
        </summary>
        <div className="admin-filter-chip-pop">{children}</div>
      </details>
    </div>
  );
}
