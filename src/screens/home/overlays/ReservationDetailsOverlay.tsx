import PersonAddAltRoundedIcon from "@mui/icons-material/PersonAddAltRounded";
import { useState } from "react";
import ContactActionButtons from "../../../components/ContactActionButtons";
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
  joinRequestState?: "available" | "pending";
  onJoinRequest?: () => void;
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
  joinRequestState,
  onJoinRequest,
  onClose
}: ReservationDetailsOverlayProps) {
  const [zoomOpen, setZoomOpen] = useState(false);
  const [participantsExpanded, setParticipantsExpanded] = useState(false);

  if (!open) return null;

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
              <button className="secondary danger" type="button" onClick={() => onRespondParticipation("declined")}>דחיית השתתפות</button>
            </div>
          ) : null}
          {onJoinRequest && joinRequestState ? (
            <button
              type="button"
              className="secondary reserve-pin-action"
              aria-label={joinRequestState === "pending" ? "בקשת ההצטרפות ממתינה לאישור" : "בקשת הצטרפות לשריון"}
              onClick={onJoinRequest}
              disabled={joinRequestState === "pending"}
            >
              <PersonAddAltRoundedIcon fontSize="small" />
              <span>{joinRequestState === "pending" ? "ממתין לאישור" : "הצטרף"}</span>
            </button>
          ) : null}

          <ContactActionButtons email={email} phone={phone} label={name || email} />
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
