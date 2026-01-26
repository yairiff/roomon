import { useEffect, useMemo, useState } from "react";
import BookingScreen from "./screens/BookingScreen";
import { useAuth } from "./hooks/useAuth";
import { useReservations } from "./hooks/useReservations";
import TopBar from "./components/TopBar";
import AuthMenu from "./components/AuthMenu";
import type { TopBarContext } from "./types/ui";
import LoginOverlay from "./components/LoginOverlay";
import type { ViewMode } from "./types/ui";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const DEV_LOGIN_ENABLED = import.meta.env.VITE_ENABLE_DEV_LOGIN === "true";

export default function App() {
  const {
    user,
    setUser,
    authError,
    setAuthError,
    googleButtonRef,
    signOut
  } = useAuth({ clientId: CLIENT_ID });
  const { reservationMap, addReservation, releaseReservation } = useReservations();
  const [authOpen, setAuthOpen] = useState(false);
  const [topBar, setTopBar] = useState<TopBarContext>({ title: "עכשיו" });
  const [loginPromptOpen, setLoginPromptOpen] = useState(true);
  const [requestedView, setRequestedView] = useState<ViewMode | null>(null);

  const reservationsCount = useMemo(() => {
    if (!user) return 0;
    return Object.entries(reservationMap)
      .flatMap(([dateKey, entries]) =>
        entries
          .filter((entry) => entry.reservedEmail === user.email)
          .map((entry) => entry.id)
      )
      .length;
  }, [reservationMap, user]);

  useEffect(() => {
    if (user) {
      setLoginPromptOpen(false);
    }
  }, [user]);

  const handleAuthClick = () => {
    setAuthOpen((open) => !open);
  };

  const handleLoginClick = () => {
    setAuthOpen(false);
    setLoginPromptOpen(true);
  };

  const handleSignOut = () => {
    setAuthOpen(false);
    signOut();
    setLoginPromptOpen(true);
  };

  return (
    <div className="page" dir="rtl">
      <TopBar
        user={user}
        onAuthClick={handleAuthClick}
        title={topBar.title}
        subtitle={topBar.subtitle}
        subtitleOptions={topBar.subtitleOptions}
        onSubtitleChange={topBar.onSubtitleChange}
        navLabel={topBar.navLabel}
        onPrev={topBar.onPrev}
        onNext={topBar.onNext}
        controls={topBar.controls}
      />
      <AuthMenu
        user={user}
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSignOut={handleSignOut}
        onLoginClick={handleLoginClick}
        reservationsCount={reservationsCount}
        onOpenReservations={() => setRequestedView("reservations")}
      />
      <main className={`app-content${user ? "" : " no-nav"}`}>
        <BookingScreen
          currentUser={user}
          setAuthError={(message) => setAuthError(message)}
          onContextChange={setTopBar}
          reservationMap={reservationMap}
          addReservation={addReservation}
          releaseReservation={releaseReservation}
          requestedView={requestedView}
          onRequestedViewHandled={() => setRequestedView(null)}
          showNav={Boolean(user)}
        />
      </main>
      <LoginOverlay
        open={!user && loginPromptOpen}
        onClose={() => setLoginPromptOpen(false)}
        user={user}
        authError={authError}
        onSignOut={signOut}
        onDevLogin={(nextUser) => setUser(nextUser)}
        setAuthError={(message) => setAuthError(message)}
        googleButtonRef={googleButtonRef}
        clientId={CLIENT_ID}
        devLoginEnabled={DEV_LOGIN_ENABLED}
      />
    </div>
  );
}
