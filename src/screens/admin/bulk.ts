export type BulkAction = {
  id: string;
  label: string;
  icon?: JSX.Element;
  tone?: "danger" | "default";
  disabled?: boolean;
  onClick: () => void;
};

export type BulkState = {
  selectAll?: {
    checked: boolean;
    indeterminate: boolean;
    onToggle: () => void;
  };
  selectedCount: number;
  totalCount: number;
  actions: BulkAction[];
};

