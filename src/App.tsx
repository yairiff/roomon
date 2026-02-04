import { useEffect, useMemo, useState } from "react";
import HomeScreen from "./screens/home/HomeScreen";
import { useAuth } from "./hooks/useAuth";
import { useReservations, type ReservationsWindow } from "./hooks/useReservations";
import TopBar from "./components/TopBar";
import AuthMenu from "./components/AuthMenu";
import BottomNav from "./components/BottomNav";
import type { TopBarContext } from "./types/ui";
import LoginOverlay from "./components/LoginOverlay";
import type { ViewMode } from "./types/ui";
import AdminScreen from "./screens/admin/AdminScreen";
import SignupOverlay from "./components/SignupOverlay";
import { addDays, formatDateKey, getWeekStart } from "./lib/date";
import { weekDays } from "./config";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const DEV_LOGIN_ENABLED = import.meta.env.VITE_ENABLE_DEV_LOGIN === "true";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default function App() {
  const {
    user,
    setUser,
    authError,
    setAuthError,
    googleButtonRef,
    signOut
  } = useAuth({ clientId: CLIENT_ID });
  const [reservationsWindow, setReservationsWindow] = useState<ReservationsWindow>(() => {
    const todayKey = formatDateKey(new Date());
    const weekStart = getWeekStart(todayKey);
    const startKey = formatDateKey(weekStart);
    const endKey = formatDateKey(addDays(weekStart, weekDays.length - 1));
    return { startDate: startKey, endDate: endKey };
  });
  const { reservationMap, addReservation, upsertReservation, releaseReservation } = useReservations(reservationsWindow);
  const [authOpen, setAuthOpen] = useState(false);
  const [topBar, setTopBar] = useState<TopBarContext>({ title: "עכשיו" });
  const [loginPromptOpen, setLoginPromptOpen] = useState(true);
  const [requestedView, setRequestedView] = useState<ViewMode | null>(null);
  const [view, setView] = useState<ViewMode>("live");
  const isAdminRoute = window.location.pathname.startsWith("/admin");
  const needsSignup = Boolean(user && user.role === "pending");
  const [adminMode, setAdminMode] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);

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

  useEffect(() => {
    const mq = window.matchMedia?.("(display-mode: standalone)");
    const update = () => {
      const nav = navigator as unknown as { standalone?: boolean };
      setIsStandalone(Boolean(mq?.matches || nav.standalone));
    };
    update();
    mq?.addEventListener?.("change", update);
    return () => mq?.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    const handleBeforeInstall = (event: Event) => {
      (event as unknown as { preventDefault?: () => void }).preventDefault?.();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", handleBeforeInstall as EventListener);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall as EventListener);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    try {
      await installPrompt.userChoice;
    } finally {
      setInstallPrompt(null);
    }
  };

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

  useEffect(() => {
    const canAdmin = user?.role === "admin" || user?.role === "moderator";
    if (!canAdmin) {
      setAdminMode(false);
    }
  }, [user?.role]);

  if (isAdminRoute) {
    return (
      <div className="page admin-page-shell" dir="rtl">
        <AdminScreen currentUser={user} onSignOut={handleSignOut} />
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
        <SignupOverlay
          open={needsSignup}
          user={user}
          onSignOut={signOut}
        />
      </div>
    );
  }

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
        onOpenMySchedule={() => setRequestedView("mySchedule")}
        adminMode={adminMode}
        onToggleAdminMode={() => setAdminMode((prev) => !prev)}
        installAvailable={Boolean(installPrompt)}
        isStandalone={isStandalone}
        onInstall={() => { void handleInstall(); }}
      />
      <main className={`app-content${user ? "" : " no-nav"}`}>
        <HomeScreen
          currentUser={user}
          setAuthError={(message) => setAuthError(message)}
          onContextChange={setTopBar}
          onReservationWindowChange={setReservationsWindow}
          reservationMap={reservationMap}
          addReservation={addReservation}
          upsertReservation={upsertReservation}
          releaseReservation={releaseReservation}
          view={view}
          onViewChange={setView}
          requestedView={requestedView}
          onRequestedViewHandled={() => setRequestedView(null)}
          adminMode={adminMode}
        />
      </main>
      {user ? <BottomNav view={view} onChange={setView} locked={!user.allowed} /> : null}
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
      <SignupOverlay
        open={needsSignup}
        user={user}
        onSignOut={signOut}
      />
    </div>
  );
}
