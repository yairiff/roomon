import type { ReactNode, SyntheticEvent } from "react";

type FilterChipProps = {
  label: string;
  value: string;
  children: ReactNode;
};

export function closeFilterChip(event: SyntheticEvent) {
  const details = (event.currentTarget as HTMLElement | null)?.closest("details") as HTMLDetailsElement | null;
  if (!details) return;
  details.removeAttribute("open");
}

export default function FilterChip({ label, value, children }: FilterChipProps) {
  return (
    <div className="admin-filter-slot">
      <div className="admin-filter-slot-hint">{label}</div>
      <details className="admin-filter-chip">
        <summary className="admin-filter-chip-summary" role="button">
          <span className="admin-filter-chip-value">{value}</span>
        </summary>
        <div className="admin-filter-chip-pop">{children}</div>
      </details>
    </div>
  );
}
