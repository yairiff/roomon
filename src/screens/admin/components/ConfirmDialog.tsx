type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "אישור",
  cancelLabel = "ביטול",
  tone = "default",
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="admin-confirm-overlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="admin-confirm-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="admin-confirm-title">{title}</h3>
        {description ? <p className="admin-confirm-desc">{description}</p> : null}
        <div className="admin-confirm-actions">
          <button
            type="button"
            className={tone === "danger" ? "secondary danger" : "secondary"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button type="button" className="primary" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

