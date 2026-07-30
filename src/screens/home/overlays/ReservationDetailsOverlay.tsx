import PhoneInTalkRoundedIcon from "@mui/icons-material/PhoneInTalkRounded";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import { useState } from "react";
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
  participants?: Array<{ email: string; name: string; phone?: string; pictureUrl?: string }>;
  privateDescription?: string;
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
  participants = [],
  privateDescription,
  pinned = false,
  onTogglePin,
  onClose
}: ReservationDetailsOverlayProps) {
  if (!open) return null;

  const [zoomOpen, setZoomOpen] = useState(false);

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
  const contactLinks = (rawPhone?: string) => {
    const normalized = rawPhone ? rawPhone.replace(/[^\d+]/g, "") : "";
    const tel = normalized ? `tel:${normalized}` : "";
    const digits = normalized.replace(/[^\d]/g, "");
    const wa = digits.startsWith("0") && digits.length === 10 ? `972${digits.slice(1)}` : digits;
    return { tel, wa: wa ? `https://wa.me/${wa}` : "" };
  };

  const handleBackdropClick = () => {
    if (zoomOpen) {
      setZoomOpen(false);
      return;
    }
    onClose();
  };

  return (
    <div className="reserve-overlay" onClick={handleBackdropClick}>
      <div className="reserve-menu" onClick={(event) => event.stopPropagation()}>
        <div className="reserve-header">
          <button
            type="button"
            className={`reserve-avatar${pictureUrl ? " clickable" : ""}`}
            aria-label={pictureUrl ? "הצג תמונת פרופיל" : undefined}
            onClick={(event) => {
              event.stopPropagation();
              if (!pictureUrl) return;
              setZoomOpen(true);
            }}
            disabled={!pictureUrl}
          >
            {pictureUrl ? <img src={pictureUrl} alt="" loading="lazy" /> : <span aria-hidden="true">{initials}</span>}
          </button>
          <div className="reserve-header-text">
            {name ? <p className="reserve-title">{name}</p> : <p className="reserve-title">{title}</p>}
            <p className="reserve-room">{room}</p>
          </div>
        </div>
        <div className="reserve-details">
          <p className="reserve-date">{dateLine}</p>
          <p className="reserve-time">{timeLine}</p>
          {!name ? <p className="reserve-detail">{title}</p> : null}
          {privateDescription ? <p className="reserve-detail">תיאור אישי: {privateDescription}</p> : null}
          {participants.length > 1 ? (
            <div className="reservation-participants">
              {participants.map((participant) => {
                const label = (participant.name || "").trim() || participant.email;
                const participantInitials = (() => {
                  const parts = label.trim().split(/\s+/).filter(Boolean);
                  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
                  return label.slice(0, 2).toUpperCase();
                })();
                const links = contactLinks(participant.phone);
                return (
                  <div key={`reservation-participant-${participant.email}`} className="reservation-participant-row">
                    <span className="groups-chat-avatar reservation-participant-avatar" aria-hidden="true">
                      {participant.pictureUrl ? (
                        <img src={participant.pictureUrl} alt="" loading="lazy" />
                      ) : (
                        participantInitials
                      )}
                    </span>
                    <span className="reservation-participant-text">
                      <span className="groups-chat-title">{label}</span>
                      <span className="groups-chat-subtitle">{participant.phone || participant.email}</span>
                    </span>
                    <span className="reserve-contact-actions reservation-participant-actions" aria-label="יצירת קשר">
                      {links.tel ? (
                        <a className="icon-button contact" href={links.tel} aria-label={`התקשר אל ${label}`}>
                          <PhoneInTalkRoundedIcon fontSize="small" />
                        </a>
                      ) : (
                        <button className="icon-button contact" type="button" aria-label="אין טלפון" disabled>
                          <PhoneInTalkRoundedIcon fontSize="small" />
                        </button>
                      )}
                      {links.wa ? (
                        <a
                          className="icon-button contact whatsapp"
                          href={links.wa}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`WhatsApp ${label}`}
                        >
                          <WhatsAppIcon fontSize="small" />
                        </a>
                      ) : (
                        <button className="icon-button contact whatsapp" type="button" aria-label="אין WhatsApp" disabled>
                          <WhatsAppIcon fontSize="small" />
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
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

      <div
        className={`avatar-zoom${zoomOpen ? " open" : ""}`}
        aria-hidden={!zoomOpen}
        onClick={(event) => {
          event.stopPropagation();
          setZoomOpen(false);
        }}
      >
        <div className="avatar-zoom-inner" onClick={(event) => event.stopPropagation()}>
          {pictureUrl ? <img src={pictureUrl} alt="" /> : null}
        </div>
      </div>
    </div>
  );
}
