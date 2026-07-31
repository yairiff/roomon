import PersonAddAltRoundedIcon from "@mui/icons-material/PersonAddAltRounded";
import PersonRemoveRoundedIcon from "@mui/icons-material/PersonRemoveRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import { useEffect, useState } from "react";
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
  onCancelJoinRequest?: () => void;
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
  onCancelJoinRequest,
  onClose
}: ReservationDetailsOverlayProps) {
  const [zoomOpen, setZoomOpen] = useState(false);
  const [participantsExpanded, setParticipantsExpanded] = useState(false);

  useEffect(() => {
    if (!open) return;
    setZoomOpen(false);
    setParticipantsExpanded(false);
  }, [dateLine, email, open, timeLine]);

  if (!open) return null;

  const visibleParticipants = participants.filter((participant) => participant.status !== "declined");
  const hasMultipleParticipants = visibleParticipants.length > 1;
  const canRespondParticipation = Boolean(
    onRespondParticipation && currentParticipantStatus && currentParticipantStatus !== "declined"
  );
  const hasJoinAction = Boolean(onJoinRequest && joinRequestState);
  const showGeneralContactActions = !hasMultipleParticipants;
  const showFooterActions = canRespondParticipation || hasJoinAction || showGeneralContactActions;

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
          {hasMultipleParticipants ? (
            <button
              type="button"
              className={`reservation-participant-summary${participantsExpanded ? " expanded" : ""}`}
              aria-expanded={participantsExpanded}
              onClick={() => setParticipantsExpanded((value) => !value)}
            >
              <span className="reservation-participant-count">{visibleParticipants.length} משתתפים</span>
              <ParticipantAvatarStack
                participants={visibleParticipants}
                maxVisible={6}
              />
              <ExpandMoreRoundedIcon className="reservation-participant-chevron" fontSize="small" />
            </button>
          ) : null}
          {participantsExpanded ? <ParticipantRows participants={visibleParticipants} /> : null}
        </div>
        {showFooterActions ? <div className="reserve-actions reserve-actions-details">
          {canRespondParticipation ? (
            <div className="reservation-response-actions">
              <button className="secondary danger" type="button" onClick={() => onRespondParticipation?.("declined")}>דחיית השתתפות</button>
            </div>
          ) : null}
          {onJoinRequest && joinRequestState ? (
            <button
              type="button"
              className={`secondary reserve-pin-action${joinRequestState === "pending" ? " danger" : ""}`}
              aria-label={joinRequestState === "pending" ? "ביטול בקשת הצטרפות" : "בקשת הצטרפות לשריון"}
              onClick={joinRequestState === "pending" ? onCancelJoinRequest : onJoinRequest}
              disabled={joinRequestState === "pending" && !onCancelJoinRequest}
            >
              {joinRequestState === "pending" ? <PersonRemoveRoundedIcon fontSize="small" /> : <PersonAddAltRoundedIcon fontSize="small" />}
              <span>{joinRequestState === "pending" ? "ביטול בקשת הצטרפות" : "הצטרף"}</span>
            </button>
          ) : null}

          {showGeneralContactActions ? <ContactActionButtons email={email} phone={phone} label={name || email} /> : null}
        </div> : null}
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
