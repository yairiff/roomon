import PhoneInTalkRoundedIcon from "@mui/icons-material/PhoneInTalkRounded";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import { getContactLinks } from "../lib/contactLinks";
import GmailIcon from "./GmailIcon";

export default function ContactActionButtons({
  email,
  phone,
  label,
  className = "",
  showUnavailable = true
}: {
  email: string;
  phone?: string;
  label: string;
  className?: string;
  showUnavailable?: boolean;
}) {
  const links = getContactLinks(email, phone);
  const classes = `reserve-contact-actions${className ? ` ${className}` : ""}`;

  return (
    <span className={classes} aria-label="יצירת קשר">
      <a className="icon-button contact email gmail" href={links.emailHref} aria-label={`שליחת אימייל אל ${label}`}>
        <GmailIcon />
      </a>
      {links.whatsappHref ? (
        <a
          className="icon-button contact whatsapp"
          href={links.whatsappHref}
          target="_blank"
          rel="noreferrer"
          aria-label={`WhatsApp ${label}`}
        >
          <WhatsAppIcon fontSize="small" />
        </a>
      ) : showUnavailable ? (
        <button className="icon-button contact whatsapp" type="button" aria-label="אין WhatsApp" disabled>
          <WhatsAppIcon fontSize="small" />
        </button>
      ) : null}
      {links.telHref ? (
        <a className="icon-button contact phone" href={links.telHref} aria-label={`התקשר אל ${label}`}>
          <PhoneInTalkRoundedIcon fontSize="small" />
        </a>
      ) : showUnavailable ? (
        <button className="icon-button contact phone" type="button" aria-label="אין טלפון" disabled>
          <PhoneInTalkRoundedIcon fontSize="small" />
        </button>
      ) : null}
    </span>
  );
}
