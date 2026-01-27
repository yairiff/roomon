export type ReservationDetailsOverlayProps = {
  open: boolean;
  title: string;
  room: string;
  dateLine: string;
  timeLine: string;
  name: string;
  email: string;
  phone: string;
  onClose: () => void;
};

export default function ReservationDetailsOverlay({
  open,
  title,
  room,
  dateLine,
  timeLine,
  name,
  email,
  phone,
  onClose
}: ReservationDetailsOverlayProps) {
  if (!open) return null;

  const normalizedPhone = phone ? phone.replace(/[^\d+]/g, "") : "";
  const telHref = normalizedPhone ? `tel:${normalizedPhone}` : "";

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
          {name ? <p className="reserve-detail">שם: {name}</p> : null}
          {email ? <p className="reserve-detail">אימייל: {email}</p> : null}
          <p className="reserve-detail">טלפון: {phone || "לא זמין"}</p>
        </div>
        <div className="reserve-actions">
          <button className="secondary" type="button" onClick={onClose}>
            סגירה
          </button>
          {telHref ? (
            <a className="primary" href={telHref}>
              התקשר
            </a>
          ) : (
            <button className="primary" type="button" disabled>
              אין טלפון
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
