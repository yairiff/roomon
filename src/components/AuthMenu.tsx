import { useEffect, useMemo, useState } from "react";
import type { User } from "../types/auth";
import { BookmarkIcon, AdminIcon, ShortcutIcon, CalendarIcon } from "./Icons";

export type AuthMenuProps = {
  user: User | null;
  open: boolean;
  onClose: () => void;
  onSignOut: () => void;
  onLoginClick: () => void;
  onOpenMySchedule?: () => void;
  adminMode?: boolean;
  onToggleAdminMode?: () => void;
  installAvailable?: boolean;
  isStandalone?: boolean;
  onInstall?: () => void;
};

export default function AuthMenu({
  user,
  open,
  onClose,
  onSignOut,
  onLoginClick,
  onOpenMySchedule,
  adminMode = false,
  onToggleAdminMode,
  installAvailable = false,
  isStandalone = false,
  onInstall
}: AuthMenuProps) {
  if (!open) return null;

  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);

  const ua = typeof navigator !== "undefined" ? (navigator.userAgent || "") : "";
  const isIOS = /iPad|iPhone|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);

  useEffect(() => {
    if (!open) return;
    setInstallHelpOpen(false);
    setZoomOpen(false);
  }, [open]);

  const installHintTitle = useMemo(() => {
    if (isIOS) return "הוספה למסך הבית (iPhone/iPad)";
    if (isAndroid) return "התקנה (Android)";
    return "התקנה";
  }, [isAndroid, isIOS]);

  const installHintBody = useMemo(() => {
    if (isIOS) {
      return [
        'לחצו על כפתור "שיתוף" (ריבוע עם חץ למעלה).',
        'בחרו "הוספה למסך הבית".',
        "אשרו."
      ];
    }
    if (isAndroid) {
      return [
        'פתחו את תפריט הדפדפן (⋮).',
        'בחרו "התקנת אפליקציה" או "הוספה למסך הבית".',
        "אשרו."
      ];
    }
    return ['פתחו את תפריט הדפדפן.', 'בחרו "Install app" / "הוספה למסך הבית".'];
  }, [isAndroid, isIOS]);

  const handleInstall = () => {
    if (isStandalone) return;
    if (installAvailable && onInstall) {
      onInstall();
      onClose();
      return;
    }
    setInstallHelpOpen((prev) => !prev);
  };

  const pictureUrl = (user?.picture || "").trim();
  const initials = (() => {
    const source = (user?.name || "").trim() || (user?.email || "").trim();
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
    <div className="auth-overlay" onClick={handleBackdropClick}>
      <div className="auth-menu" onClick={(event) => event.stopPropagation()}>
        {user ? (
          <>
            <div className="auth-user">
              <button
                type="button"
                className={`auth-user-avatar${pictureUrl ? " clickable" : ""}`}
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
              <p className="auth-user-name">{user.name}</p>
              <span className="auth-user-email">{user.email}</span>
            </div>
            {user.role === "admin" ? (
              <div className="auth-admin-row">
                <button
                  className="secondary auth-admin-button"
                  type="button"
                  onClick={() => {
                    window.location.href = "/admin";
                  }}
                >
                  <span className="auth-admin-label">
                    <AdminIcon />
                    <span>דשבורד ניהול</span>
                  </span>
                  <span
                    className="auth-admin-switch"
                    role="button"
                    tabIndex={0}
                    aria-pressed={adminMode}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleAdminMode?.();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        onToggleAdminMode?.();
                      }
                    }}
                  >
                    <span className={`toggle-switch${adminMode ? " on" : ""}`}>
                      <span className="toggle-dot" />
                    </span>
                    <small>מצב עריכה</small>
                  </span>
                </button>
              </div>
            ) : null}
            {user.role === "moderator" ? (
              <div className="auth-admin-row">
                <button
                  className="secondary auth-admin-button"
                  type="button"
                  onClick={() => onToggleAdminMode?.()}
                >
                  <span className="auth-admin-label">
                    <AdminIcon />
                    <span>מצב עריכה</span>
                  </span>
                  <span
                    className="auth-admin-switch"
                    role="button"
                    tabIndex={0}
                    aria-pressed={adminMode}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleAdminMode?.();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        onToggleAdminMode?.();
                      }
                    }}
                  >
                    <span className={`toggle-switch${adminMode ? " on" : ""}`}>
                      <span className="toggle-dot" />
                    </span>
                    <small>מצב עריכה</small>
                  </span>
                </button>
              </div>
            ) : null}
            <button
              className="secondary auth-reservations-button"
              type="button"
              onClick={() => {
                onOpenMySchedule?.();
                onClose();
              }}
            >
              <CalendarIcon />
              <span>המערכת שלי</span>
            </button>
            {!isStandalone ? (
              <>
                <button
                  className="secondary auth-install-button"
                  type="button"
                  onClick={handleInstall}
                >
                  <ShortcutIcon />
                  <span>{installAvailable ? "התקן אפליקציה" : "הוספה למסך הבית"}</span>
                </button>
                {installHelpOpen && !installAvailable ? (
                  <div className="auth-install-hint" role="note" aria-label="התקנה">
                    <div className="auth-install-hint-title">{installHintTitle}</div>
                    <ol className="auth-install-hint-steps">
                      {installHintBody.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ol>
                    {isIOS ? (
                      <div className="auth-install-hint-foot">
                        אם לא מופיע, ודאו שאתם לא במצב גלישה פרטית.
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
            <button className="primary" onClick={onSignOut} type="button">התנתק</button>
          </>
        ) : (
          <>
            <p>התחבר כדי לשריין חדרים</p>
            <button className="primary" onClick={onLoginClick} type="button">התחברות</button>
            {!isStandalone ? (
              <>
                <button className="secondary auth-install-button" type="button" onClick={handleInstall}>
                  <ShortcutIcon />
                  <span>{installAvailable ? "התקן אפליקציה" : "הוספה למסך הבית"}</span>
                </button>
                {installHelpOpen && !installAvailable ? (
                  <div className="auth-install-hint" role="note" aria-label="התקנה">
                    <div className="auth-install-hint-title">{installHintTitle}</div>
                    <ol className="auth-install-hint-steps">
                      {installHintBody.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ol>
                    {isIOS ? (
                      <div className="auth-install-hint-foot">
                        אם לא מופיע, ודאו שאתם לא במצב גלישה פרטית.
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        )}
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
