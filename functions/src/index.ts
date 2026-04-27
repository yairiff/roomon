import * as admin from "firebase-admin";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as functionsV1 from "firebase-functions/v1";
import { createHash, randomUUID } from "crypto";
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

type VerifiedGoogleIdentity = {
  email: string;
  sub: string;
  picture: string;
};

const fallbackUidFromEmail = (email: string) => createHash("sha1").update(email.toLowerCase()).digest("hex").slice(0, 28);

const resolveEmailFallbackIdentity = async (emailRaw: string): Promise<VerifiedGoogleIdentity | null> => {
  const email = String(emailRaw || "").trim().toLowerCase();
  if (!email) return null;
  try {
    const snap = await admin.firestore().doc(`users/${email}`).get();
    if (!snap.exists) return null;
    const raw = snap.data() as Record<string, unknown> | undefined;
    const fallbackPicture =
      typeof raw?.pictureUrl === "string"
        ? raw.pictureUrl
        : typeof raw?.picture === "string"
          ? raw.picture
          : typeof raw?.photoURL === "string"
            ? raw.photoURL
            : "";
    return {
      email,
      sub: fallbackUidFromEmail(email),
      picture: String(fallbackPicture || "")
    };
  } catch {
    return null;
  }
};

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

const verifyGoogleIdToken = async (idToken: string): Promise<VerifiedGoogleIdentity | null> => {
  if (!idToken) return null;
  try {
    const ticket = await googleOauthClient.verifyIdToken(
      googleClientId ? { idToken, audience: googleClientId } : { idToken }
    );
    const payload = ticket.getPayload();
    const email = String(payload?.email || "").toLowerCase();
    const sub = String(payload?.sub || "");
    const picture = String(payload?.picture || "");
    const verified = payload?.email_verified !== false;
    if (!email || !sub || !verified) return null;
    return { email, sub, picture };
  } catch {
    return null;
  }
};

const verifyGoogleAccessToken = async (accessToken: string): Promise<VerifiedGoogleIdentity | null> => {
  if (!accessToken) return null;
  try {
    const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as Record<string, unknown>;
    const email = String(payload.email || "").toLowerCase();
    const sub = String(payload.sub || "");
    const picture = String(payload.picture || "");
    const emailVerifiedRaw = payload.email_verified;
    const emailVerified =
      typeof emailVerifiedRaw === "boolean"
        ? emailVerifiedRaw
        : typeof emailVerifiedRaw === "string"
          ? emailVerifiedRaw.toLowerCase() !== "false"
          : true;
    if (!email || !sub || !emailVerified) return null;
    return { email, sub, picture };
  } catch {
    return null;
  }
};

const verifyGoogleIdentityTokens = async (args: {
  idToken?: string;
  accessToken?: string;
}): Promise<VerifiedGoogleIdentity | null> => {
  const idToken = String(args.idToken || "");
  const accessToken = String(args.accessToken || "");
  const byIdToken = await verifyGoogleIdToken(idToken);
  if (byIdToken) return byIdToken;
  return await verifyGoogleAccessToken(accessToken);
};

const extensionFromContentType = (contentType: string) =>
  contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
      ? "webp"
      : contentType.includes("gif")
        ? "gif"
        : "jpg";

const buildStorageDownloadUrl = (bucketName: string, path: string) => {
  const objectName = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://storage.googleapis.com/${bucketName}/${objectName}`;
};

