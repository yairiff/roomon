export const isFirebaseStorageDownloadUrl = (url: string) =>
  typeof url === "string" && url.includes("firebasestorage.googleapis.com/");

export const isGoogleUserContentUrl = (url: string) =>
  typeof url === "string" &&
  (url.includes("googleusercontent.com/") || url.includes("lh3.googleusercontent.com/"));

export const isPersistentProfileUrl = (url: string) =>
  typeof url === "string" && Boolean(url.trim()) && !isGoogleUserContentUrl(url);

export const shouldAttemptPhotoSync = (args: {
  email: string;
  sourceUrl: string;
  storedUrl: string;
  storedSize?: number | null;
  targetSize?: number;
  cooldownMs?: number;
}) => {
  const {
    email,
    sourceUrl,
    storedUrl,
    storedSize,
    targetSize = 512,
    cooldownMs = 24 * 60 * 60 * 1000
  } = args;
  if (!email) return false;
  if (!sourceUrl || !isGoogleUserContentUrl(sourceUrl)) return false;
  const hasPersistentStoredUrl = isPersistentProfileUrl(storedUrl);
  if (storedUrl && isFirebaseStorageDownloadUrl(storedUrl)) {
    if (typeof storedSize === "number" && Number.isFinite(storedSize) && storedSize >= targetSize) return false;
  }

  // No persistent URL yet: keep trying (call-site handles in-flight + short failure backoff).
  if (!hasPersistentStoredUrl) return true;

  try {
    const effectiveCooldownMs = cooldownMs;
    const key = `rimon_photo_sync_v2:${email.toLowerCase()}:s${targetSize}`;
    const last = Number(localStorage.getItem(key) || "0");
    if (Number.isFinite(last) && Date.now() - last < effectiveCooldownMs) return false;
  } catch {
    // ignore
  }

  return true;
};

export const markPhotoSyncAttempt = (email: string, targetSize = 512) => {
  try {
    const key = `rimon_photo_sync_v2:${email.toLowerCase()}:s${targetSize}`;
    localStorage.setItem(key, String(Date.now()));
  } catch {
    // ignore
  }
};
