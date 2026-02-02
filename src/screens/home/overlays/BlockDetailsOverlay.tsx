export type BlockDetailsOverlayProps = {
  open: boolean;
  title: string;
  room: string;
  dateLine: string;
  timeLine: string;
  lines?: { label: string; value: string }[];
  onClose: () => void;
};

export default function BlockDetailsOverlay({
  open,
  title,
  room,
  dateLine,
  timeLine,
  lines = [],
  onClose
}: BlockDetailsOverlayProps) {
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
          {lines
            .filter((line) => Boolean(line.value))
            .map((line) => (
              <p key={line.label} className="reserve-detail">
                {line.label}: {line.value}
              </p>
            ))}
        </div>
        <div className="reserve-actions">
          <button className="secondary" type="button" onClick={onClose}>
            סגירה
          </button>
        </div>
      </div>
    </div>
  );
}

