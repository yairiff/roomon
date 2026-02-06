import * as admin from "firebase-admin";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { randomUUID } from "crypto";
import type { CallableRequest } from "firebase-functions/v2/https";

admin.initializeApp();

type DirectoryUser = {
  email?: string;
  name?: string;
  phone?: string;
  pictureUrl?: string;
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

const getAdminEmails = async (): Promise<string[]> => {
  const snapshot = await admin.firestore().collection("users").where("role", "==", "admin").get();
  const emails = snapshot.docs
    .map((docSnap: FirebaseFirestore.QueryDocumentSnapshot) => (docSnap.data() as DirectoryUser).email || docSnap.id)
    .map((email: string) => String(email || "").toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(emails));
};

export const notifyAdminsNewUser = onDocumentCreated("users/{email}", async (event: any) => {
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

export const notifyUserApproved = onDocumentUpdated("users/{email}", async (event: any) => {
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

const isGooglePhotoUrl = (url: string) => {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      (u.hostname.endsWith("googleusercontent.com") || u.hostname === "lh3.googleusercontent.com")
    );
  } catch {
    return false;
  }
};

const normalizeGooglePhotoUrl = (url: string, size: number) => {
  // Google profile photos often support "=s{N}-c" suffix.
  // Keep it small and cache-friendly to stay within free-tier storage.
  if (!isGooglePhotoUrl(url)) return url;
  const base = url.split("=")[0];
  return `${base}=s${size}-c`;
};

export const syncProfilePhoto = onCall(async (request: CallableRequest<{ sourceUrl?: string }>) => {
  const emailRaw = request.auth?.token?.email;
  const uid = request.auth?.uid;
  if (!emailRaw || !uid) {
    throw new HttpsError("unauthenticated", "Missing auth context.");
  }

  const email = String(emailRaw).toLowerCase();
  const sourceUrl = String(request.data?.sourceUrl || "");
  if (!sourceUrl || !isGooglePhotoUrl(sourceUrl)) {
    throw new HttpsError("invalid-argument", "Invalid sourceUrl.");
  }

  const sizedUrl = normalizeGooglePhotoUrl(sourceUrl, 128);
  const response = await fetch(sizedUrl, {
    headers: {
      // A stable UA helps some CDNs behave consistently.
      "User-Agent": "rimon-room-booking/1.0"
    }
  });
  if (!response.ok) {
    throw new HttpsError("unavailable", `Failed to fetch profile photo (${response.status}).`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) {
    throw new HttpsError("invalid-argument", "Profile photo content-type is not an image.");
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const MAX_BYTES = 300 * 1024;
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_BYTES) {
    throw new HttpsError("invalid-argument", "Profile photo is too large.");
  }

  const ext =
    contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
        ? "webp"
        : contentType.includes("gif")
          ? "gif"
          : "jpg";

  const path = `profilePhotos/${uid}.${ext}`;
  const token = randomUUID();
  const bucket = admin.storage().bucket();
  await bucket.file(path).save(bytes, {
    resumable: false,
    metadata: {
      contentType,
      cacheControl: "public, max-age=604800, immutable",
      metadata: {
        firebaseStorageDownloadTokens: token
      }
    }
  });

  const bucketName = bucket.name;
  const objectName = encodeURIComponent(path); // keep "/" as %2F
  const pictureUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${objectName}?alt=media&token=${token}`;

  await admin.firestore().doc(`users/${email}`).set(
    {
      email,
      pictureUrl,
      pictureUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  return { pictureUrl };
});
