import PhoneInTalkRoundedIcon from "@mui/icons-material/PhoneInTalkRounded";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";

export type ReservationDetailsOverlayProps = {
  open: boolean;
  title: string;
  room: string;
  dateLine: string;
  timeLine: string;
  name: string;
  email: string;
  phone: string;
  pictureUrl?: string;
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
  pictureUrl,
  onClose
}: ReservationDetailsOverlayProps) {
  if (!open) return null;

  const normalizedPhone = phone ? phone.replace(/[^\d+]/g, "") : "";
  const telHref = normalizedPhone ? `tel:${normalizedPhone}` : "";
  const waPhone = (() => {
    if (!normalizedPhone) return "";
    const digits = normalizedPhone.replace(/[^\d]/g, "");
    if (!digits) return "";
    // Best-effort Israel normalization for local numbers like 05xxxxxxxx.
    if (digits.startsWith("0") && digits.length === 10) return `972${digits.slice(1)}`;
    return digits;
  })();
  const waHref = waPhone ? `https://wa.me/${waPhone}` : "";

  const initials = (() => {
    const source = (name || "").trim() || (email || "").trim();
    if (!source) return "";
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return source.slice(0, 2).toUpperCase();
  })();

  return (
    <div className="reserve-overlay" onClick={onClose}>
      <div className="reserve-menu" onClick={(event) => event.stopPropagation()}>
        <div className="reserve-header">
          <div className="reserve-avatar" aria-hidden="true">
            {pictureUrl ? <img src={pictureUrl} alt="" /> : <span>{initials}</span>}
          </div>
          <div className="reserve-header-text">
            <p className="reserve-title">{title}</p>
            <p className="reserve-room">{room}</p>
          </div>
        </div>
        <div className="reserve-details">
          <p className="reserve-date">{dateLine}</p>
          <p className="reserve-time">{timeLine}</p>
          {name ? <p className="reserve-detail">{name}</p> : null}
          <p className="reserve-detail">טלפון: {phone || "לא זמין"}</p>
        </div>
        <div className="reserve-actions">
          {telHref ? (
            <a className="primary" href={telHref}>
              <PhoneInTalkRoundedIcon fontSize="small" />
              התקשר
            </a>
          ) : (
            <button className="primary" type="button" disabled>
              <PhoneInTalkRoundedIcon fontSize="small" />
              אין טלפון
            </button>
          )}
          {waHref ? (
            <a className="secondary" href={waHref} target="_blank" rel="noreferrer">
              <WhatsAppIcon fontSize="small" />
              WhatsApp
            </a>
          ) : (
            <button className="secondary" type="button" disabled>
              <WhatsAppIcon fontSize="small" />
              WhatsApp
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