const normalizeBucketName = (bucketName: string) => {
  const normalized = String(bucketName || "").trim().replace(/^gs:\/\//, "").replace(/\/+$/, "");
  if (!normalized) return "";
  if (normalized.endsWith(".firebasestorage.app")) {
    return normalized.replace(/\.firebasestorage\.app$/, ".appspot.com");
  }
  return normalized;
};

const getProfileBucketCandidates = () => {
  const set = new Set<string>();
  const fromOptions = normalizeBucketName(String(admin.app().options.storageBucket || ""));
  const fromEnv = normalizeBucketName(
    String(process.env.FIREBASE_STORAGE_BUCKET || process.env.STORAGE_BUCKET || "")
  );
  const projectId = String(admin.app().options.projectId || process.env.GCLOUD_PROJECT || "");
  if (fromOptions) set.add(fromOptions);
  if (fromEnv) set.add(fromEnv);
  if (projectId) set.add(`${projectId}.appspot.com`);
  return Array.from(set);
};

const saveProfilePhotoToStorage = async (args: {
  path: string;
  bytes: Buffer;
  contentType: string;
  token: string;
}) => {
  const { path, bytes, contentType, token } = args;
  const candidates = getProfileBucketCandidates();
  let lastError: unknown = null;

  for (const bucketName of candidates) {
    const bucket = admin.storage().bucket(bucketName);
    try {
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
      return bucket.name;
    } catch (error: any) {
      const code = Number(error?.code || error?.response?.statusCode || 0);
      if (code === 404) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  if (lastError) {
    throw new HttpsError(
      "failed-precondition",
      "Storage bucket was not found. Configure an existing bucket (for example: <project-id>.appspot.com)."
    );
  }

  throw new HttpsError(
    "failed-precondition",
    "Storage bucket is not configured. Configure Firebase Storage and redeploy functions."
  );
};

export const syncProfilePhoto = onCall(
  async (request: CallableRequest<{ sourceUrl?: string; targetSize?: number; idToken?: string; accessToken?: string; email?: string; force?: boolean }>) => {
    // We don't require Firebase Auth (this app uses Google Identity Services).
    // Instead, we optionally verify the Google ID token when provided.
    const authedEmailRaw = request.auth?.token?.email;
    const authedUid = request.auth?.uid;
    const googleIdToken = String(request.data?.idToken || "");
    const googleAccessToken = String(request.data?.accessToken || "");
    const requestEmail = String(request.data?.email || "").trim().toLowerCase();

    let email = authedEmailRaw ? String(authedEmailRaw).toLowerCase() : "";
    let uid = authedUid ? String(authedUid) : "";

    let googlePictureFromToken = "";
    if (!email || !uid) {
      const verified = await verifyGoogleIdentityTokens({ idToken: googleIdToken, accessToken: googleAccessToken });
      if (verified) {
        email = verified.email;
        uid = verified.sub;
        googlePictureFromToken = verified.picture;
      } else {
        const fallback = await resolveEmailFallbackIdentity(requestEmail);
        if (!fallback) {
          throw new HttpsError("unauthenticated", "Missing auth context.");
        }
        email = fallback.email;
        uid = fallback.sub;
        googlePictureFromToken = fallback.picture;
      }
    } else if (googleIdToken || googleAccessToken) {
      const verified = await verifyGoogleIdentityTokens({ idToken: googleIdToken, accessToken: googleAccessToken });
      if (verified && verified.email === email) {
        googlePictureFromToken = verified.picture;
      }
    }

    const requestedSourceUrl = String(request.data?.sourceUrl || "");
    const sourceUrl = requestedSourceUrl || googlePictureFromToken;
    if (!sourceUrl || !isGooglePhotoUrl(sourceUrl)) {
      throw new HttpsError("invalid-argument", "Invalid sourceUrl.");
    }
    const force = request.data?.force === true;

    const requestedSize = Number(request.data?.targetSize);
    const targetSize = Number.isFinite(requestedSize) ? Math.round(requestedSize) : 1024;
    const clampedSize = Math.min(1024, Math.max(128, targetSize));

    // If we already have a cached Storage URL of sufficient size, return it without re-fetching.
    try {
      const snap = await admin.firestore().doc(`users/${email}`).get();
      if (snap.exists) {
        const data = snap.data() as any;
        if (data?.pictureRemoved === true && !force) {
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

    const ext = extensionFromContentType(contentType);

    const path = `profilePhotos/${uid}/avatar.${ext}`;
    const token = randomUUID();
    const bucketName = await saveProfilePhotoToStorage({
      path,
      bytes,
      contentType,
      token
    });
    const pictureUrl = buildStorageDownloadUrl(bucketName, path);

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

export const uploadProfilePhoto = onCall(
  async (request: CallableRequest<{ imageDataUrl?: string; contentType?: string; idToken?: string; accessToken?: string; email?: string }>) => {
    const googleIdToken = String(request.data?.idToken || "");
    const googleAccessToken = String(request.data?.accessToken || "");
    const requestEmail = String(request.data?.email || "").trim().toLowerCase();
    const verified = await verifyGoogleIdentityTokens({ idToken: googleIdToken, accessToken: googleAccessToken })
      || await resolveEmailFallbackIdentity(requestEmail);
    if (!verified) throw new HttpsError("unauthenticated", "Missing auth context.");

    const email = verified.email;
    const uid = verified.sub;
    const imageDataUrl = String(request.data?.imageDataUrl || "");
    const dataUrlMatch = imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=]+)$/);
    if (!dataUrlMatch) {
      throw new HttpsError("invalid-argument", "Invalid imageDataUrl.");
    }

    const contentType = String(request.data?.contentType || dataUrlMatch[1] || "").toLowerCase();
    if (!contentType.startsWith("image/")) {
      throw new HttpsError("invalid-argument", "Unsupported content type.");
    }
    const bytes = Buffer.from(dataUrlMatch[2], "base64");
    const MAX_BYTES = 5 * 1024 * 1024;
    if (bytes.byteLength <= 0 || bytes.byteLength > MAX_BYTES) {
      throw new HttpsError("invalid-argument", "Profile photo is too large.");
    }

    const ext = extensionFromContentType(contentType);
    const path = `profilePhotos/${uid}/avatar.${ext}`;
    const token = randomUUID();
    const bucketName = await saveProfilePhotoToStorage({
      path,
      bytes,
      contentType,
      token
    });
    const pictureUrl = buildStorageDownloadUrl(bucketName, path);

    await admin.firestore().doc(`users/${email}`).set(
      {
        email,
        pictureUrl,
        pictureRemoved: false,
        pictureSize: 1024,
        pictureUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    return { pictureUrl };
  }
);

type ApiSyncEntityKey = "rooms" | "lessons" | "semesters" | "holidays";

type ApiSyncEntityConfig = {
  enabled: boolean;
  lastSuccessAt?: number;
  lastAttemptAt?: number;
  lastError?: string;
};

type ApiSyncSettings = {
  primaryEndpoint: string;
  intervalMinutes: number;
  entities: Record<ApiSyncEntityKey, ApiSyncEntityConfig>;
  roomIdMap: Record<string, string>;
};

type SemesterHoliday = {
  date: string;
  name: string;
  displayName?: string;
  sortOrder?: number;
  syncSource?: "manual" | "api";
};

type SemesterEntity = {
  id: string;
  studyYear: number;
  letter: string;
  displayName?: string;
  sortOrder?: number;
  syncSource?: "manual" | "api";
  startDate: string;
  endDate: string;
  studyDayKeys: string[];
  holidays: SemesterHoliday[];
};

type ApiRoom = {
  id?: string;
  name?: string;
  description?: string | null;
  capacity?: number | null;
  external_id?: string | null;
};

type ApiClass = {
  id?: string;
  date?: string;
  subject?: string;
  teacher?: string;
  room?: {
    id?: string;
    name?: string;
    external_id?: string | null;
  };
  start_time?: string;
  duration_minutes?: number;
  semester?: string;
  status?: string;
};

type SyncEntityResult = {
  enabled: boolean;
  due: boolean;
  attempted: boolean;
  success: boolean;
  error?: string;
  stats: Record<string, unknown>;
};

type SyncRunResult = {
  ok: boolean;
  force: boolean;
  endpoint: string;
  startedAt: number;
  finishedAt: number;
  entities: Record<ApiSyncEntityKey, SyncEntityResult>;
};

const API_SYNC_ENTITY_KEYS: ApiSyncEntityKey[] = ["rooms", "lessons", "semesters", "holidays"];
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu"] as const;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

const DEFAULT_API_SYNC_SETTINGS: ApiSyncSettings = {
  primaryEndpoint: "https://rimon-school-plan.base44.app/functions/scheduleApi",
  intervalMinutes: 60,
  entities: {
    rooms: { enabled: false },
    lessons: { enabled: false },
    semesters: { enabled: false },
    holidays: { enabled: false }
  },
  roomIdMap: {}
};

const stripUndefinedDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((entry) => stripUndefinedDeep(entry));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, entry]) => {
      if (entry === undefined) return acc;
      acc[key] = stripUndefinedDeep(entry);
      return acc;
    }, {});
  }
  return value;
};

const clampIntervalMinutes = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(15, Math.min(7 * 24 * 60, Math.round(numeric)));
};

const sanitizeRoomIdMap = (raw: unknown): Record<string, string> => {
  if (!raw || typeof raw !== "object") return {};
  return Object.entries(raw as Record<string, unknown>).reduce<Record<string, string>>((acc, [remote, local]) => {
    if (typeof local !== "string") return acc;
    const remoteTrimmed = remote.trim();
    const localTrimmed = local.trim();
    if (!remoteTrimmed || !localTrimmed) return acc;
    acc[remoteTrimmed] = localTrimmed;
    return acc;
  }, {});
};

const sanitizeApiSyncSettings = (raw: unknown): ApiSyncSettings => {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const entitiesRaw =
    source.entities && typeof source.entities === "object"
      ? (source.entities as Record<string, unknown>)
      : {};

  const entities = API_SYNC_ENTITY_KEYS.reduce<Record<ApiSyncEntityKey, ApiSyncEntityConfig>>((acc, key) => {
    const fallback = DEFAULT_API_SYNC_SETTINGS.entities[key];
    const entry = entitiesRaw[key] && typeof entitiesRaw[key] === "object"
      ? (entitiesRaw[key] as Record<string, unknown>)
      : {};
    acc[key] = {
      enabled: entry.enabled === true,
      lastSuccessAt: typeof entry.lastSuccessAt === "number" ? Math.max(0, Math.round(entry.lastSuccessAt)) : undefined,
      lastAttemptAt: typeof entry.lastAttemptAt === "number" ? Math.max(0, Math.round(entry.lastAttemptAt)) : undefined,
      lastError: typeof entry.lastError === "string" ? entry.lastError : undefined
    };
    return acc;
  }, { ...DEFAULT_API_SYNC_SETTINGS.entities });
  const legacyInterval =
    Object.values(entitiesRaw)
      .map((entry) =>
        entry && typeof entry === "object"
          ? Number((entry as Record<string, unknown>).intervalMinutes)
          : Number.NaN
      )
      .find((value) => Number.isFinite(value)) ?? DEFAULT_API_SYNC_SETTINGS.intervalMinutes;

  return {
    primaryEndpoint: (() => {
      if (typeof source.primaryEndpoint !== "string") return DEFAULT_API_SYNC_SETTINGS.primaryEndpoint;
      const trimmed = source.primaryEndpoint.trim();
      return trimmed || DEFAULT_API_SYNC_SETTINGS.primaryEndpoint;
    })(),
    intervalMinutes: clampIntervalMinutes(
      source.intervalMinutes,
      clampIntervalMinutes(legacyInterval, DEFAULT_API_SYNC_SETTINGS.intervalMinutes)
    ),
    entities,
    roomIdMap: sanitizeRoomIdMap(source.roomIdMap)
  };
};

const parseDateKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
};

