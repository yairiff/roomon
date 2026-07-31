import type { User } from "../types/auth";
import { useEffect, useState, type ReactNode } from "react";
import { UserIcon } from "./Icons";
import logoUrl from "../logo.png";

export type TopBarProps = {
  user: User | null;
  onAuthClick: () => void;
  onIconClick?: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  subtitleOptions?: { value: string; label: string }[];
  onSubtitleChange?: (value: string) => void;
  navLabel?: string;
  onPrev?: () => void;
  onNext?: () => void;
  controls?: ReactNode;
  notificationCount?: number;
};

export default function TopBar({
  user,
  onAuthClick,
  onIconClick,
  title,
  subtitle,
  subtitleOptions,
  onSubtitleChange,
  notificationCount = 0
}: TopBarProps) {
  const hasSubtitleOptions = Boolean(subtitleOptions?.length);
  const subtitleNode =
    typeof subtitle === "string" ? <p className="top-bar-subtitle">{subtitle}</p> : subtitle;
  const showSubtitle = Boolean(subtitleNode);
  const compactTitle =
    typeof title === "string" || typeof title === "number" ? String(title).trim() : "";
  const liveMode = compactTitle.length === 0;
  const [avatarError, setAvatarError] = useState(false);

  useEffect(() => {
    setAvatarError(false);
  }, [user?.picture]);

  const showAvatarImage = Boolean(user?.picture) && !avatarError;
  const fallbackInitials = (() => {
    const name = (user?.name || "").trim();
    if (!name) return "?";
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  })();
  return (
    <header className={`top-bar ${liveMode ? "live-mode" : "page-mode"}`}>
      <div className="top-bar-head">
        <div className="top-bar-head-side top-bar-head-side-start">
          <button className="avatar-button" onClick={onAuthClick} aria-label="User">
            {showAvatarImage ? (
              <img
                src={user?.picture}
                alt={user?.name || "User"}
                loading="lazy"
                onError={() => setAvatarError(true)}
              />
            ) : user ? (
              <span>{fallbackInitials}</span>
            ) : (
              <UserIcon />
            )}
            {notificationCount > 0 ? (
              <span className="nav-badge topbar-notification-badge">{notificationCount > 99 ? "99+" : notificationCount}</span>
            ) : null}
          </button>
        </div>
        <div className="top-bar-head-main" aria-label="כותרת">
          {liveMode ? (
            <img className="top-bar-logo" src={logoUrl} alt="רימון" />
          ) : (
            <h1 className="top-bar-title-text">{compactTitle}</h1>
          )}
        </div>
        <div className="top-bar-head-side top-bar-head-side-end" aria-hidden={liveMode}>
          {!liveMode ? (
            <button
              type="button"
              className="top-bar-app-icon-button"
              onClick={onIconClick}
              aria-label="מעבר ללייב"
            >
              <img className="top-bar-app-icon top-bar-app-icon-square" src="/logo-square.png" alt="" aria-hidden="true" />
            </button>
          ) : (
            <span className="top-bar-head-icon-placeholder" />
          )}
        </div>
      </div>
      {hasSubtitleOptions ? (
        <label className="top-bar-select">
          <span className="sr-only">חדר</span>
          <select
            value={subtitle ? String(subtitle) : ""}
            onChange={(event) => onSubtitleChange?.(event.target.value)}
          >
            {subtitleOptions?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {showSubtitle ? <div className="top-bar-slot">{subtitleNode}</div> : null}
    </header>
  );
}
