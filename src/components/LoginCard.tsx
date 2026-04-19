import { useState, type FormEvent, type RefCallback } from "react";
import type { User } from "../types/auth";

export type LoginCardProps = {
  user: User | null;
  authError: string;
  onSignOut: () => void;
  onDevLogin: (user: User) => void;
  setAuthError: (message: string) => void;
  googleButtonRef: RefCallback<HTMLDivElement>;
  clientId?: string;
  devLoginEnabled: boolean;
  flat?: boolean;
  showTitle?: boolean;
};

export default function LoginCard({
  user,
  authError,
  onSignOut,
  onDevLogin,
  setAuthError,
  googleButtonRef,
  clientId,
  devLoginEnabled,
  flat = false,
  showTitle = true
}: LoginCardProps) {
  return (
    <div className={`auth-card${flat ? " flat" : ""}`} id="auth-card">
      {showTitle ? <h2>כניסה למערכת</h2> : null}
      {user ? (
        <div className="user-row">
          <div className="user-info">
            <p className="user-name">{user.name}</p>
            <p className="user-email">{user.email}</p>
          </div>
          <button className="primary" onClick={onSignOut} type="button">התנתק</button>
        </div>
      ) : (
        <>
          {!clientId && (
            <p className="notice">
              יש להוסיף <code>.env</code> עם <code>VITE_GOOGLE_CLIENT_ID</code> כדי לאפשר התחברות.
            </p>
          )}
          {clientId ? <div ref={googleButtonRef} className="google-button" /> : null}
          {devLoginEnabled ? <DevLogin onLogin={onDevLogin} setAuthError={setAuthError} /> : null}
        </>
      )}
      {authError ? <p className="error">{authError}</p> : null}
    </div>
  );
}

type DevLoginProps = {
  onLogin: (user: User) => void;
  setAuthError: (message: string) => void;
};

function DevLogin({ onLogin, setAuthError }: DevLoginProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email) return;
    setAuthError("");
    onLogin({ name: name || "משתמש", email, allowed: true, role: "student" });
  };

  return (
    <form className="dev-login" onSubmit={handleSubmit}>
      <p className="dev-label">כניסה למפתחים</p>
      <input
        type="email"
        placeholder="student@rimon.ac.il"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
      />
      <input
        type="text"
        placeholder="שם"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <button className="secondary" type="submit">התחבר</button>
    </form>
  );
}
