export type ConfirmOverlayProps = {
  open: boolean;
  title: string;
  room?: string;
  dateLine?: string;
  timeLine?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
  onClose: () => void;
};

export default function ConfirmOverlay({
  open,
  title,
  room,
  dateLine,
  timeLine,
  confirmLabel = "אישור",
  cancelLabel = "ביטול",
  onConfirm,
  onCancel,
  onClose
}: ConfirmOverlayProps) {
  if (!open) return null;

  return (
    <div className="reserve-overlay" onClick={onClose}>
      <div className="reserve-menu" onClick={(event) => event.stopPropagation()}>
        <div>
          <p className="reserve-title">{title}</p>
          {room ? <p className="reserve-room">{room}</p> : null}
        </div>
        {(dateLine || timeLine) ? (
          <div className="reserve-details">
            {dateLine ? <p className="reserve-date">{dateLine}</p> : null}
            {timeLine ? <p className="reserve-time">{timeLine}</p> : null}
          </div>
        ) : null}
        <div className="reserve-actions">
          <button className="secondary" type="button" onClick={onCancel ?? onClose}>
            {cancelLabel}
          </button>
          <button className="primary" type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
