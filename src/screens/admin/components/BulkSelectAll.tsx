import { useEffect, useRef } from "react";

export type BulkSelectAllProps = {
  checked: boolean;
  indeterminate: boolean;
  onToggle: () => void;
  countLabel?: string;
};

export default function BulkSelectAll({ checked, indeterminate, onToggle, countLabel }: BulkSelectAllProps) {
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className="admin-toolbar-chip admin-bulk-select">
      <input
        ref={ref}
        type="checkbox"
        className="admin-row-check"
        checked={checked}
        onChange={onToggle}
        aria-label="בחר הכל"
      />
      <span>בחירה</span>
      <span className="admin-bulk-count">{countLabel || ""}</span>
    </label>
  );
}

