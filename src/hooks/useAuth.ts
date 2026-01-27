import { useCallback, useEffect, useState } from "react";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
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
      const data = snap.data() as DirectoryUser;
      const role = data.role || "pending";
      const allowed = role === "admin" || role === "moderator" || role === "student";
      setUser((prev) => {
        if (!prev) return prev;
        const next: User = {
          ...prev,
          name: data.name || prev.name,
          role,
          allowed,
          phone: data.phone,
          cohortStartYear: data.cohortStartYear ?? prev.cohortStartYear
        };
        if (
          next.name === prev.name &&
          next.role === prev.role &&
          next.allowed === prev.allowed &&
          next.phone === prev.phone &&
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
            if (db) {
              try {
                const snap = await getDoc(doc(db, "users", email.toLowerCase()));
                if (snap.exists()) {
                  directoryUser = snap.data() as DirectoryUser;
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
              picture: profile.picture || "",
              allowed,
              role: role || "pending",
              phone: directoryUser?.phone,
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
