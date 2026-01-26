import { useCallback, useEffect, useState } from "react";
import { allowedStudents } from "../data/allowedStudents";
import { decodeJwt, loadGoogleScript } from "../lib/googleAuth";
import { loadUser, saveUser, clearUser } from "../lib/storage";
import type { User } from "../types/auth";

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
    if (!user?.email) return;
    const allowed = allowedStudents.includes(user.email.toLowerCase());
    if (!allowed) {
      setAuthError("החשבון לא נמצא ברשימת הסטודנטים המאושרת.");
      clearUser();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    if (!clientId || !googleButtonEl) return;
    let isMounted = true;

    loadGoogleScript()
      .then(() => {
        if (!isMounted || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            const profile = decodeJwt(response.credential);
            const email = profile?.email;
            if (!email) {
              setAuthError("לא ניתן לקרוא את כתובת המייל מפרופיל גוגל.");
              return;
            }
            const allowed = allowedStudents.includes(email.toLowerCase());
            if (!allowed) {
              setAuthError("החשבון לא נמצא ברשימת הסטודנטים המאושרת.");
              clearUser();
              setUser(null);
              return;
            }
            setAuthError("");
            setUser({
              name: profile.name || profile.given_name || "סטודנט",
              email,
              picture: profile.picture || "",
              allowed
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
