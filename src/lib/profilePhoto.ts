export const isFirebaseStorageDownloadUrl = (url: string) =>
  typeof url === "string" && url.includes("firebasestorage.googleapis.com/");

export const isGoogleUserContentUrl = (url: string) =>
  typeof url === "string" &&
  (url.includes("googleusercontent.com/") || url.includes("lh3.googleusercontent.com/"));

export const shouldAttemptPhotoSync = (args: {
  email: string;
  sourceUrl: string;
  storedUrl: string;
  cooldownMs?: number;
}) => {
  const { email, sourceUrl, storedUrl, cooldownMs = 7 * 24 * 60 * 60 * 1000 } = args;
  if (!email) return false;
  if (!sourceUrl || !isGoogleUserContentUrl(sourceUrl)) return false;
  if (storedUrl && isFirebaseStorageDownloadUrl(storedUrl)) return false;

  try {
    const key = `rimon_photo_sync_v1:${email.toLowerCase()}`;
    const last = Number(localStorage.getItem(key) || "0");
    if (Number.isFinite(last) && Date.now() - last < cooldownMs) return false;
  } catch {
    // ignore
  }

  return true;
};

export const markPhotoSyncAttempt = (email: string) => {
  try {
    const key = `rimon_photo_sync_v1:${email.toLowerCase()}`;
    localStorage.setItem(key, String(Date.now()));
  } catch {
    // ignore
  }
};

