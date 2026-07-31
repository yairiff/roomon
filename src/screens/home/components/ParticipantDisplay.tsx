import EmailRoundedIcon from "@mui/icons-material/EmailRounded";
import PhoneInTalkRoundedIcon from "@mui/icons-material/PhoneInTalkRounded";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import { getContactLinks } from "../../../lib/contactLinks";
import type { ReservationParticipantStatus } from "../../../types/reservations";

export type ParticipantDisplayEntry = {
  email: string;
  name: string;
  phone?: string;
  pictureUrl?: string;
  status: ReservationParticipantStatus;
};

const initialsFromLabel = (label: string) => {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  return (parts[0] || "?").slice(0, 2).toUpperCase();
};

const statusLabel = (status: ReservationParticipantStatus) => {
  if (status === "declined") return "נדחה";
  return "משתתף";
};

export function ParticipantAvatarStack({
  participants,
  compact = false,
  interactive = false,
  expanded = false,
  onClick,
  maxVisible = 4,
  className = ""
}: {
  participants: ParticipantDisplayEntry[];
  compact?: boolean;
  interactive?: boolean;
  expanded?: boolean;
  onClick?: () => void;
  maxVisible?: number;
  className?: string;
}) {
  const approved = participants.filter((participant) => participant.status !== "declined");
  if (!approved.length) return null;
  const visible = approved.slice(0, maxVisible);
  const hiddenCount = Math.max(0, approved.length - visible.length);
  const content = (
    <>
      {visible.map((participant, index) => (
        <span
          key={`participant-avatar-${participant.email}`}
          className="participant-avatar-stack-item"
          style={{ zIndex: index + 1 }}
          title={participant.name || participant.email}
        >
          {participant.pictureUrl ? (
            <img src={participant.pictureUrl} alt="" loading="lazy" />
          ) : (
            <span>{initialsFromLabel(participant.name || participant.email)}</span>
          )}
        </span>
      ))}
      {hiddenCount > 0 ? <span className="participant-avatar-stack-more">+{hiddenCount}</span> : null}
    </>
  );
  const classes = `participant-avatar-stack${compact ? " compact" : ""}${expanded ? " expanded" : ""}${className ? ` ${className}` : ""}`;
  return interactive ? (
    <button type="button" className={classes} onClick={onClick} aria-expanded={expanded} aria-label="הצגת משתתפים">
      {content}
    </button>
  ) : (
    <span className={classes} aria-label="משתתפים">
      {content}
    </span>
  );
}

export function ParticipantRows({ participants }: { participants: ParticipantDisplayEntry[] }) {
  const visible = participants.filter((participant) => participant.status !== "declined");
  if (!visible.length) return null;
  return (
    <div className="reservation-participants">
      {visible.map((participant) => {
        const label = (participant.name || "").trim() || participant.email;
        const links = getContactLinks(participant.email, participant.phone);
        return (
          <div key={`reservation-participant-${participant.email}`} className="reservation-participant-row">
            <span className="groups-chat-avatar reservation-participant-avatar" aria-hidden="true">
              {participant.pictureUrl ? <img src={participant.pictureUrl} alt="" loading="lazy" /> : initialsFromLabel(label)}
            </span>
            <span className="reservation-participant-text">
              <span className="groups-chat-title">{label}</span>
              <span className="groups-chat-subtitle">{participant.phone || participant.email}</span>
              <span className={`participant-status ${participant.status}`}>{statusLabel(participant.status)}</span>
            </span>
            <span className="reserve-contact-actions reservation-participant-actions" aria-label="יצירת קשר">
              <a className="icon-button contact email" href={links.emailHref} aria-label={`שליחת אימייל אל ${label}`}>
                <EmailRoundedIcon fontSize="small" />
              </a>
              {links.telHref ? (
                <a className="icon-button contact" href={links.telHref} aria-label={`התקשר אל ${label}`}>
                  <PhoneInTalkRoundedIcon fontSize="small" />
                </a>
              ) : (
                <button className="icon-button contact" type="button" aria-label="אין טלפון" disabled>
                  <PhoneInTalkRoundedIcon fontSize="small" />
                </button>
              )}
              {links.whatsappHref ? (
                <a className="icon-button contact whatsapp" href={links.whatsappHref} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${label}`}>
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
  );
}
