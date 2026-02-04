import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "../lib/firebase";
import type { DirectoryUser } from "../types/admin";

export function useDirectoryUsers(enabled = true) {
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [usersReady, setUsersReady] = useState<boolean>(!db);
  const [usersError, setUsersError] = useState<string>("");

  useEffect(() => {
    if (!enabled) {
      setUsers([]);
      setUsersError("");
      setUsersReady(true);
      return;
    }
    if (!db) {
      setUsersError("Firestore is not configured.");
      setUsersReady(true);
      return;
    }

    const usersRef = collection(db, "users");
    const unsubscribe = onSnapshot(
      usersRef,
      (snapshot) => {
        const next: DirectoryUser[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as Partial<DirectoryUser>;
          const email = (data.email || docSnap.id || "").toLowerCase();
          if (!email) return;
          next.push({
            email,
            name: data.name || "",
            role: data.role || "pending",
            phone: data.phone || "",
            cohortStartYear: data.cohortStartYear,
            notes: data.notes || ""
          });
        });
        next.sort((a, b) => a.email.localeCompare(b.email));
        setUsers(next);
        setUsersError("");
        setUsersReady(true);
      },
      () => {
        setUsersError("Failed to load users.");
        setUsersReady(true);
      }
    );

    return () => unsubscribe();
  }, [enabled]);

  const userMap = useMemo(() => {
    const map = new Map<string, DirectoryUser>();
    users.forEach((user) => map.set(user.email.toLowerCase(), user));
    return map;
  }, [users]);

  const upsertUser = async (user: DirectoryUser) => {
    if (!db) return;
    const email = user.email.toLowerCase();
    if (!email) return;
    await setDoc(doc(db, "users", email), {
      ...user,
      email,
      phone: user.phone || "",
      cohortStartYear: user.cohortStartYear ?? null
    });
  };

  const removeUser = async (email: string) => {
    if (!db) return;
    const safe = email.toLowerCase();
    if (!safe) return;
    await deleteDoc(doc(db, "users", safe));
  };

  return {
    users,
    userMap,
    usersReady,
    usersError,
    upsertUser,
    removeUser
  };
}