const dateToDayKey = (dateKey: string): (typeof DAY_KEYS)[number] | null => {
  if (!DATE_KEY_PATTERN.test(dateKey)) return null;
  const day = parseDateKey(dateKey).getUTCDay();
  const map = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
  const key = map[day];
  if (!key || key === "fri" || key === "sat") return null;
  return key;
};

const parseTimeToMinutes = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = trimmed.match(TIME_PATTERN);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
};

const slugify = (value: string) => {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "room";
};

const textHash = (input: unknown) => createHash("sha1").update(JSON.stringify(input)).digest("hex");

const buildApiUrl = (endpoint: string, params: Record<string, string>) => {
  const url = new URL(endpoint);
  Object.entries(params).forEach(([key, value]) => {
    if (!value) return;
    url.searchParams.set(key, value);
  });
  return url.toString();
};

const fetchScheduleApi = async <T>(endpoint: string, params: Record<string, string>): Promise<T> => {
  const response = await fetch(buildApiUrl(endpoint, params), { method: "GET" });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`api_${params.resource || "resource"}_${response.status}:${body}`);
  }
  return (await response.json()) as T;
};

const sanitizeExistingSemesters = (raw: unknown): SemesterEntity[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): SemesterEntity | null => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      const id = typeof item.id === "string" ? item.id.trim() : "";
      const startDate = typeof item.startDate === "string" ? item.startDate.trim() : "";
      const endDate = typeof item.endDate === "string" ? item.endDate.trim() : "";
      if (!id || !DATE_KEY_PATTERN.test(startDate) || !DATE_KEY_PATTERN.test(endDate)) return null;
      const endYear = Number(endDate.slice(0, 4));
      const inferredStudyYear = Number.isFinite(endYear) ? endYear - 1 : Number(startDate.slice(0, 4));
      const studyYearRaw =
        typeof item.studyYear === "number" || typeof item.studyYear === "string"
          ? Number(item.studyYear)
          : inferredStudyYear;
      const studyYear = Number.isFinite(studyYearRaw) ? Math.floor(studyYearRaw) : inferredStudyYear;
      const dayKeys = Array.isArray(item.studyDayKeys)
        ? item.studyDayKeys.filter((day): day is string => typeof day === "string")
        : ["sun", "mon", "tue", "wed", "thu"];
      const displayName = typeof item.displayName === "string" ? item.displayName.trim() : "";
      const sortOrderRaw = Number(item.sortOrder);
      const sortOrder = Number.isFinite(sortOrderRaw) ? Math.round(sortOrderRaw) : undefined;
      const holidays = Array.isArray(item.holidays)
        ? item.holidays
            .map((holiday): SemesterHoliday | null => {
              if (!holiday || typeof holiday !== "object") return null;
              const h = holiday as Record<string, unknown>;
              const date = typeof h.date === "string" ? h.date.trim() : "";
              const name = typeof h.name === "string" ? h.name.trim() : "";
              if (!DATE_KEY_PATTERN.test(date)) return null;
              const displayName = typeof h.displayName === "string" ? h.displayName.trim() : "";
              const sortOrderRaw = Number(h.sortOrder);
              const sortOrder = Number.isFinite(sortOrderRaw) ? Math.round(sortOrderRaw) : undefined;
              return {
                date,
                name: name || "סגירת קמפוס",
                displayName: displayName || undefined,
                sortOrder,
                syncSource: h.syncSource === "api" ? "api" : "manual"
              };
            })
            .filter((holiday): holiday is SemesterHoliday => Boolean(holiday))
        : [];
      return {
        id,
        studyYear,
        letter: typeof item.letter === "string" && item.letter.trim() ? item.letter.trim() : "א",
        displayName: displayName || undefined,
        sortOrder,
        syncSource:
          item.syncSource === "api"
            ? "api"
            : item.syncSource === "manual"
              ? "manual"
              : id.startsWith("api-semester-")
                ? "api"
                : undefined,
        startDate,
        endDate,
        studyDayKeys: dayKeys.length ? dayKeys : ["sun", "mon", "tue", "wed", "thu"],
        holidays
      };
    })
    .filter((entry): entry is SemesterEntity => Boolean(entry))
    .sort((a, b) => {
      const orderA = typeof a.sortOrder === "number" ? a.sortOrder : Number.MAX_SAFE_INTEGER;
      const orderB = typeof b.sortOrder === "number" ? b.sortOrder : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id);
    })
    .map((semester) => ({
      ...semester,
      holidays: [...semester.holidays].sort((a, b) => {
        const orderA = typeof a.sortOrder === "number" ? a.sortOrder : Number.MAX_SAFE_INTEGER;
        const orderB = typeof b.sortOrder === "number" ? b.sortOrder : Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return a.date.localeCompare(b.date);
      })
    }));
};

