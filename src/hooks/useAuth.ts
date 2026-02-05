import { useCallback, useEffect, useState } from "react";
import { doc, getDoc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { decodeJwt, loadGoogleScript } from "../lib/googleAuth";
import { loadUser, saveUser, clearUser } from "../lib/storage";
import { db } from "../lib/firebase";
import type { User } from "../types/auth";
import type { DirectoryUser } from "../types/admin";

export function useAuth({ clientId }: { clientId?: string }) {
  const [user, setUser] = useState<User | null>(() => loadUser());
  const [authError, setAuthError] = useState("");
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
    if (!db || !user?.email) return;
    const email = user.email.toLowerCase();
    const ref = doc(db, "users", email);
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
    return () => unsubscribe();
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
            let directoryUser: DirectoryUser | null = null;
            let directoryPhone = "";
            let directoryPictureUrl = "";
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
            // Persist the photo URL for other users to see (only if the user doc already exists).
            // This avoids creating a partially-filled document before the signup flow.
            if (
              db &&
              docExists &&
              typeof profile.picture === "string" &&
              profile.picture &&
              directoryPictureUrl !== profile.picture
            ) {
              try {
                await updateDoc(doc(db, "users", email.toLowerCase()), {
                  pictureUrl: profile.picture,
                  updatedAt: serverTimestamp()
                });
              } catch {
                // Ignore; showing the local photo is still fine.
              }
            }
            const role = directoryUser?.role;
            const allowed = role === "admin" || role === "moderator" || role === "student";
            setAuthError("");
            setUser({
              name: directoryUser?.name || profile.name || profile.given_name || "סטודנט",
              email,
              picture: profile.picture || "",
              allowed,
              role: role || "pending",
              phone: directoryPhone || directoryUser?.phone,
              cohortStartYear: directoryUser?.cohortStartYear
            });
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
