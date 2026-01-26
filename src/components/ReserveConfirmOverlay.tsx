export type ReserveConfirmOverlayProps = {
  open: boolean;
  title: string;
  room: string;
  dateLine: string;
  timeLine: string;
  onConfirm: () => void;
  onClose: () => void;
};

export default function ReserveConfirmOverlay({
  open,
  title,
  room,
  dateLine,
  timeLine,
  onConfirm,
  onClose
}: ReserveConfirmOverlayProps) {
  if (!open) return null;

  return (
    <div className="reserve-overlay" onClick={onClose}>
      <div className="reserve-menu" onClick={(event) => event.stopPropagation()}>
        <div>
          <p className="reserve-title">{title}</p>
          <p className="reserve-room">{room}</p>
        </div>
        <div className="reserve-details">
          <p className="reserve-date">{dateLine}</p>
          <p className="reserve-time">{timeLine}</p>
        </div>
        <div className="reserve-actions">
          <button className="secondary" type="button" onClick={onClose}>
            ביטול
          </button>
          <button className="primary" type="button" onClick={onConfirm}>
            אישור
          </button>
        </div>
      </div>
    </div>
  );
}