const syncRoomsFromApi = async (
  db: FirebaseFirestore.Firestore,
  endpoint: string,
  currentRoomIdMap: Record<string, string>
) => {
  const response = await fetchScheduleApi<{ rooms?: ApiRoom[] }>(endpoint, {
    resource: "rooms"
  });
  const remoteRooms = Array.isArray(response.rooms) ? response.rooms : [];

  const roomsSnapshot = await db.collection("rooms").get();
  const existingRooms = new Map<string, FirebaseFirestore.DocumentData>();
  const existingByExternalId = new Map<string, string>();
  const existingByName = new Map<string, string>();
  roomsSnapshot.docs.forEach((docSnap) => {
    const data = docSnap.data();
    existingRooms.set(docSnap.id, data);
    const externalId = typeof data.externalId === "string" ? data.externalId.trim() : "";
    if (externalId) existingByExternalId.set(externalId, docSnap.id);
    const name = typeof data.name === "string" ? data.name.trim().toLowerCase() : "";
    if (name) existingByName.set(name, docSnap.id);
  });

  const nextRoomIdMap: Record<string, string> = { ...currentRoomIdMap };
  const seenLocalIds = new Set<string>();
  const usedIds = new Set<string>(existingRooms.keys());
  const batch = db.batch();
  let changed = 0;
  let upserted = 0;
  let unchanged = 0;
  let closed = 0;
  let invalid = 0;
  let mappedByRoomIdMap = 0;
  let mappedByExternalId = 0;
  let mappedByName = 0;
  let createdLocalId = 0;

  const getUniqueLocalId = (seed: string) => {
    let id = seed;
    let suffix = 1;
    while (usedIds.has(id)) {
      suffix += 1;
      id = `${seed}-${suffix}`;
    }
    usedIds.add(id);
    return id;
  };

  remoteRooms.forEach((room, index) => {
    const remoteId = typeof room.id === "string" ? room.id.trim() : "";
    if (!remoteId) {
      invalid += 1;
      return;
    }
    const name = typeof room.name === "string" && room.name.trim() ? room.name.trim() : remoteId;
    const externalSlug = typeof room.external_id === "string" ? room.external_id.trim() : "";

    let localId = nextRoomIdMap[remoteId] || "";
    if (localId) {
      mappedByRoomIdMap += 1;
    }
    if (!localId || !existingRooms.has(localId)) {
      const byExternal = existingByExternalId.get(remoteId) || "";
      if (byExternal) {
        localId = byExternal;
        mappedByExternalId += 1;
      } else {
        const byName = existingByName.get(name.toLowerCase()) || "";
        if (byName) {
          localId = byName;
          mappedByName += 1;
        } else {
          localId = "";
        }
      }
    }
    if (!localId) {
      localId = getUniqueLocalId(slugify(externalSlug || remoteId));
      createdLocalId += 1;
    }

    nextRoomIdMap[remoteId] = localId;
    seenLocalIds.add(localId);
    const syncHash = textHash({
      remoteId,
      name,
      externalSlug,
      description: room.description || "",
      capacity: room.capacity ?? null
    });
    const normalizedExternalSlug = externalSlug || null;

    const previous = existingRooms.get(localId) || {};
    const previousApiName = typeof previous.apiName === "string" ? previous.apiName.trim() : "";
    const previousApiShortName = typeof previous.apiShortName === "string" ? previous.apiShortName.trim() : "";
    const previousCustomName = typeof previous.name === "string" ? previous.name.trim() : "";
    const previousCustomShortName = typeof previous.shortName === "string" ? previous.shortName.trim() : "";
    const hasCustomName = previousCustomName
      ? previousApiName
        ? previousCustomName !== previousApiName
        : previousCustomName !== name
      : false;
    const hasCustomShortName = previousCustomShortName
      ? previousApiShortName
        ? previousCustomShortName !== previousApiShortName
        : previousCustomShortName !== name
      : false;
    const nextName = hasCustomName ? previousCustomName : name;
    const nextShortName = hasCustomShortName ? previousCustomShortName : name;
    const existingSortOrder = Number(previous.sortOrder);
    const nextSortOrder = Number.isFinite(existingSortOrder) ? Math.round(existingSortOrder) : index + 1;
    if (
      previous.externalId === remoteId &&
      previous.externalSlug === normalizedExternalSlug &&
      previous.apiName === name &&
      previous.apiShortName === name &&
      previous.name === nextName &&
      previous.shortName === nextShortName &&
      Number(previous.sortOrder) === nextSortOrder &&
      previous.syncHash === syncHash &&
      previous.syncSource === "api"
    ) {
      unchanged += 1;
      return;
    }
    changed += 1;
    upserted += 1;
    const payload: Record<string, unknown> = {
      id: localId,
      name: nextName,
      shortName: nextShortName,
      apiName: name,
      apiShortName: name,
      externalId: remoteId,
      externalSlug: normalizedExternalSlug,
      syncSource: "api",
      syncHash,
      isClosed: false,
      sortOrder: nextSortOrder,
      syncUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (typeof room.description === "string") {
      payload.note = room.description;
    }
    if (typeof room.capacity === "number") {
      payload.capacity = room.capacity;
    }
    batch.set(
      db.collection("rooms").doc(localId),
      payload,
      { merge: true }
    );
  });

  roomsSnapshot.docs.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.syncSource !== "api") return;
    if (seenLocalIds.has(docSnap.id)) return;
    changed += 1;
    closed += 1;
    batch.set(
      docSnap.ref,
      {
        isClosed: true,
        syncUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  });

  if (changed > 0) {
    await batch.commit();
  }

  return {
    roomIdMap: nextRoomIdMap,
    changed,
    stats: {
      remoteCount: remoteRooms.length,
      invalid,
      mappedByRoomIdMap,
      mappedByExternalId,
      mappedByName,
      createdLocalId,
      upserted,
      unchanged,
      closed,
      writesCommitted: changed
    }
  };
};

