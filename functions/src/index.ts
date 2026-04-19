import * as admin from "firebase-admin";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { randomUUID } from "crypto";
import type { CallableRequest } from "firebase-functions/v2/https";
import { OAuth2Client } from "google-auth-library";

admin.initializeApp();

type DirectoryUser = {
  email?: string;
  name?: string;
  phone?: string;
  pictureUrl?: string;
  pictureRemoved?: boolean;
  role?: "admin" | "moderator" | "student" | "pending";
  cohortStartYear?: number;
};

const appUrl = process.env.APP_URL || "";
const fromEmail = process.env.SENDGRID_FROM_EMAIL || "";
const fromName = process.env.SENDGRID_FROM_NAME || "רימון - שריון חדרים";
const sendgridApiKey = process.env.SENDGRID_API_KEY || "";
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const googleOauthClient = new OAuth2Client();

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
  // Google profile photos commonly support "=s{N}-c" suffixes.
  // Keep the original URL shape and only replace/append the size marker.
  if (!isGooglePhotoUrl(url)) return url;
  if (/=s\d+-c$/.test(url)) {
    return url.replace(/=s\d+-c$/, `=s${size}-c`);
  }
  return `${url}=s${size}-c`;
};

const verifyGoogleIdToken = async (idToken: string) => {
  if (!idToken) return null;
  try {
    const ticket = await googleOauthClient.verifyIdToken(
      googleClientId ? { idToken, audience: googleClientId } : { idToken }
    );
    const payload = ticket.getPayload();
    const email = String(payload?.email || "").toLowerCase();
    const sub = String(payload?.sub || "");
    const verified = payload?.email_verified !== false;
    if (!email || !sub || !verified) return null;
    return { email, sub };
  } catch {
    return null;
  }
};

export const syncProfilePhoto = onCall(
  async (request: CallableRequest<{ sourceUrl?: string; targetSize?: number; idToken?: string }>) => {
    // We don't require Firebase Auth (this app uses Google Identity Services).
    // Instead, we optionally verify the Google ID token when provided.
    const authedEmailRaw = request.auth?.token?.email;
    const authedUid = request.auth?.uid;
    const googleIdToken = String(request.data?.idToken || "");

    let email = authedEmailRaw ? String(authedEmailRaw).toLowerCase() : "";
    let uid = authedUid ? String(authedUid) : "";

    if (!email || !uid) {
      const verified = await verifyGoogleIdToken(googleIdToken);
      if (!verified) {
        throw new HttpsError("unauthenticated", "Missing auth context.");
      }
      email = verified.email;
      uid = verified.sub;
    }

    const sourceUrl = String(request.data?.sourceUrl || "");
    if (!sourceUrl || !isGooglePhotoUrl(sourceUrl)) {
      throw new HttpsError("invalid-argument", "Invalid sourceUrl.");
    }

    const requestedSize = Number(request.data?.targetSize);
    const targetSize = Number.isFinite(requestedSize) ? Math.round(requestedSize) : 1024;
    const clampedSize = Math.min(1024, Math.max(128, targetSize));

    // If we already have a cached Storage URL of sufficient size, return it without re-fetching.
    try {
      const snap = await admin.firestore().doc(`users/${email}`).get();
      if (snap.exists) {
        const data = snap.data() as any;
        if (data?.pictureRemoved === true) {
          return { pictureUrl: "" };
        }
        const existingUrl = typeof data?.pictureUrl === "string" ? String(data.pictureUrl) : "";
        const existingSize = typeof data?.pictureSize === "number" ? Number(data.pictureSize) : 0;
        if (existingUrl.includes("firebasestorage.googleapis.com/") && existingSize >= clampedSize) {
          return { pictureUrl: existingUrl };
        }
      }
    } catch {
      // ignore
    }

    const sizedUrl = normalizeGooglePhotoUrl(sourceUrl, clampedSize);
    const fetchImage = async (url: string) =>
      fetch(url, {
        headers: {
          // A stable UA helps some CDNs behave consistently.
          "User-Agent": "rimon-room-booking/1.0"
        }
      });
    let response = await fetchImage(sizedUrl);
    if (!response.ok && sizedUrl !== sourceUrl) {
      // Some Google photo URLs do not accept explicit size suffixes.
      response = await fetchImage(sourceUrl);
    }
    if (!response.ok) {
      throw new HttpsError("unavailable", `Failed to fetch profile photo (${response.status}).`);
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      throw new HttpsError("invalid-argument", "Profile photo content-type is not an image.");
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const MAX_BYTES = 2 * 1024 * 1024;
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

    const path = `profilePhotos/${uid}/avatar.${ext}`;
    const token = randomUUID();
    const bucket = admin.storage().bucket();
    await bucket.file(path).save(bytes, {
      resumable: false,
      metadata: {
        contentType,
        cacheControl: "public, max-age=604800",
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
        pictureRemoved: false,
        pictureSize: clampedSize,
        pictureUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return { pictureUrl };
  }
);
