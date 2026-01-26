import type { RefCallback } from "react";
import type { User } from "../types/auth";
import LoginCard from "./LoginCard";
import { CloseIcon } from "./Icons";

export type LoginOverlayProps = {
  open: boolean;
  onClose: () => void;
  user: User | null;
  authError: string;
  onSignOut: () => void;
  onDevLogin: (user: User) => void;
  setAuthError: (message: string) => void;
  googleButtonRef: RefCallback<HTMLDivElement>;
  clientId?: string;
  devLoginEnabled: boolean;
};

export default function LoginOverlay({
  open,
  onClose,
  user,
  authError,
  onSignOut,
  onDevLogin,
  setAuthError,
  googleButtonRef,
  clientId,
  devLoginEnabled
}: LoginOverlayProps) {
  if (!open) return null;
  return (
    <div className="login-overlay" onClick={onClose}>
      <div className="login-modal" onClick={(event) => event.stopPropagation()}>
        <button className="icon-button login-close" type="button" onClick={onClose} aria-label="סגירה">
          <CloseIcon />
        </button>
        <div className="login-copy">
          <p className="login-eyebrow">רימון בית ספר למוזיקה</p>
          <h2>התחבר כדי לשריין חדרים</h2>
          <p className="login-subtitle">ניתן להיכנס עם חשבון גוגל אישי של הסטודנטים.</p>
        </div>
        <LoginCard
          user={user}
          authError={authError}
          onSignOut={onSignOut}
          onDevLogin={onDevLogin}
          setAuthError={setAuthError}
          googleButtonRef={googleButtonRef}
          clientId={clientId}
          devLoginEnabled={devLoginEnabled}
        />
      </div>
    </div>
  );
}
