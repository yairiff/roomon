import PhoneInTalkRoundedIcon from "@mui/icons-material/PhoneInTalkRounded";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import EmailRoundedIcon from "@mui/icons-material/EmailRounded";
import { useState } from "react";
import { PinAddIcon, PinOnIcon } from "../../../components/Icons";
import { getContactLinks } from "../../../lib/contactLinks";
import type { ReservationParticipantStatus } from "../../../types/reservations";
import { ParticipantAvatarStack, ParticipantRows, type ParticipantDisplayEntry } from "../components/ParticipantDisplay";

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
  participants?: ParticipantDisplayEntry[];
  currentParticipantStatus?: ReservationParticipantStatus;
  onRespondParticipation?: (status: "approved" | "declined") => void;
  privateDescription?: string;
  sharedDescription?: string;
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
  currentParticipantStatus,
  onRespondParticipation,
  privateDescription,
  sharedDescription,
  pinned = false,
  onTogglePin,
  onClose
}: ReservationDetailsOverlayProps) {
  const [zoomOpen, setZoomOpen] = useState(false);
  const [participantsExpanded, setParticipantsExpanded] = useState(false);

  if (!open) return null;

  const ownerLinks = getContactLinks(email, phone);

  const initials = (() => {
    const source = (name || "").trim() || (email || "").trim();
    if (!source) return "";
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return source.slice(0, 2).toUpperCase();
  })();
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
          {sharedDescription ? <p className="reserve-detail">תיאור משותף: {sharedDescription}</p> : null}
          {participants.length > 1 ? (
            <div className="reservation-participant-summary">
              <ParticipantAvatarStack
                participants={participants}
                interactive
                expanded={participantsExpanded}
                onClick={() => setParticipantsExpanded((value) => !value)}
                maxVisible={6}
              />
              <span>{participants.length} משתתפים</span>
            </div>
          ) : null}
          {participantsExpanded ? <ParticipantRows participants={participants} /> : null}
        </div>
        <div className="reserve-actions reserve-actions-details">
          {onRespondParticipation && currentParticipantStatus && currentParticipantStatus !== "declined" ? (
            <div className="reservation-response-actions">
              {currentParticipantStatus === "pending" ? (
                <button className="primary" type="button" onClick={() => onRespondParticipation("approved")}>אישור השתתפות</button>
              ) : null}
              <button className="secondary danger" type="button" onClick={() => onRespondParticipation("declined")}>דחיית השתתפות</button>
            </div>
          ) : null}
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
            <a className="icon-button contact email" href={ownerLinks.emailHref} aria-label="שליחת אימייל">
              <EmailRoundedIcon fontSize="small" />
            </a>
            {ownerLinks.telHref ? (
              <a className="icon-button contact" href={ownerLinks.telHref} aria-label="התקשר">
                <PhoneInTalkRoundedIcon fontSize="small" />
              </a>
            ) : (
              <button className="icon-button contact" type="button" aria-label="אין טלפון" disabled>
                <PhoneInTalkRoundedIcon fontSize="small" />
              </button>
            )}

            {ownerLinks.whatsappHref ? (
              <a
                className="icon-button contact whatsapp"
                href={ownerLinks.whatsappHref}
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
