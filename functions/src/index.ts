import * as admin from "firebase-admin";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";

admin.initializeApp();

type DirectoryUser = {
  email?: string;
  name?: string;
  phone?: string;
  role?: "admin" | "moderator" | "student" | "pending";
  cohortStartYear?: number;
};

const appUrl = process.env.APP_URL || "";
const fromEmail = process.env.SENDGRID_FROM_EMAIL || "";
const fromName = process.env.SENDGRID_FROM_NAME || "רימון - שריון חדרים";
const sendgridApiKey = process.env.SENDGRID_API_KEY || "";

const sendEmail = async (to: string[], subject: string, text: string) => {
  if (!sendgridApiKey || !fromEmail || !to.length) return;
  const payload = {
    personalizations: [{ to: to.map((email) => ({ email })) }],
    from: { email: fromEmail, name: fromName },
    subject,
    content: [{ type: "text/plain", value: text }]
  };
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sendgridApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`sendgrid_failed:${response.status}:${body}`);
  }
};

const getAdminEmails = async () => {
  const snapshot = await admin.firestore().collection("users").where("role", "==", "admin").get();
  const emails = snapshot.docs
    .map((docSnap) => (docSnap.data() as DirectoryUser).email || docSnap.id)
    .map((email) => String(email || "").toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(emails));
};

export const notifyAdminsNewUser = onDocumentCreated("users/{email}", async (event) => {
  const data = event.data?.data() as DirectoryUser | undefined;
  if (!data) return;
  if (data.role !== "pending") return;

  const email = String(data.email || event.params.email || "").toLowerCase();
  if (!email) return;

  const admins = await getAdminEmails();
  if (!admins.length) return;

  const name = (data.name || "").trim();
  const phone = (data.phone || "").trim();
  const cohort = data.cohortStartYear ? `${data.cohortStartYear}-${data.cohortStartYear + 1}` : "";

  const subject = "בקשת הרשמה חדשה - מערכת שריון חדרים";
  const lines = [
    "נרשמה בקשת משתמש חדשה:",
    "",
    name ? `שם: ${name}` : null,
    `אימייל: ${email}`,
    phone ? `טלפון: ${phone}` : null,
    cohort ? `מחזור: ${cohort}` : null,
    "",
    appUrl ? `ניהול משתמשים: ${appUrl}/admin` : "ניהול משתמשים: /admin"
  ].filter(Boolean);

  await sendEmail(admins, subject, lines.join("\n"));
});

export const notifyUserApproved = onDocumentUpdated("users/{email}", async (event) => {
  const before = event.data?.before.data() as DirectoryUser | undefined;
  const after = event.data?.after.data() as DirectoryUser | undefined;
  if (!before || !after) return;

  const beforeRole = before.role || "pending";
  const afterRole = after.role || "pending";
  if (beforeRole !== "pending") return;
  if (afterRole === "pending") return;

  const email = String(after.email || event.params.email || "").toLowerCase();
  if (!email) return;

  const name = (after.name || "").trim();
  const subject = "החשבון שלך אושר - מערכת שריון חדרים";
  const lines = [
    (name ? `שלום ${name},` : "שלום,"),
    "",
    "החשבון שלך אושר ואת/ה יכול/ה להתחבר למערכת שריון חדרים.",
    "",
    appUrl ? `כניסה: ${appUrl}` : "כניסה: (פתח את האתר)",
    "",
    "אם משהו לא עובד - פנה/י למנהל."
  ];

  await sendEmail([email], subject, lines.join("\n"));
});

