import type { User } from "../types/auth";
import { useEffect, useState, type ReactNode } from "react";
import { UserIcon } from "./Icons";
import logoUrl from "../logo.png";

export type TopBarProps = {
  user: User | null;
  onAuthClick: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  subtitleOptions?: { value: string; label: string }[];
  onSubtitleChange?: (value: string) => void;
  navLabel?: string;
  onPrev?: () => void;
  onNext?: () => void;
  controls?: ReactNode;
};

export default function TopBar({
  user,
  onAuthClick,
  subtitle,
  subtitleOptions,
  onSubtitleChange
}: TopBarProps) {
  const hasSubtitleOptions = Boolean(subtitleOptions?.length);
  const subtitleNode =
    typeof subtitle === "string" ? <p className="top-bar-subtitle">{subtitle}</p> : subtitle;
  const showSubtitle = Boolean(subtitleNode);
  const [avatarError, setAvatarError] = useState(false);

  useEffect(() => {
    setAvatarError(false);
  }, [user?.picture]);

  const showAvatarImage = Boolean(user?.picture) && !avatarError;
  const fallbackInitial = user?.name?.trim().charAt(0) || "?";
  return (
    <header className="top-bar">
      <div className="top-bar-head">
        <img className="top-bar-logo" src={logoUrl} alt="רימון" />
        <button className="avatar-button" onClick={onAuthClick} aria-label="User">
          {showAvatarImage ? (
            <img
              src={user?.picture}
              alt={user?.name || "User"}
              onError={() => setAvatarError(true)}
            />
          ) : user ? (
            <span>{fallbackInitial}</span>
          ) : (
            <UserIcon />
          )}
        </button>
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
