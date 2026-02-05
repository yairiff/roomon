import { SelectOffIcon, SelectOnIcon } from "../../../components/Icons";

type RowSelectButtonProps = {
  selected: boolean;
  label: string;
  onToggle: () => void;
};

export default function RowSelectButton({ selected, label, onToggle }: RowSelectButtonProps) {
  return (
    <button
      type="button"
      className={`admin-row-select${selected ? " selected" : ""}`}
      aria-label={label}
      aria-pressed={selected}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      {selected ? <SelectOnIcon /> : <SelectOffIcon />}
    </button>
  );
}

