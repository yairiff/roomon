import { useEffect, useMemo, useRef, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import type { User } from "../types/auth";
import type { ReservationPolicy, ReservationScopedPolicy } from "../types/settings";
import type { ReservationMap } from "../types/reservations";
import { db, functions } from "../lib/firebase";
import { isPersistentProfileUrl } from "../lib/profilePhoto";
import { addDays, formatDateKey, formatShortDate, getDayKeyFromDateKey, getWeekStart, parseDateKey } from "../lib/date";
import { getReservationUsageShareForEmail } from "../lib/quotaUsage";
import { AdminIcon, ShortcutIcon, DarkModeIcon, EditIcon, UploadIcon, UserIcon, ReleaseIcon, LogoutIcon, CloseIcon, CalendarIcon } from "./Icons";
import NotificationsRoundedIcon from "@mui/icons-material/NotificationsRounded";
import AdminPanelSettingsRoundedIcon from "@mui/icons-material/AdminPanelSettingsRounded";
import DataUsageRoundedIcon from "@mui/icons-material/DataUsageRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import type { AppNotification, NotificationResponseActions } from "../types/notifications";
import { NotificationsList } from "../screens/home/overlays/NotificationsOverlay";
import { getPeopleCategoryLabel } from "../lib/peopleDirectory";

export type AuthMenuProps = {
  user: User | null;
  open: boolean;
  onClose: () => void;
  onSignOut: () => void;
  onLoginClick: () => void;
  getGoogleIdToken?: () => string;
  onProfileUpdated?: (updates: Partial<User>) => void;
  onEditAvailability?: () => void;
  adminMode?: boolean;
  onToggleAdminMode?: () => void;
  darkMode?: boolean;
  onToggleDarkMode?: () => void;
  installAvailable?: boolean;
  isStandalone?: boolean;
  onInstall?: () => void;
  reservationPolicy?: ReservationPolicy;
  reservationPolicies?: ReservationScopedPolicy[];
  reservationMap?: ReservationMap;
  quotaReferenceDate?: string;
  notificationCount?: number;
  notifications?: AppNotification[];
  notificationsReady?: boolean;
  onNotificationsOpened?: () => void;
} & NotificationResponseActions;

export default function AuthMenu({
  user,
  open,
  onClose,
  onSignOut,
  onLoginClick,
  getGoogleIdToken,
  onProfileUpdated,
  onEditAvailability,
  adminMode = false,
  onToggleAdminMode,
  darkMode = false,
  onToggleDarkMode,
  installAvailable = false,
  isStandalone = false,
  onInstall,
  reservationPolicy,
  reservationPolicies = [],
  reservationMap = {},
  quotaReferenceDate,
  notificationCount = 0,
  notifications = [],
  notificationsReady = false,
  onNotificationsOpened,
  respondSharedReservation,
  respondRehearsal,
  respondGroupInvite,
  respondReservationJoinRequest
}: AuthMenuProps) {
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [profilePreview, setProfilePreview] = useState("");
  const [profileFile, setProfileFile] = useState<File | null>(null);
  const [profilePictureRemoved, setProfilePictureRemoved] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileStatus, setProfileStatus] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const profileFileInputRef = useRef<HTMLInputElement | null>(null);
  const notificationsOpenedRef = useRef(false);

  const ua = typeof navigator !== "undefined" ? (navigator.userAgent || "") : "";
  const isIOS = /iPad|iPhone|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);

  useEffect(() => {
    if (!open) {
      notificationsOpenedRef.current = false;
      return;
    }
    setInstallHelpOpen(false);
    setZoomOpen(false);
    setProfileOpen(false);
    if (user && !notificationsOpenedRef.current) {
      notificationsOpenedRef.current = true;
      onNotificationsOpened?.();
    }
  }, [onNotificationsOpened, open, user]);

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
  const profileCategoryLabel = user ? getPeopleCategoryLabel(user) : "";
  const quotaRows = useMemo(() => {
    if (!user || !reservationPolicy) return [];
    const email = user.email.toLowerCase();
    const now = new Date();
    const todayKey = formatDateKey(now);
    const tomorrowKey = formatDateKey(addDays(now, 1));
    const referenceDateKey =
      quotaReferenceDate && /^\d{4}-\d{2}-\d{2}$/.test(quotaReferenceDate) ? quotaReferenceDate : todayKey;
    const referenceDayKey = getDayKeyFromDateKey(referenceDateKey);
    const referenceStartMinutes = Math.max(
      0,
      Math.min(
        24 * 60 - 1,
        reservationPolicies.find((policy) => policy.isDefault)?.scope.startMinutes ?? 12 * 60
      )
    );
    let effectiveGlobalPolicy: ReservationPolicy = { ...reservationPolicy };
    let firstMatchedGlobalPolicy: ReservationScopedPolicy | null = null;
    reservationPolicies
      .filter((policy) => policy.enabled)
      .forEach((policy) => {
        if (policy.isDefault) {
          effectiveGlobalPolicy = {
            ...effectiveGlobalPolicy,
            ...(policy.rules as ReservationPolicy)
          };
          return;
        }
        if (policy.scope.roomIds.length) return;
        if (policy.scope.dayKeys.length && !policy.scope.dayKeys.includes(referenceDayKey)) return;
        if (policy.scope.dateStart && referenceDateKey < policy.scope.dateStart) return;
        if (policy.scope.dateEnd && referenceDateKey > policy.scope.dateEnd) return;
        if (
          typeof policy.scope.startMinutes === "number" &&
          referenceStartMinutes < policy.scope.startMinutes
        ) {
          return;
        }
        if (
          typeof policy.scope.endMinutes === "number" &&
          referenceStartMinutes >= policy.scope.endMinutes
        ) {
          return;
        }
        if (!firstMatchedGlobalPolicy) firstMatchedGlobalPolicy = policy;
      });
    if (firstMatchedGlobalPolicy) {
      const matchedPolicy = firstMatchedGlobalPolicy as ReservationScopedPolicy;
      effectiveGlobalPolicy = {
        ...effectiveGlobalPolicy,
        ...(matchedPolicy.rules as Partial<ReservationPolicy>)
      };
    }

    const nextDayResetDateKey = formatDateKey(addDays(parseDateKey(referenceDateKey), 1));
    const hoursUntilDayReset = Math.max(
      1,
      Math.ceil((parseDateKey(nextDayResetDateKey).getTime() - now.getTime()) / (60 * 60 * 1000))
    );
    const isCurrentDay = referenceDateKey === todayKey;
    const isNextDay = referenceDateKey === tomorrowKey;
    const dailyLabel =
      referenceDateKey === todayKey
        ? "היום"
        : referenceDateKey === tomorrowKey
          ? "מחר"
          : `יום ${formatShortDate(referenceDateKey)}`;
    const dailyResetLabel = isCurrentDay
      ? `מתאפס בעוד ${hoursUntilDayReset} שעות`
      : isNextDay
        ? `בתאריך ${formatShortDate(nextDayResetDateKey)}`
        : "";
    const currentWeekStart = getWeekStart(todayKey);
    const currentWeekStartKey = formatDateKey(currentWeekStart);
    const nextWeekStartDate = addDays(currentWeekStart, 7);
    const nextWeekStartKey = formatDateKey(nextWeekStartDate);
    const referenceWeekStartKey = formatDateKey(getWeekStart(referenceDateKey));
    const referenceWeekStartDate = getWeekStart(referenceDateKey);
    const referenceWeekEndKey = formatDateKey(addDays(referenceWeekStartDate, 6));
    const weekLabel =
      referenceWeekStartKey === currentWeekStartKey
        ? "השבוע"
        : referenceWeekStartKey === nextWeekStartKey
          ? "שבוע הבא"
          : `שבוע ${formatShortDate(referenceWeekStartKey)}-${formatShortDate(referenceWeekEndKey)}`;
    const nextWeekStartForReferenceKey = formatDateKey(addDays(referenceWeekStartDate, 7));
    const nextWeekEndForReferenceKey = formatDateKey(addDays(referenceWeekStartDate, 13));
    const daysUntilWeekReset = Math.max(
      1,
      Math.ceil((nextWeekStartDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    );
    const isCurrentWeek = referenceWeekStartKey === currentWeekStartKey;
    const isNextWeek = referenceWeekStartKey === nextWeekStartKey;
    const weeklyResetLabel = isCurrentWeek
      ? `מתאפס בעוד ${daysUntilWeekReset} ימים`
      : isNextWeek
        ? `בתאריכים ${formatShortDate(nextWeekStartForReferenceKey)}-${formatShortDate(nextWeekEndForReferenceKey)}`
        : "";

    let totalDayUsed = 0;
    let totalWeekUsed = 0;
    Object.entries(reservationMap).forEach(([dateKey, entries]) => {
      const inWeek = dateKey >= referenceWeekStartKey && dateKey <= referenceWeekEndKey;
      const inDay = dateKey === referenceDateKey;
      if (!inWeek && !inDay) return;
      entries.forEach((entry) => {
        const usageShare = getReservationUsageShareForEmail(entry, email);
        if (usageShare <= 0) return;
        if (inDay) totalDayUsed += usageShare;
        if (inWeek) totalWeekUsed += usageShare;
      });
    });

    const roundDownToHalfHourMinutes = (minutes: number) => Math.max(0, Math.floor(minutes / 30) * 30);
    const formatHours = (minutes: number) => {
      const hours = roundDownToHalfHourMinutes(minutes) / 60;
      return Number.isInteger(hours) ? String(hours) : String(hours);
    };
    const toLimitMinutes = (hours: number, stepMinutes = 30) => {
      const numeric = Number(hours);
      if (!Number.isFinite(numeric) || numeric <= 0) return Number.POSITIVE_INFINITY;
      const raw = Math.floor(numeric * 60);
      return Math.max(0, Math.floor(raw / stepMinutes) * stepMinutes);
    };
    const rows = [
      {
        label: dailyLabel,
        used: totalDayUsed,
        limit: toLimitMinutes(effectiveGlobalPolicy.maxHoursPerDayTotal),
        resetLabel: dailyResetLabel
      },
      {
        label: weekLabel,
        used: totalWeekUsed,
        limit: toLimitMinutes(effectiveGlobalPolicy.maxHoursPerWeekTotal),
        resetLabel: weeklyResetLabel
      }
    ];
    return rows
      .filter((row) => Number.isFinite(row.limit) && row.limit > 0)
      .map((row) => {
        const remaining = Math.max(0, row.limit - row.used);
        const remainingPercent = Math.max(0, Math.min(100, (remaining / Math.max(1, row.limit)) * 100));
        const totalHoursLabel = formatHours(row.limit);
        const remainingHoursLabel = formatHours(remaining);
        return {
          ...row,
          remaining,
          totalLabel: totalHoursLabel,
          remainingLabel: remainingHoursLabel,
          summaryLabel: `נותרו ${remainingHoursLabel} שעות`,
          percent: remainingPercent,
          markerPercent: remainingPercent
        };
      });
  }, [quotaReferenceDate, reservationMap, reservationPolicies, reservationPolicy, user]);
  const initials = (() => {
    const source = (user?.name || "").trim() || (user?.email || "").trim();
    if (!source) return "";
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return source.slice(0, 2).toUpperCase();
  })();

  const openProfileEditor = () => {
    if (!user) return;
    setProfileName(user.name || "");
    setProfilePhone(user.phone || "");
    setProfilePreview((user.picture || "").trim());
    setProfileFile(null);
    setProfilePictureRemoved(Boolean(user.pictureRemoved));
    setProfileError("");
    setProfileStatus("");
    setProfileOpen(true);
  };

  const handleProfileFileChange = (file: File | null) => {
    setProfileError("");
    setProfileStatus("");
    if (!file) {
      setProfileFile(null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setProfileError("נא לבחור קובץ תמונה.");
      return;
    }
    const maxBytes = 5 * 1024 * 1024;
    if (file.size > maxBytes) {
      setProfileError("התמונה גדולה מדי (עד 5MB).");
      return;
    }
    setProfileFile(file);
    setProfilePictureRemoved(false);
    const nextUrl = URL.createObjectURL(file);
    setProfilePreview(nextUrl);
  };

  const handleProfileRemovePicture = () => {
    setProfileFile(null);
    setProfilePreview("");
    setProfilePictureRemoved(true);
    setProfileError("");
    setProfileStatus("");
  };

  useEffect(() => {
    return () => {
      if (profilePreview.startsWith("blob:")) {
        URL.revokeObjectURL(profilePreview);
      }
    };
  }, [profilePreview]);

  const handleProfileSave = async () => {
    if (!user) return;
    setProfileError("");
    setProfileStatus("");
    const name = profileName.trim();
    if (!name) {
      setProfileError("נא למלא שם מלא.");
      return;
    }
    if (!db) {
      setProfileError("Firebase לא מוגדר.");
      return;
    }

    setProfileSaving(true);
    try {
      const toDataUrl = (file: File) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("read_failed"));
          reader.readAsDataURL(file);
        });

      let nextPicture = (user.picture || "").trim();
      let nextPictureRemoved = profilePictureRemoved;
      if (profileFile) {
        if (!functions) {
          setProfileError("שירות העלאת תמונות לא זמין כרגע.");
          setProfileSaving(false);
          return;
        }
        const idToken = (getGoogleIdToken?.() || "").trim();
        const uploadPhoto = httpsCallable(functions, "uploadProfilePhoto");
        const imageDataUrl = await toDataUrl(profileFile);
        const response = await uploadPhoto({
          imageDataUrl,
          contentType: profileFile.type || "image/jpeg",
          idToken: idToken || undefined,
          email: user.email.toLowerCase()
        });
        const result = response.data as { pictureUrl?: string };
        nextPicture = String(result.pictureUrl || "").trim();
        if (!nextPicture) {
          throw new Error("missing_picture_url");
        }
        nextPictureRemoved = false;
      } else if (profilePictureRemoved) {
        nextPicture = "";
      } else {
        nextPictureRemoved = false;
      }
      const persistedPicture = nextPictureRemoved
        ? ""
        : isPersistentProfileUrl(nextPicture)
          ? nextPicture
          : "";

      await setDoc(
        doc(db, "users", user.email.toLowerCase()),
        {
          email: user.email.toLowerCase(),
          name,
          phone: profilePhone.trim(),
          pictureUrl: persistedPicture || null,
          pictureRemoved: nextPictureRemoved,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      onProfileUpdated?.({
        name,
        phone: profilePhone.trim(),
        picture: persistedPicture,
        pictureRemoved: nextPictureRemoved
      });
      setProfileFile(null);
      setProfilePictureRemoved(nextPictureRemoved);
      setProfileStatus("הפרטים נשמרו.");
      setTimeout(() => setProfileOpen(false), 450);
    } catch {
      setProfileError("שמירת הפרטים נכשלה. נסה שוב.");
    } finally {
      setProfileSaving(false);
    }
  };

  const handleBackdropClick = () => {
    if (profileOpen) {
      setProfileOpen(false);
      return;
    }
    if (zoomOpen) {
      setZoomOpen(false);
      return;
    }
    onClose();
  };

  if (!open) return null;

  return (
    <div className={`auth-overlay${user ? " authenticated" : ""}`} onClick={handleBackdropClick}>
      <div
        className={`auth-menu${user ? " authenticated" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={user ? "פרופיל והתראות" : "התחברות"}
        onClick={(event) => event.stopPropagation()}
      >
        {user ? (
          <>
            <button type="button" className="icon-button auth-menu-close" onClick={onClose} aria-label="סגירת תפריט הפרופיל">
              <CloseIcon />
            </button>
            <div className="auth-menu-content">
              <section className="auth-menu-section auth-profile-section" aria-label="פרופיל">
                <div className="auth-profile-capsule">
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
                    <div className="auth-user-text">
                      <p className="auth-user-name">{user.name}</p>
                      <span className="auth-user-email">{profileCategoryLabel}</span>
                    </div>
                  </div>
                  <div className="auth-profile-actions">
                    <button className="secondary" type="button" onClick={openProfileEditor}>
                      <UserIcon />
                      <span>עריכת פרופיל</span>
                    </button>
                    <button className="secondary auth-signout-button" onClick={onSignOut} type="button">
                      <LogoutIcon />
                      <span>התנתק</span>
                    </button>
                  </div>
                </div>
              </section>

              <section className="auth-menu-section auth-notifications-embed" aria-labelledby="auth-notifications-title">
                <header className="auth-notifications-header auth-section-title">
                  <span className="auth-notifications-title">
                    <NotificationsRoundedIcon fontSize="small" />
                    <strong id="auth-notifications-title">התראות</strong>
                  </span>
                  {notificationCount > 0 ? (
                    <span className="auth-notifications-count">{notificationCount > 99 ? "99+" : notificationCount}</span>
                  ) : null}
                </header>
                <NotificationsList
                  notifications={notifications}
                  ready={notificationsReady}
                  className="auth-notifications-list"
                  respondSharedReservation={respondSharedReservation}
                  respondRehearsal={respondRehearsal}
                  respondGroupInvite={respondGroupInvite}
                  respondReservationJoinRequest={respondReservationJoinRequest}
                />
              </section>

              {quotaRows.length ? (
                <section className="auth-menu-section auth-quotas" aria-labelledby="auth-quotas-title">
                  <h2 id="auth-quotas-title" className="auth-section-title auth-quotas-title">
                    <DataUsageRoundedIcon fontSize="small" />
                    <span>מכסות שריונים</span>
                  </h2>
                  <ul className="auth-quotas-list">
                    {quotaRows.map((row) => (
                      <li key={row.label} className="auth-quotas-row">
                        <div className="quota-progress-row">
                          <div className="quota-progress-head">
                            <span className="auth-quotas-label">{row.label}</span>
                            <span className="quota-progress-inline-value">{row.summaryLabel}</span>
                          </div>
                          <span className="quota-progress-wrap" aria-hidden="true">
                            <span className="quota-progress-track">
                              <span className="quota-progress-fill" style={{ width: `${row.percent}%` }} />
                            </span>
                          </span>
                          {row.resetLabel ? <span className="quota-progress-reset-date">{row.resetLabel}</span> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="auth-menu-section auth-options-section" aria-labelledby="auth-options-title">
                <h2 id="auth-options-title" className="auth-section-title">
                  <TuneRoundedIcon fontSize="small" />
                  <span>אפשרויות</span>
                </h2>
                <div className="auth-section-rows">
                  <button
                    className="secondary auth-section-row auth-admin-button"
                    type="button"
                    onClick={() => onToggleDarkMode?.()}
                  >
                    <span className="auth-admin-label">
                      <DarkModeIcon />
                      <span>מצב כהה</span>
                    </span>
                    <span className="auth-admin-switch" aria-hidden="true">
                      <span className={`toggle-switch${darkMode ? " on" : ""}`}>
                        <span className="toggle-dot" />
                      </span>
                    </span>
                  </button>
                  {!isStandalone ? (
                    <button className="secondary auth-section-row auth-install-button" type="button" onClick={handleInstall}>
                      <ShortcutIcon />
                      <span>{installAvailable ? "התקן אפליקציה" : "הוספה למסך הבית"}</span>
                    </button>
                  ) : null}
                </div>
                {installHelpOpen && !installAvailable && !isStandalone ? (
                  <div className="auth-install-hint" role="note" aria-label="התקנה">
                    <div className="auth-install-hint-title">{installHintTitle}</div>
                    <ol className="auth-install-hint-steps">
                      {installHintBody.map((line) => <li key={line}>{line}</li>)}
                    </ol>
                    {isIOS ? <div className="auth-install-hint-foot">אם לא מופיע, ודאו שאתם לא במצב גלישה פרטית.</div> : null}
                  </div>
                ) : null}
              </section>

              {user.role === "admin" || user.role === "moderator" ? (
                <section className="auth-menu-section" aria-labelledby="auth-management-title">
                  <h2 id="auth-management-title" className="auth-section-title">
                    <AdminPanelSettingsRoundedIcon fontSize="small" />
                    <span>ניהול</span>
                  </h2>
                  <div className="auth-section-rows">
                    {user.role === "admin" ? (
                      <button
                        className="secondary auth-section-row auth-reservations-button"
                        type="button"
                        onClick={() => {
                          window.location.href = "/admin";
                        }}
                      >
                        <AdminIcon />
                        <span>דשבורד ניהול</span>
                      </button>
                    ) : null}
                    <button className="secondary auth-section-row auth-admin-button" type="button" onClick={() => onToggleAdminMode?.()}>
                      <span className="auth-admin-label">
                        {user.role === "admin" ? <EditIcon /> : <AdminIcon />}
                        <span>מצב עריכה</span>
                      </span>
                      <span className="auth-admin-switch" aria-hidden="true">
                        <span className={`toggle-switch${adminMode ? " on" : ""}`}>
                          <span className="toggle-dot" />
                        </span>
                      </span>
                    </button>
                  </div>
                </section>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <p>התחבר כדי לשריין חדרים</p>
            <button className="primary" onClick={onLoginClick} type="button">התחברות</button>
            <div className="auth-admin-row">
              <button
                className="secondary auth-admin-button"
                type="button"
                onClick={() => onToggleDarkMode?.()}
              >
                <span className="auth-admin-label">
                  <DarkModeIcon />
                  <span>מצב כהה</span>
                </span>
                <span className="auth-admin-switch" aria-hidden="true">
                  <span className={`toggle-switch${darkMode ? " on" : ""}`}>
                    <span className="toggle-dot" />
                  </span>
                </span>
              </button>
            </div>
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

      {profileOpen && user ? (
        <div
          className="profile-edit-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            event.stopPropagation();
            setProfileOpen(false);
          }}
        >
          <div className="profile-edit-card" onClick={(event) => event.stopPropagation()}>
            <h3>עריכת פרופיל</h3>
            <p className="profile-edit-subtitle">עדכון שם, טלפון ותמונת פרופיל.</p>
            <div className="profile-edit-avatar-row">
              <div className="profile-edit-avatar">
                {profilePreview ? <img src={profilePreview} alt="" /> : <span aria-hidden="true">{initials}</span>}
              </div>
              <div className="profile-edit-avatar-actions">
                <input
                  ref={profileFileInputRef}
                  className="profile-file-input"
                  type="file"
                  accept="image/*"
                  onChange={(event) => handleProfileFileChange(event.target.files?.[0] || null)}
                />
                <button
                  className="primary profile-upload-photo"
                  type="button"
                  aria-label="החלפת תמונה"
                  onClick={() => profileFileInputRef.current?.click()}
                >
                  <UploadIcon />
                </button>
                {profilePreview || user.picture ? (
                  <button
                    className="secondary profile-remove-photo"
                    type="button"
                    aria-label="הסרת תמונה"
                    onClick={handleProfileRemovePicture}
                  >
                    <ReleaseIcon />
                  </button>
                ) : null}
              </div>
            </div>
            <label>
              שם מלא
              <input value={profileName} onChange={(event) => setProfileName(event.target.value)} />
            </label>
            <label>
              טלפון
              <input value={profilePhone} onChange={(event) => setProfilePhone(event.target.value)} />
            </label>
            <button
              className="secondary profile-edit-availability"
              type="button"
              onClick={() => {
                setProfileOpen(false);
                onClose();
                onEditAvailability?.();
              }}
            >
              <CalendarIcon />
              <span>ערוך זמינות בקמפוס</span>
            </button>
            {profileError ? <p className="profile-edit-error">{profileError}</p> : null}
            {profileStatus ? <p className="profile-edit-success">{profileStatus}</p> : null}
            <div className="profile-edit-actions">
              <button className="secondary" type="button" onClick={() => setProfileOpen(false)}>
                ביטול
              </button>
              <button className="primary" type="button" onClick={() => void handleProfileSave()} disabled={profileSaving}>
                {profileSaving ? "שומר..." : "שמירה"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
