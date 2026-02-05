import PhoneInTalkRoundedIcon from "@mui/icons-material/PhoneInTalkRounded";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import { PinAddIcon, PinOnIcon } from "../../../components/Icons";

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
  pinned?: boolean;
  onTogglePin?: () => void;
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
  pinned = false,
  onTogglePin,
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
            {name ? <p className="reserve-title">{name}</p> : <p className="reserve-title">{title}</p>}
            <p className="reserve-room">{room}</p>
          </div>
        </div>
        <div className="reserve-details">
          <p className="reserve-date">{dateLine}</p>
          <p className="reserve-time">{timeLine}</p>
          {!name ? <p className="reserve-detail">{title}</p> : null}
        </div>
        <div className="reserve-actions reserve-actions-details">
          {onTogglePin ? (
            <button
              type="button"
              className="secondary reserve-pin-action"
              aria-label={pinned ? "הסר מהמערכת שלי" : "הוסף למערכת שלי"}
              aria-pressed={pinned}
              onClick={onTogglePin}
            >
              {pinned ? <PinOnIcon /> : <PinAddIcon />}
              <span>{pinned ? "הסר מהמערכת שלי" : "הוסף למערכת שלי"}</span>
            </button>
          ) : null}

          <div className="reserve-contact-actions" aria-label="יצירת קשר">
            {telHref ? (
              <a className="icon-button contact" href={telHref} aria-label="התקשר">
                <PhoneInTalkRoundedIcon fontSize="small" />
              </a>
            ) : (
              <button className="icon-button contact" type="button" aria-label="אין טלפון" disabled>
                <PhoneInTalkRoundedIcon fontSize="small" />
              </button>
            )}

            {waHref ? (
              <a
                className="icon-button contact whatsapp"
                href={waHref}
                target="_blank"
                rel="noreferrer"
                aria-label="WhatsApp"
              >
                <WhatsAppIcon fontSize="small" />
              </a>
            ) : (
              <button className="icon-button contact whatsapp" type="button" aria-label="אין WhatsApp" disabled>
                <WhatsAppIcon fontSize="small" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
