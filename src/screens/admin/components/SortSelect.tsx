type SortOption = {
  value: string;
  label: string;
};

type SortSelectProps = {
  label: string;
  value: string;
  options: SortOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
};

export default function SortSelect({ label, value, options, onChange, ariaLabel }: SortSelectProps) {
  return (
    <div className="admin-filter-slot admin-sort-slot">
      <div className="admin-filter-slot-hint">{label}</div>
      <div className="admin-sort-control">
        <select
          value={value}
          aria-label={ariaLabel || label}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

