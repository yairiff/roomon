import type { User } from "../types/auth";
import { BookmarkIcon } from "./Icons";

export type AuthMenuProps = {
  user: User | null;
  open: boolean;
  onClose: () => void;
  onSignOut: () => void;
  onLoginClick: () => void;
  reservationsCount?: number;
  onOpenReservations?: () => void;
};

export default function AuthMenu({
  user,
  open,
  onClose,
  onSignOut,
  onLoginClick,
  reservationsCount = 0,
  onOpenReservations
}: AuthMenuProps) {
  if (!open) return null;
  return (
    <div className="auth-overlay" onClick={onClose}>
      <div className="auth-menu" onClick={(event) => event.stopPropagation()}>
        {user ? (
          <>
            <div className="auth-user">
              <p>{user.name}</p>
              <span>{user.email}</span>
            </div>
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
            <button className="primary" onClick={onSignOut} type="button">התנתק</button>
          </>
        ) : (
          <>
            <p>התחבר כדי לשריין חדרים</p>
            <button className="primary" onClick={onLoginClick} type="button">התחברות</button>
          </>
        )}
      </div>
    </div>
  );
}
