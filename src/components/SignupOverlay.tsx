import { useEffect, useMemo, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import type { User } from "../types/auth";
import { cohortStartYearFromGrade, gradeLabelFromCohort, gradeOptions, gradeValueFromCohort } from "../lib/academics";

export type SignupOverlayProps = {
  open: boolean;
  user: User | null;
  onSignOut: () => void;
};

export default function SignupOverlay({ open, user, onSignOut }: SignupOverlayProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [grade, setGrade] = useState<"A" | "B" | "C">("A");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const cohortStartYear = useMemo(() => cohortStartYearFromGrade(grade), [grade]);
  const gradeLabel = useMemo(
    () => gradeLabelFromCohort(user?.cohortStartYear ?? cohortStartYear),
    [user?.cohortStartYear, cohortStartYear]
  );

  useEffect(() => {
    if (!user) return;
    setName(user.name || "");
    setPhone(user.phone || "");
    if (user.cohortStartYear) {
      setGrade(gradeValueFromCohort(user.cohortStartYear));
    }
  }, [user]);

  if (!open || !user) return null;

  const handleSave = async () => {
    setError("");
    setStatus("");
    if (!db) {
      setError("Firebase לא מוגדר.");
      return;
    }
    if (!name.trim()) {
      setError("נא למלא שם מלא.");
      return;
    }
    const email = user.email.toLowerCase();
    await setDoc(
      doc(db, "users", email),
      {
        email,
        name: name.trim(),
        phone: phone.trim(),
        pictureUrl: user.picture || "",
        cohortStartYear,
        role: "pending",
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp()
      },
      { merge: true }
    );
    setStatus("פרטי הבקשה נשמרו. ממתין לאישור.");
  };

  return (
    <div className="signup-overlay">
      <div className="signup-card">
        <h2>הרשמה למערכת</h2>
        <p className="signup-subtitle">
          נדרש לאשר את הפרטים לפני שתוכל להשתמש במערכת.
        </p>
        <div className="signup-form">
          <label>
            שם מלא
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            טלפון
            <input value={phone} onChange={(event) => setPhone(event.target.value)} />
          </label>
          <label>
            שנתון
            <select value={grade} onChange={(event) => setGrade(event.target.value as "A" | "B" | "C")}>
              {gradeOptions().map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
        {gradeLabel ? (
          <p className="signup-meta">סטטוס נוכחי: {gradeLabel}</p>
        ) : null}
        {error ? <p className="signup-error">{error}</p> : null}
        {status ? <p className="signup-success">{status}</p> : null}
        <div className="signup-actions">
          <button className="secondary" type="button" onClick={onSignOut}>
            התנתק
          </button>
          <button className="primary" type="button" onClick={handleSave}>
            שמירת פרטים
          </button>
        </div>
        {user.role === "pending" ? (
          <p className="signup-pending">סטטוס החשבון: ממתין לאישור מנהל.</p>
        ) : null}
      </div>
    </div>
  );
}
