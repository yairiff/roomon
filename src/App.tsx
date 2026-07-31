import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
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
import { db } from "./lib/firebase";
import { useScheduleSettings } from "./hooks/useScheduleSettings";
import { useNotifications } from "./hooks/useNotifications";
import type { NotificationResponseActions } from "./types/notifications";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const DEV_LOGIN_ENABLED = import.meta.env.VITE_ENABLE_DEV_LOGIN === "true";
const THEME_STORAGE_KEY = "rimon_theme_mode_v1";

type ThemeMode = "light" | "dark";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "light";
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return "light";
  });
  const darkMode = theme === "dark";

  const {
    user,
    setUser,
    authError,
    setAuthError,
    roleResolved,
    googleButtonRef,
    signOut,
    getGoogleIdToken
  } = useAuth({ clientId: CLIENT_ID, darkMode });
  const [reservationsWindow, setReservationsWindow] = useState<ReservationsWindow>(() => {
    const todayKey = formatDateKey(new Date());
    const weekStart = getWeekStart(todayKey);
    const startKey = formatDateKey(weekStart);
    const endKey = formatDateKey(addDays(weekStart, 6));
    return { startDate: startKey, endDate: endKey };
  });
  const [quotaReferenceDate, setQuotaReferenceDate] = useState(() => formatDateKey(new Date()));
  const { reservationMap, addReservation, upsertReservation, releaseReservation } = useReservations(reservationsWindow);
  const [authOpen, setAuthOpen] = useState(false);
  const [topBar, setTopBar] = useState<TopBarContext>({ title: "" });
  const [loginPromptOpen, setLoginPromptOpen] = useState(true);
  const [requestedView, setRequestedView] = useState<ViewMode | null>(null);
  const [view, setView] = useState<ViewMode>("live");
  const [groupsPendingCount, setGroupsPendingCount] = useState(0);
  const notificationInbox = useNotifications(user?.email);
  const notificationActionsRef = useRef<NotificationResponseActions | null>(null);
  const handleNotificationActionsChange = useCallback((actions: NotificationResponseActions | null) => {
    notificationActionsRef.current = actions;
  }, []);
  const [navReselect, setNavReselect] = useState<{ view: ViewMode; token: number }>({
    view: "live",
    token: 0
  });
  const isAdminRoute = window.location.pathname.startsWith("/admin");
  const [needsSignup, setNeedsSignup] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const peopleToolEnabled = user?.peopleToolEnabled === true;
  const collaborationEnabled = user?.betaUser === true || peopleToolEnabled;
  const { reservationPolicy, reservationPolicies } = useScheduleSettings();

  const reservationsCount = useMemo(() => {
    // Kept for potential future UI.
    if (!user) return 0;
    return Object.values(reservationMap).flatMap((entries) => entries).filter((entry) => entry.reservedEmail === user.email)
      .length;
  }, [reservationMap, user]);

  useEffect(() => {
    if (user) {
      setLoginPromptOpen(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (user.themePreference === "dark" || user.themePreference === "light") {
      setTheme(user.themePreference);
      return;
    }
    setTheme("light");
  }, [user?.email, user?.themePreference]);

  useEffect(() => {
    if (!user || !roleResolved || user.role !== "pending") {
      setNeedsSignup(false);
      return;
    }
    // Avoid brief signup flashes while auth role settles.
    const timer = window.setTimeout(() => setNeedsSignup(true), 180);
    return () => window.clearTimeout(timer);
  }, [user, roleResolved, user?.role]);

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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

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

  const handleBottomNavChange = (nextView: ViewMode) => {
    setView(nextView);
  };

  const handleBottomNavReselect = (nextView: ViewMode) => {
    setNavReselect((prev) => ({ view: nextView, token: prev.token + 1 }));
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

  const handleToggleDarkMode = async () => {
    const nextTheme: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);

    if (!user || !db) return;
    try {
      const email = user.email.toLowerCase();
      await setDoc(
        doc(db, "users", email),
        {
          email,
          themePreference: nextTheme,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
      setUser((prev) => (prev ? { ...prev, themePreference: nextTheme } : prev));
    } catch {
      // Keep local theme even if Firestore persistence fails.
    }
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
        onIconClick={() => setView("live")}
        title={topBar.title}
        subtitle={topBar.subtitle}
        subtitleOptions={topBar.subtitleOptions}
        onSubtitleChange={topBar.onSubtitleChange}
        navLabel={topBar.navLabel}
        onPrev={topBar.onPrev}
        onNext={topBar.onNext}
        controls={topBar.controls}
        notificationCount={notificationInbox.badgeCount}
      />
      <AuthMenu
        user={user}
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSignOut={handleSignOut}
        onLoginClick={handleLoginClick}
        getGoogleIdToken={getGoogleIdToken}
        onProfileUpdated={(updates) =>
          setUser((prev) => (prev ? { ...prev, ...updates } : prev))
        }
        adminMode={adminMode}
        onToggleAdminMode={() => setAdminMode((prev) => !prev)}
        darkMode={darkMode}
        onToggleDarkMode={() => { void handleToggleDarkMode(); }}
        installAvailable={Boolean(installPrompt)}
        isStandalone={isStandalone}
        onInstall={() => { void handleInstall(); }}
        reservationPolicy={reservationPolicy}
        reservationPolicies={reservationPolicies}
        reservationMap={reservationMap}
        quotaReferenceDate={quotaReferenceDate}
        notificationCount={notificationInbox.badgeCount}
        notifications={notificationInbox.notifications}
        notificationsReady={notificationInbox.ready}
        onNotificationsOpened={() => { void notificationInbox.markAllRead(); }}
        respondSharedReservation={(notification, status) => {
          notificationActionsRef.current?.respondSharedReservation(notification, status);
        }}
        respondRehearsal={(notification, status) => {
          notificationActionsRef.current?.respondRehearsal(notification, status);
        }}
        respondGroupInvite={(notification, accept) => {
          notificationActionsRef.current?.respondGroupInvite(notification, accept);
        }}
        respondReservationJoinRequest={(notification, accept) => {
          notificationActionsRef.current?.respondReservationJoinRequest(notification, accept);
        }}
      />
      <main className={`app-content${user ? "" : " no-nav"}`}>
        <HomeScreen
          currentUser={user}
          setAuthError={(message) => setAuthError(message)}
          onContextChange={setTopBar}
          onReservationWindowChange={setReservationsWindow}
          onQuotaReferenceDateChange={setQuotaReferenceDate}
          reservationMap={reservationMap}
          addReservation={addReservation}
          upsertReservation={upsertReservation}
          releaseReservation={releaseReservation}
          view={view}
          onViewChange={setView}
          requestedView={requestedView}
          onRequestedViewHandled={() => setRequestedView(null)}
          navReselectView={navReselect.view}
          navReselectToken={navReselect.token}
          adminMode={adminMode}
          collaborationEnabled={collaborationEnabled}
          peopleToolEnabled={peopleToolEnabled}
          onGroupsPendingCountChange={setGroupsPendingCount}
          resolveNotification={notificationInbox.resolve}
          onNotificationActionsChange={handleNotificationActionsChange}
        />
      </main>
      {user ? (
        <BottomNav
          view={view}
          onChange={handleBottomNavChange}
          onReselect={handleBottomNavReselect}
          locked={!user.allowed}
          showCollaborationTabs={collaborationEnabled}
          peopleToolEnabled={peopleToolEnabled}
          groupsBadgeCount={groupsPendingCount}
        />
      ) : null}
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
