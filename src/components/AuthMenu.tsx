import { useEffect, useMemo, useState } from "react";
import type { User } from "../types/auth";
import { BookmarkIcon, AdminIcon, ShortcutIcon } from "./Icons";

export type AuthMenuProps = {
  user: User | null;
  open: boolean;
  onClose: () => void;
  onSignOut: () => void;
  onLoginClick: () => void;
  reservationsCount?: number;
  onOpenReservations?: () => void;
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
  reservationsCount = 0,
  onOpenReservations,
  adminMode = false,
  onToggleAdminMode,
  installAvailable = false,
  isStandalone = false,
  onInstall
}: AuthMenuProps) {
  if (!open) return null;

  const [installHelpOpen, setInstallHelpOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setInstallHelpOpen(false);
  }, [open]);

  const installHint = useMemo(() => {
    const ua = navigator.userAgent || "";
    const isIOS = /iPad|iPhone|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    if (isIOS) {
      return 'ב־Safari: לחצו על "שיתוף" ואז "הוספה למסך הבית".';
    }
    if (isAndroid) {
      return 'ב־Chrome/Edge: תפריט ⋮ ואז "הוספה למסך הבית".';
    }
    return 'בדפדפן: תפריט ואז "הוספה למסך הבית" / "Install app".';
  }, []);

  const handleInstall = () => {
    if (isStandalone) return;
    if (installAvailable && onInstall) {
      onInstall();
      return;
    }
    setInstallHelpOpen((prev) => !prev);
  };

  return (
    <div className="auth-overlay" onClick={onClose}>
      <div className="auth-menu" onClick={(event) => event.stopPropagation()}>
        {user ? (
          <>
            <div className="auth-user">
              <p>{user.name}</p>
              <span>{user.email}</span>
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
                onOpenReservations?.();
                onClose();
              }}
            >
              <BookmarkIcon />
              <span>השעות שלי</span>
              {reservationsCount > 0 ? (
                <span className="auth-reservations-count">{reservationsCount}</span>
              ) : null}
            </button>
            {!isStandalone ? (
              <>
                <button
                  className="secondary auth-install-button"
                  type="button"
                  onClick={handleInstall}
                >
                  <ShortcutIcon />
                  <span>הוספה למסך הבית</span>
                </button>
                {installHelpOpen && !installAvailable ? (
                  <div className="auth-install-hint">{installHint}</div>
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
                  <span>הוספה למסך הבית</span>
                </button>
                {installHelpOpen && !installAvailable ? (
                  <div className="auth-install-hint">{installHint}</div>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
