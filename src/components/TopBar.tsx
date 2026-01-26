import type { User } from "../types/auth";
import type { ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon, UserIcon } from "./Icons";
import logoUrl from "../logo.jpg";

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
  title,
  subtitle,
  subtitleOptions,
  onSubtitleChange,
  navLabel,
  onPrev,
  onNext,
  controls
}: TopBarProps) {
  const hasSubtitleOptions = Boolean(subtitleOptions?.length);
  const showNav = Boolean(navLabel || controls || onPrev || onNext);
  const titleNode =
    typeof title === "string" ? <h1>{title}</h1> : <div className="top-bar-line">{title}</div>;
  const subtitleNode =
    typeof subtitle === "string" ? <p className="top-bar-subtitle">{subtitle}</p> : subtitle;
  const showSubtitle = Boolean(subtitleNode);
  return (
    <header className="top-bar">
      <div className="top-bar-brand">
        <img className="top-bar-logo" src={logoUrl} alt="רימון" />
      </div>
      <div className="top-bar-content">
        <div className="top-bar-title">
          {titleNode}
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
        </div>
        {showNav ? (
          <div className="top-bar-nav">
            {onPrev ? (
              <button className="icon-button" type="button" onClick={onPrev} aria-label="הקודם">
                <ChevronRightIcon />
              </button>
            ) : null}
            {navLabel ? <span className="top-bar-context">{navLabel}</span> : null}
            {onNext ? (
              <button className="icon-button" type="button" onClick={onNext} aria-label="הבא">
                <ChevronLeftIcon />
              </button>
            ) : null}
            {controls ? <div className="top-bar-controls">{controls}</div> : null}
          </div>
        ) : null}
      </div>
      <button className="avatar-button" onClick={onAuthClick} aria-label="User">
        {user?.picture ? (
          <img src={user.picture} alt={user.name} />
        ) : user ? (
          <span>{user.name.charAt(0)}</span>
        ) : (
          <UserIcon />
        )}
      </button>
      {showSubtitle ? <div className="top-bar-subtitle-row">{subtitleNode}</div> : null}
    </header>
  );
}
