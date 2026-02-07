import { useCallback, useEffect, useRef, useState } from "react";
import { doc, getDoc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { decodeJwt, loadGoogleScript } from "../lib/googleAuth";
import { loadUser, saveUser, clearUser } from "../lib/storage";
import { db, functions } from "../lib/firebase";
import type { User } from "../types/auth";
import type { DirectoryUser } from "../types/admin";
import { markPhotoSyncAttempt, shouldAttemptPhotoSync } from "../lib/profilePhoto";

export function useAuth({ clientId }: { clientId?: string }) {
  const [user, setUser] = useState<User | null>(() => loadUser());
  const [authError, setAuthError] = useState("");
  const pictureRef = useRef<string>("");
  const googlePictureRef = useRef<string>("");
  const googleIdTokenRef = useRef<string>("");
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
    if (!db || !user?.email) return;
    const email = user.email.toLowerCase();
    const ref = doc(db, "users", email);
    let cancelled = false;
    const unsubscribe = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setUser((prev) => prev ? { ...prev, role: "pending", allowed: false } : prev);
        return;
      }
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
      // Use a reasonably large cached avatar so zoom/profile views stay crisp,
      // while still keeping Storage usage small (~tens of KB per user).
      const targetSize = 512;
      if (
        !cancelled &&
        functions &&
        idToken &&
        shouldAttemptPhotoSync({ email, sourceUrl, storedUrl, storedSize: pictureSize, targetSize })
      ) {
        markPhotoSyncAttempt(email, targetSize);
        const call = httpsCallable(functions, "syncProfilePhoto");
        void call({ sourceUrl, targetSize, idToken }).catch(() => {
          // Best-effort: keep working even if photo sync fails.
        });
      }

      setUser((prev) => {
        if (!prev) return prev;
        const next: User = {
          ...prev,
          name: data.name || prev.name,
          role,
          allowed,
          phone,
          picture: pictureUrl || prev.picture,
          cohortStartYear: data.cohortStartYear ?? prev.cohortStartYear
        };
        if (
          next.name === prev.name &&
          next.role === prev.role &&
          next.allowed === prev.allowed &&
          next.phone === prev.phone &&
          next.picture === prev.picture &&
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
            let docExists = false;
            if (db) {
              try {
                const snap = await getDoc(doc(db, "users", email.toLowerCase()));
                if (snap.exists()) {
                  docExists = true;
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
            setAuthError("");
            setUser({
              name: directoryUser?.name || profile.name || profile.given_name || "סטודנט",
              email,
              picture: directoryPictureUrl || profile.picture || "",
              allowed,
              role: role || "pending",
              phone: directoryPhone || directoryUser?.phone,
              cohortStartYear: directoryUser?.cohortStartYear
            });

            // Best-effort: sync the profile photo immediately while the Google ID token is fresh.
            // This reduces 429s from directly hotlinking Google profile images.
            const targetSize = 512;
            const sourceUrl = String(profile.picture || "").trim();
            const storedUrl = String(directoryPictureUrl || "").trim();
            const normalizedEmail = email.toLowerCase();
            if (
              functions &&
              googleIdTokenRef.current &&
              shouldAttemptPhotoSync({
                email: normalizedEmail,
                sourceUrl,
                storedUrl,
                storedSize: directoryPictureSize,
                targetSize
              })
            ) {
              markPhotoSyncAttempt(normalizedEmail, targetSize);
              const call = httpsCallable(functions, "syncProfilePhoto");
              void call({ sourceUrl, targetSize, idToken: googleIdTokenRef.current }).catch(() => {});
            }
          }
        });
        window.google.accounts.id.renderButton(googleButtonEl, {
          theme: "outline",
          size: "large",
          text: "signin_with",
          shape: "pill",
          width: 240
        });
      })
      .catch(() => {
        setAuthError("טעינת Google Sign-In נכשלה.");
      });

    return () => {
      isMounted = false;
    };
  }, [clientId, googleButtonEl]);

  const signOut = () => {
    if (window.google?.accounts?.id) {
      window.google.accounts.id.disableAutoSelect();
    }
    googleIdTokenRef.current = "";
    clearUser();
    setUser(null);
  };

  return {
    user,
    setUser,
    authError,
    setAuthError,
    googleButtonRef,
    signOut
  };
}