const syncSemestersAndHolidaysFromApi = async (
  endpoint: string,
  currentSemesters: SemesterEntity[],
  syncSemesters: boolean,
  syncHolidays: boolean
) => {
  const previousById = new Map<string, SemesterEntity>();
  currentSemesters.forEach((semester) => previousById.set(semester.id, semester));
  let semesters = currentSemesters;

  if (syncSemesters) {
    const response = await fetchScheduleApi<{
      semesters?: Array<{
        code?: string;
        name?: string;
        start_date?: string;
        end_date?: string;
      }>;
    }>(endpoint, {
      resource: "semesters"
    });
    const remote = Array.isArray(response.semesters) ? response.semesters : [];
    const apiSemesters = remote
      .map((entry, index): SemesterEntity | null => {
        const startDate = typeof entry.start_date === "string" ? entry.start_date.trim() : "";
        const endDate = typeof entry.end_date === "string" ? entry.end_date.trim() : "";
        if (!DATE_KEY_PATTERN.test(startDate) || !DATE_KEY_PATTERN.test(endDate)) return null;
        const code = typeof entry.code === "string" && entry.code.trim() ? entry.code.trim() : String(index + 1);
        const endYear = Number(endDate.slice(0, 4));
        const studyYear = Number.isFinite(endYear) ? endYear - 1 : Number(startDate.slice(0, 4));
        const id = `api-semester-${code}`;
        const previous = previousById.get(id);
        return {
          id,
          studyYear: Number.isFinite(studyYear) ? studyYear : new Date().getFullYear(),
          letter: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : code,
          displayName: typeof previous?.displayName === "string" ? previous.displayName.trim() || undefined : undefined,
          sortOrder:
            typeof previous?.sortOrder === "number" && Number.isFinite(previous.sortOrder)
              ? Math.round(previous.sortOrder)
              : index + 1,
          syncSource: "api",
          startDate,
          endDate,
          studyDayKeys: [...DAY_KEYS],
          holidays: []
        };
      })
      .filter((entry): entry is SemesterEntity => Boolean(entry));
    const manualSemesters = currentSemesters
      .filter((semester) => semester.syncSource !== "api" && !semester.id.startsWith("api-semester-"))
      .map((semester) => ({
        ...semester,
        syncSource: semester.syncSource === "api" ? "manual" : semester.syncSource || "manual"
      }));
    semesters = [...apiSemesters, ...manualSemesters];
  }

  if (syncHolidays) {
    const response = await fetchScheduleApi<{
      holidays?: Array<{ date?: string; campus_closed?: boolean }>;
    }>(endpoint, {
      resource: "holidays"
    });
    const dates = (Array.isArray(response.holidays) ? response.holidays : [])
      .map((entry) => (typeof entry.date === "string" ? entry.date.trim() : ""))
      .filter((date) => DATE_KEY_PATTERN.test(date));

    const manualBySemester = semesters.map((semester) => {
      const previous = previousById.get(semester.id) || semester;
      return (previous.holidays || []).filter((holiday) => holiday.syncSource !== "api");
    });
    const apiBySemester = semesters.map(() => new Map<string, SemesterHoliday>());

    dates.forEach((date) => {
      const semesterIndex = semesters.findIndex((semester) => date >= semester.startDate && date <= semester.endDate);
      if (semesterIndex < 0) return;
      const semester = semesters[semesterIndex];
      const previous = previousById.get(semester.id) || semester;
      const existing = (previous.holidays || []).find(
        (holiday) => holiday.syncSource === "api" && holiday.date === date
      );
      apiBySemester[semesterIndex].set(date, {
        date,
        name: "סגירת קמפוס",
        displayName: typeof existing?.displayName === "string" ? existing.displayName.trim() || undefined : undefined,
        sortOrder:
          typeof existing?.sortOrder === "number" && Number.isFinite(existing.sortOrder)
            ? Math.round(existing.sortOrder)
            : undefined,
        syncSource: "api"
      });
    });

    semesters = semesters.map((semester, index) => {
      const holidays = [...manualBySemester[index], ...Array.from(apiBySemester[index].values())];
      holidays.sort((a, b) => {
        const orderA = typeof a.sortOrder === "number" ? a.sortOrder : Number.MAX_SAFE_INTEGER;
        const orderB = typeof b.sortOrder === "number" ? b.sortOrder : Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return a.date.localeCompare(b.date);
      });
      return {
        ...semester,
        holidays
      };
    });
  }

  return [...semesters].sort((a, b) => {
    const orderA = typeof a.sortOrder === "number" ? a.sortOrder : Number.MAX_SAFE_INTEGER;
    const orderB = typeof b.sortOrder === "number" ? b.sortOrder : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id);
  });
};

