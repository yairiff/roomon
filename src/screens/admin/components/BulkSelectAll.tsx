import { SelectOffIcon, SelectOnIcon, SelectSomeIcon } from "../../../components/Icons";

export type BulkSelectAllProps = {
  checked: boolean;
  indeterminate: boolean;
  onToggle: () => void;
};

export default function BulkSelectAll({ checked, indeterminate, onToggle }: BulkSelectAllProps) {
  return (
    <button type="button" className="admin-toolbar-chip admin-bulk-select" onClick={onToggle} aria-label="בחר הכל">
      {checked ? <SelectOnIcon /> : indeterminate ? <SelectSomeIcon /> : <SelectOffIcon />}
      <span>בחירה</span>
    </button>
  );
}
