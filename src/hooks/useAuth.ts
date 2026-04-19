import { useCallback, useEffect, useRef, useState } from "react";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { decodeJwt, loadGoogleScript } from "../lib/googleAuth";
import { loadUser, saveUser, clearUser } from "../lib/storage";
import { db, functions } from "../lib/firebase";
import type { User } from "../types/auth";
import type { DirectoryUser } from "../types/admin";
import {
  isPersistentProfileUrl,
  markPhotoSyncAttempt,
  shouldAttemptPhotoSync
} from "../lib/profilePhoto";

const isPictureRemoved = (raw: Record<string, unknown>) => raw.pictureRemoved === true;

export function useAuth({ clientId, darkMode = false }: { clientId?: string; darkMode?: boolean }) {
  const [user, setUser] = useState<User | null>(() => loadUser());
  const [authError, setAuthError] = useState("");
  const [roleResolvedEmail, setRoleResolvedEmail] = useState<string | null>(null);
  const pictureRef = useRef<string>("");
  const googlePictureRef = useRef<string>("");
  const googleIdTokenRef = useRef<string>("");
  const photoSyncInFlightRef = useRef<Set<string>>(new Set());
  const photoSyncLastFailureRef = useRef<Map<string, number>>(new Map());
  const [googleButtonEl, setGoogleButtonEl] = useState<HTMLDivElement | null>(null);
  const googleButtonRef = useCallback((el: HTMLDivElement | null) => {
    setGoogleButtonEl(el);
  }, []);

  useEffect(() => {
    if (user) {
      saveUser(user);
    } else {
      clearUser();
    }
  }, [user]);

  useEffect(() => {
    pictureRef.current = (user?.picture || "").trim();
  }, [user?.picture]);

  useEffect(() => {
    // A user switch invalidates the previous role-resolution state.
    setRoleResolvedEmail(null);
  }, [user?.email]);

  const queueProfilePhotoSync = useCallback((args: {
    email: string;
    sourceUrl: string;
    storedUrl: string;
    storedSize?: number | null;
    targetSize: number;
    idToken: string;
  }) => {
    const { email, sourceUrl, storedUrl, storedSize, targetSize, idToken } = args;
    if (!functions || !email || !idToken) return;
    if (!shouldAttemptPhotoSync({ email, sourceUrl, storedUrl, storedSize, targetSize })) return;

    const key = `${email.toLowerCase()}:s${targetSize}`;
    if (photoSyncInFlightRef.current.has(key)) return;

    const now = Date.now();
    const lastFailure = photoSyncLastFailureRef.current.get(key) || 0;
    if (now - lastFailure < 60_000) return;

    photoSyncInFlightRef.current.add(key);
    const call = httpsCallable(functions, "syncProfilePhoto");

    const run = async () => {
      try {
        await call({ sourceUrl, targetSize, idToken });
        markPhotoSyncAttempt(email, targetSize);
        photoSyncLastFailureRef.current.delete(key);
      } catch {
        try {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          await call({ sourceUrl, targetSize, idToken });
          markPhotoSyncAttempt(email, targetSize);
          photoSyncLastFailureRef.current.delete(key);
        } catch {
          photoSyncLastFailureRef.current.set(key, Date.now());
        }
      } finally {
        photoSyncInFlightRef.current.delete(key);
      }
    };

    void run();
  }, []);

  useEffect(() => {
    if (!db || !user?.email) return;
    const email = user.email.toLowerCase();
    const ref = doc(db, "users", email);
    let cancelled = false;
    const unsubscribe = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        // Ignore cache-miss snapshots; they can briefly report missing docs before server data arrives.
        if (snap.metadata.fromCache) {
          return;
        }
        setRoleResolvedEmail(email);
        setUser((prev) => prev ? { ...prev, role: "pending", allowed: false } : prev);
        return;
      }
      setRoleResolvedEmail(email);
      const raw = snap.data() as Record<string, unknown>;
      const data = raw as DirectoryUser;
      const role = data.role || "pending";
      const allowed = role === "admin" || role === "moderator" || role === "student";
      const pictureUrl =
        typeof raw.pictureUrl === "string"
          ? raw.pictureUrl
          : typeof raw.picture === "string"
            ? raw.picture
            : typeof raw.photoURL === "string"
              ? raw.photoURL
              : typeof raw.photoUrl === "string"
                ? raw.photoUrl
                : "";
      const persistentPictureUrl = isPersistentProfileUrl(pictureUrl) ? pictureUrl.trim() : "";
      const pictureRemoved = isPictureRemoved(raw);
      const pictureSize =
        typeof (raw as any).pictureSize === "number" ? (raw as any).pictureSize : null;
      const phone =
        typeof raw.phone === "string"
          ? raw.phone
          : typeof raw.phoneNumber === "string"
            ? raw.phoneNumber
            : typeof raw.phone_number === "string"
              ? raw.phone_number
              : typeof raw.mobile === "string"
                ? raw.mobile
                : typeof raw.tel === "string"
                  ? raw.tel
                  : "";

      // If we only have a Google hotlink, copy a cached version into Storage (once in a while).
      // This dramatically reduces 429s from Google profile image rate limits.
      const storedUrl = pictureUrl || "";
      const sourceUrl = (googlePictureRef.current || pictureRef.current).trim();
      const idToken = googleIdTokenRef.current;
      // Cache a high-quality avatar so zoom/profile views stay crisp.
      const targetSize = 1024;
      if (
        !cancelled &&
        !pictureRemoved &&
        idToken
      ) {
        queueProfilePhotoSync({
          email,
          sourceUrl,
          storedUrl,
          storedSize: pictureSize,
          targetSize,
          idToken
        });
      }

      setUser((prev) => {
        if (!prev) return prev;
        const previousPersistentPicture = isPersistentProfileUrl(prev.picture || "") ? (prev.picture || "") : "";
        const fallbackPicture = (googlePictureRef.current || previousPersistentPicture).trim();
        const next: User = {
          ...prev,
          name: data.name || prev.name,
          role,
          allowed,
          phone,
          picture: pictureRemoved ? "" : (persistentPictureUrl || fallbackPicture),
          pictureRemoved,
          cohortStartYear: data.cohortStartYear ?? prev.cohortStartYear
        };
        if (
          next.name === prev.name &&
          next.role === prev.role &&
          next.allowed === prev.allowed &&
          next.phone === prev.phone &&
          next.picture === prev.picture &&
          next.pictureRemoved === prev.pictureRemoved &&
          next.cohortStartYear === prev.cohortStartYear
        ) {
          return prev;
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [user?.email]);

  useEffect(() => {
    if (!clientId || !googleButtonEl) return;
    let isMounted = true;

    loadGoogleScript()
      .then(() => {
        if (!isMounted || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          // Keep a stable GIS button style; FedCM can swap it into a personalized iframe variant.
          use_fedcm_for_button: false,
          callback: async (response) => {
            const profile = decodeJwt(response.credential);
            const email = profile?.email;
            if (!email) {
              setAuthError("לא ניתן לקרוא את כתובת המייל מפרופיל גוגל.");
              return;
            }
            googleIdTokenRef.current = response.credential || "";
            googlePictureRef.current = typeof profile.picture === "string" ? profile.picture : "";
            let directoryUser: DirectoryUser | null = null;
            let directoryPhone = "";
            let directoryPictureUrl = "";
            let directoryPictureSize: number | null = null;
            let directoryPictureRemoved = false;
            if (db) {
              try {
                const snap = await getDoc(doc(db, "users", email.toLowerCase()));
                if (snap.exists()) {
                  const raw = snap.data() as Record<string, unknown>;
                  directoryUser = raw as DirectoryUser;
                  directoryPictureUrl =
                    typeof raw.pictureUrl === "string"
                      ? raw.pictureUrl
                      : typeof raw.picture === "string"
                        ? raw.picture
                        : typeof raw.photoURL === "string"
                          ? raw.photoURL
                          : typeof raw.photoUrl === "string"
                            ? raw.photoUrl
                            : "";
                  directoryPictureRemoved = isPictureRemoved(raw);
                  directoryPictureSize = typeof (raw as any).pictureSize === "number" ? (raw as any).pictureSize : null;
                  directoryPhone =
                    typeof raw.phone === "string"
                      ? raw.phone
                      : typeof raw.phoneNumber === "string"
                        ? raw.phoneNumber
                        : typeof raw.phone_number === "string"
                          ? raw.phone_number
                          : typeof raw.mobile === "string"
                            ? raw.mobile
                            : typeof raw.tel === "string"
                              ? raw.tel
                              : "";
                }
              } catch {
                directoryUser = null;
              }
            }
            const role = directoryUser?.role;
            const allowed = role === "admin" || role === "moderator" || role === "student";
            const googlePicture = (typeof profile.picture === "string" ? profile.picture : "").trim();
            const directoryPersistentPicture = isPersistentProfileUrl(directoryPictureUrl)
              ? directoryPictureUrl.trim()
              : "";
            setAuthError("");
            setUser({
              name: directoryUser?.name || profile.name || profile.given_name || "משתמש",
              email,
              picture: directoryPictureRemoved ? "" : (directoryPersistentPicture || googlePicture || ""),
              pictureRemoved: directoryPictureRemoved,
              allowed,
              role: role || "pending",
              phone: directoryPhone || directoryUser?.phone,
              cohortStartYear: directoryUser?.cohortStartYear
            });

            // Best-effort: sync the profile photo immediately while the Google ID token is fresh.
            // This reduces 429s from directly hotlinking Google profile images.
            const targetSize = 1024;
            const sourceUrl = googlePicture;
            const storedUrl = String(directoryPictureUrl || "").trim();
            const normalizedEmail = email.toLowerCase();
            if (
              !directoryPictureRemoved &&
              googleIdTokenRef.current &&
              sourceUrl
            ) {
              queueProfilePhotoSync({
                email: normalizedEmail,
                sourceUrl,
                storedUrl,
                storedSize: directoryPictureSize,
                targetSize,
                idToken: googleIdTokenRef.current
              });
            }
          }
        });
        googleButtonEl.innerHTML = "";
        window.google.accounts.id.renderButton(googleButtonEl, {
          theme: darkMode ? "filled_black" : "outline",
          size: "large",
          text: "signin_with",
          shape: "pill"
        });
      })
      .catch(() => {
        setAuthError("טעינת Google Sign-In נכשלה.");
      });

    return () => {
      isMounted = false;
    };
  }, [clientId, darkMode, googleButtonEl]);

  const signOut = () => {
    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }
    googleIdTokenRef.current = "";
    photoSyncInFlightRef.current.clear();
    photoSyncLastFailureRef.current.clear();
    setRoleResolvedEmail(null);
    clearUser();
    setUser(null);
  };

  const roleResolved = Boolean(user?.email && roleResolvedEmail === user.email.toLowerCase());

  return {
    user,
    setUser,
    authError,
    setAuthError,
    roleResolved,
    googleButtonRef,
    signOut
  };
}