const syncLessonsFromApi = async (
  db: FirebaseFirestore.Firestore,
  endpoint: string,
  roomIdMap: Record<string, string>
) => {
  const response = await fetchScheduleApi<{ classes?: ApiClass[] }>(endpoint, {
    resource: "classes"
  });
  const classes = Array.isArray(response.classes) ? response.classes : [];

  const desired = new Map<string, FirebaseFirestore.DocumentData>();
  let skippedMissingIdOrDate = 0;
  let skippedCancelled = 0;
  let skippedNonStudyDay = 0;
  let skippedInvalidTime = 0;
  let skippedInvalidDuration = 0;
  let fallbackRoomMapping = 0;
  let duplicateDocIdCollisions = 0;
  classes.forEach((entry) => {
    const externalId = typeof entry.id === "string" ? entry.id.trim() : "";
    const date = typeof entry.date === "string" ? entry.date.trim() : "";
    if (!externalId || !DATE_KEY_PATTERN.test(date)) {
      skippedMissingIdOrDate += 1;
      return;
    }
    if (entry.status === "cancelled") {
      skippedCancelled += 1;
      return;
    }
    const day = dateToDayKey(date);
    if (!day) {
      skippedNonStudyDay += 1;
      return;
    }
    const startMinutes = parseTimeToMinutes(entry.start_time);
    if (startMinutes === null) {
      skippedInvalidTime += 1;
      return;
    }
    const durationMinutes = Number(entry.duration_minutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      skippedInvalidDuration += 1;
      return;
    }

    const remoteRoomId = typeof entry.room?.id === "string" ? entry.room.id.trim() : "";
    const localRoomId = roomIdMap[remoteRoomId] || remoteRoomId || "unknown-room";
    if (!roomIdMap[remoteRoomId]) {
      fallbackRoomMapping += 1;
    }
    const lessonBaseId = `api-class-${externalId}-${date}`;
    let lessonId = lessonBaseId;
    if (desired.has(lessonId)) {
      duplicateDocIdCollisions += 1;
      lessonId = `${lessonBaseId}-${startMinutes}`;
      if (desired.has(lessonId)) {
        lessonId = `${lessonBaseId}-${startMinutes}-${Math.round(durationMinutes)}`;
      }
    }
    const lesson = {
      id: lessonId,
      title: typeof entry.subject === "string" && entry.subject.trim() ? entry.subject.trim() : "שיעור",
      teacher: typeof entry.teacher === "string" ? entry.teacher.trim() : "",
      day,
      roomId: localRoomId,
      startMinutes,
      durationMinutes: Math.round(durationMinutes)
    };
    const syncHash = textHash({
      date,
      lesson,
      status: entry.status || "scheduled",
      semester: entry.semester || ""
    });
    desired.set(lessonId, {
      id: lessonId,
      date,
      action: "add",
      lesson,
      externalId,
      syncSource: "api",
      syncHash,
      createdBy: "api-sync",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });

  const existingSnapshot = await db
    .collection("lessonOverrides")
    .where("syncSource", "==", "api")
    .get();
  const existing = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  existingSnapshot.docs.forEach((docSnap) => existing.set(docSnap.id, docSnap));

  const setOps: Array<{ id: string; payload: FirebaseFirestore.DocumentData }> = [];
  const deleteOps: FirebaseFirestore.DocumentReference[] = [];

  let changed = 0;
  let unchanged = 0;
  desired.forEach((payload, docId) => {
    const existingDoc = existing.get(docId);
    if (existingDoc) {
      const data = existingDoc.data();
      const payloadExternalId = typeof payload.externalId === "string" ? payload.externalId : "";
      const existingExternalId = typeof data.externalId === "string" ? data.externalId : "";
      if (
        data.syncHash === payload.syncHash &&
        data.date === payload.date &&
        data.action === payload.action &&
        existingExternalId === payloadExternalId &&
        data.syncSource === payload.syncSource
      ) {
        unchanged += 1;
        return;
      }
    }
    changed += 1;
    setOps.push({ id: docId, payload });
  });

  existing.forEach((docSnap, docId) => {
    if (desired.has(docId)) return;
    changed += 1;
    deleteOps.push(docSnap.ref);
  });

  let batchesCommitted = 0;
  if (changed > 0) {
    const CHUNK_SIZE = 450;
    const collectionRef = db.collection("lessonOverrides");
    let cursor = 0;
    while (cursor < setOps.length) {
      const batch = db.batch();
      const end = Math.min(cursor + CHUNK_SIZE, setOps.length);
      for (let index = cursor; index < end; index += 1) {
        const op = setOps[index];
        batch.set(collectionRef.doc(op.id), op.payload, { merge: true });
      }
      await batch.commit();
      batchesCommitted += 1;
      cursor = end;
    }

    cursor = 0;
    while (cursor < deleteOps.length) {
      const batch = db.batch();
      const end = Math.min(cursor + CHUNK_SIZE, deleteOps.length);
      for (let index = cursor; index < end; index += 1) {
        batch.delete(deleteOps[index]);
      }
      await batch.commit();
      batchesCommitted += 1;
      cursor = end;
    }
  }

  return {
    changed,
    stats: {
      remoteCount: classes.length,
      desiredCount: desired.size,
      existingApiOverrideCount: existing.size,
      upserted: setOps.length,
      deleted: deleteOps.length,
      unchanged,
      skippedMissingIdOrDate,
      skippedCancelled,
      skippedNonStudyDay,
      skippedInvalidTime,
      skippedInvalidDuration,
      fallbackRoomMapping,
      duplicateDocIdCollisions,
      batchesCommitted
    }
  };
};

const shouldRunEntity = (entry: ApiSyncEntityConfig, now: number, intervalMinutes: number) => {
  if (!entry.enabled) return false;
  const lastSuccess = typeof entry.lastSuccessAt === "number" ? entry.lastSuccessAt : 0;
  const minIntervalMs = Math.max(15, intervalMinutes) * 60 * 1000;
  return now - lastSuccess >= minIntervalMs;
};

const runScheduleApiSync = async (options?: { force?: boolean }): Promise<SyncRunResult> => {
  const startedAt = Date.now();
  const db = admin.firestore();
  const settingsRef = db.doc("settings/schedule");
  const snap = await settingsRef.get();
  const data = snap.data() as { apiSync?: unknown; semesters?: unknown } | undefined;
  const apiSync = sanitizeApiSyncSettings(data?.apiSync);

  const now = Date.now();
  const force = options?.force === true;
  const nextApiSync: ApiSyncSettings = {
    ...apiSync,
    entities: {
      rooms: { ...apiSync.entities.rooms },
      lessons: { ...apiSync.entities.lessons },
      semesters: { ...apiSync.entities.semesters },
      holidays: { ...apiSync.entities.holidays }
    },
    roomIdMap: { ...apiSync.roomIdMap }
  };

  let nextSemesters: SemesterEntity[] | null = null;
  const existingSemesters = sanitizeExistingSemesters(data?.semesters);

  const roomDue = force ? nextApiSync.entities.rooms.enabled : shouldRunEntity(nextApiSync.entities.rooms, now, nextApiSync.intervalMinutes);
  const semesterDue = force ? nextApiSync.entities.semesters.enabled : shouldRunEntity(nextApiSync.entities.semesters, now, nextApiSync.intervalMinutes);
  const holidayDue = force ? nextApiSync.entities.holidays.enabled : shouldRunEntity(nextApiSync.entities.holidays, now, nextApiSync.intervalMinutes);
  const lessonDue = force ? nextApiSync.entities.lessons.enabled : shouldRunEntity(nextApiSync.entities.lessons, now, nextApiSync.intervalMinutes);

  const runResult: SyncRunResult = {
    ok: true,
    force,
    endpoint: apiSync.primaryEndpoint,
    startedAt,
    finishedAt: startedAt,
    entities: {
      rooms: {
        enabled: nextApiSync.entities.rooms.enabled,
        due: roomDue,
        attempted: false,
        success: false,
        stats: {}
      },
      lessons: {
        enabled: nextApiSync.entities.lessons.enabled,
        due: lessonDue,
        attempted: false,
        success: false,
        stats: {}
      },
      semesters: {
        enabled: nextApiSync.entities.semesters.enabled,
        due: semesterDue,
        attempted: false,
        success: false,
        stats: {}
      },
      holidays: {
        enabled: nextApiSync.entities.holidays.enabled,
        due: holidayDue,
        attempted: false,
        success: false,
        stats: {}
      }
    }
  };

  if (!apiSync.primaryEndpoint) {
    runResult.ok = false;
    runResult.finishedAt = Date.now();
    runResult.entities.rooms.error = "missing_primary_endpoint";
    runResult.entities.lessons.error = "missing_primary_endpoint";
    runResult.entities.semesters.error = "missing_primary_endpoint";
    runResult.entities.holidays.error = "missing_primary_endpoint";
    return runResult;
  }

  const markAttempt = (entity: ApiSyncEntityKey) => {
    nextApiSync.entities[entity].lastAttemptAt = now;
    runResult.entities[entity].attempted = true;
  };
  const markSuccess = (entity: ApiSyncEntityKey, stats?: Record<string, unknown>) => {
    nextApiSync.entities[entity].lastSuccessAt = now;
    nextApiSync.entities[entity].lastError = "";
    runResult.entities[entity].success = true;
    runResult.entities[entity].error = "";
    if (stats) {
      runResult.entities[entity].stats = stats;
    }
  };
  const markError = (entity: ApiSyncEntityKey, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error || "sync_failed");
    const trimmed = message.slice(0, 300);
    nextApiSync.entities[entity].lastError = trimmed;
    runResult.entities[entity].error = trimmed;
    runResult.entities[entity].success = false;
  };

  if (roomDue) {
    markAttempt("rooms");
    try {
      const result = await syncRoomsFromApi(db, apiSync.primaryEndpoint, nextApiSync.roomIdMap);
      nextApiSync.roomIdMap = result.roomIdMap;
      markSuccess("rooms", {
        changed: result.changed,
        ...result.stats
      });
    } catch (error) {
      markError("rooms", error);
    }
  }

  if (semesterDue || holidayDue) {
    if (semesterDue) markAttempt("semesters");
    if (holidayDue) markAttempt("holidays");
    try {
      nextSemesters = await syncSemestersAndHolidaysFromApi(
        apiSync.primaryEndpoint,
        existingSemesters,
        semesterDue && nextApiSync.entities.semesters.enabled,
        holidayDue && nextApiSync.entities.holidays.enabled
      );
      if (semesterDue) {
        markSuccess("semesters", {
          semesterCount: nextSemesters.length
        });
      }
      if (holidayDue) {
        const apiHolidayCount = nextSemesters.reduce(
          (sum, semester) =>
            sum + semester.holidays.filter((holiday) => holiday.syncSource === "api").length,
          0
        );
        markSuccess("holidays", {
          semesterCount: nextSemesters.length,
          apiHolidayCount
        });
      }
    } catch (error) {
      if (semesterDue) markError("semesters", error);
      if (holidayDue) markError("holidays", error);
    }
  }

  if (lessonDue) {
    markAttempt("lessons");
    try {
      const result = await syncLessonsFromApi(
        db,
        apiSync.primaryEndpoint,
        nextApiSync.roomIdMap
      );
      markSuccess("lessons", {
        changed: result.changed,
        ...result.stats
      });
    } catch (error) {
      markError("lessons", error);
    }
  }

  const patch: Record<string, unknown> = {
    apiSync: stripUndefinedDeep(nextApiSync)
  };
  if (nextSemesters) {
    patch.semesters = stripUndefinedDeep(nextSemesters);
    patch.semesterRanges = nextSemesters.map((semester) => ({
      key: semester.id,
      start: semester.startDate,
      end: semester.endDate
    }));
  }
  await settingsRef.set(patch, { merge: true });

  runResult.finishedAt = Date.now();
  runResult.ok = API_SYNC_ENTITY_KEYS.every(
    (entity) => !runResult.entities[entity].attempted || runResult.entities[entity].success
  );
  console.log("scheduleApiSyncResult", JSON.stringify(runResult));
  return runResult;
};

export const runScheduleApiSyncNow = onCall({ invoker: "public" }, async () => {
  const result = await runScheduleApiSync({ force: true });
  return result;
});

// Fallback manual trigger via Gen1 callable. Useful when Gen2 invoker policies
// block unauthenticated callable requests from the client.
export const runScheduleApiSyncNowV1 = functionsV1.https.onCall(async () => {
  const result = await runScheduleApiSync({ force: true });
  return result;
});

export const syncScheduleApi = onSchedule(
  { schedule: "*/15 * * * *", timeZone: "Asia/Jerusalem" },
  async () => {
    // Single recurring job for all entities. Frequency per entity is controlled
    // by the shared API sync interval setting.
    await runScheduleApiSync({ force: false });
  }
);
