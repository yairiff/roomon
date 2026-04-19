import { useEffect, useMemo, useRef, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import type { User } from "../types/auth";
import { db, storage } from "../lib/firebase";
import { isPersistentProfileUrl } from "../lib/profilePhoto";
import { AdminIcon, ShortcutIcon, CalendarIcon, DarkModeIcon, EditIcon, UploadIcon, UserIcon, ReleaseIcon } from "./Icons";

export type AuthMenuProps = {
  user: User | null;
  open: boolean;
  onClose: () => void;
  onSignOut: () => void;
  onLoginClick: () => void;
  onProfileUpdated?: (updates: Partial<User>) => void;
  onOpenMySchedule?: () => void;
  adminMode?: boolean;
  onToggleAdminMode?: () => void;
  darkMode?: boolean;
  onToggleDarkMode?: () => void;
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
  onProfileUpdated,
  onOpenMySchedule,
  adminMode = false,
  onToggleAdminMode,
  darkMode = false,
  onToggleDarkMode,
  installAvailable = false,
  isStandalone = false,
  onInstall
}: AuthMenuProps) {
  if (!open) return null;

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

  const ua = typeof navigator !== "undefined" ? (navigator.userAgent || "") : "";
  const isIOS = /iPad|iPhone|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);

  useEffect(() => {
    if (!open) return;
    setInstallHelpOpen(false);
    setZoomOpen(false);
    setProfileOpen(false);
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
      let nextPicture = (user.picture || "").trim();
      let nextPictureRemoved = profilePictureRemoved;
      if (profilePictureRemoved) {
        nextPicture = "";
      }
      if (profileFile) {
        if (!storage) {
          setProfileError("אחסון תמונות לא זמין כרגע.");
          setProfileSaving(false);
          return;
        }
        const ext = profileFile.name.split(".").pop()?.toLowerCase() || "jpg";
        const safeEmail = encodeURIComponent(user.email.toLowerCase());
        const imageRef = ref(storage, `users/${safeEmail}/avatar-${Date.now()}.${ext}`);
        await uploadBytes(imageRef, profileFile, { contentType: profileFile.type || "image/jpeg" });
        nextPicture = await getDownloadURL(imageRef);
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
          pictureUrl: persistedPicture,
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
              <div className="auth-user-text">
                <p className="auth-user-name">{user.name}</p>
                <span className="auth-user-email">{user.email}</span>
              </div>
            </div>
            {user.role === "admin" ? (
              <>
                <button
                  className="secondary auth-reservations-button"
                  type="button"
                  onClick={() => {
                    window.location.href = "/admin";
                  }}
                >
                  <AdminIcon />
                  <span>דשבורד ניהול</span>
                </button>
                <div className="auth-admin-row">
                  <button className="secondary auth-admin-button" type="button" onClick={() => onToggleAdminMode?.()}>
                    <span className="auth-admin-label">
                      <EditIcon />
                      <span>מצב עריכה</span>
                    </span>
                    <span className="auth-admin-switch" aria-hidden="true">
                      <span className={`toggle-switch${adminMode ? " on" : ""}`}>
                        <span className="toggle-dot" />
                      </span>
                    </span>
                  </button>
                </div>
              </>
            ) : null}
            {user.role === "moderator" ? (
              <div className="auth-admin-row">
                <button className="secondary auth-admin-button" type="button" onClick={() => onToggleAdminMode?.()}>
                  <span className="auth-admin-label">
                    <AdminIcon />
                    <span>מצב עריכה</span>
                  </span>
                  <span className="auth-admin-switch" aria-hidden="true">
                    <span className={`toggle-switch${adminMode ? " on" : ""}`}>
                      <span className="toggle-dot" />
                    </span>
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
            <button className="secondary auth-reservations-button" type="button" onClick={openProfileEditor}>
              <UserIcon />
              <span>עריכת פרופיל</span>
            </button>
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
