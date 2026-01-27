import type { RefCallback } from "react";
import type { User } from "../../types/auth";
import LoginCard from "../../components/LoginCard";

export type LoginScreenProps = {
  user: User | null;
  authError: string;
  onSignOut: () => void;
  onDevLogin: (user: User) => void;
  setAuthError: (message: string) => void;
  googleButtonRef: RefCallback<HTMLDivElement>;
  clientId?: string;
  devLoginEnabled: boolean;
};

export default function LoginScreen({
  user,
  authError,
  onSignOut,
  onDevLogin,
  setAuthError,
  googleButtonRef,
  clientId,
  devLoginEnabled
}: LoginScreenProps) {
  return (
    <header className="hero">
      <div>
        <p className="eyebrow">רימון בית ספר למוזיקה</p>
        <h1>שיבוץ חדרים</h1>
        <p className="subtitle">צפייה מהירה בשיעורים, חדרים פנויים ושמירה בלחיצה.</p>
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
    </header>
  );
}
