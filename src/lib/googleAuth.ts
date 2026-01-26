export type GoogleProfile = {
  email?: string;
  name?: string;
  given_name?: string;
  picture?: string;
};

let scriptPromise: Promise<void> | undefined;

export function loadGoogleScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (document.querySelector("script[data-google-identity]")) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google script failed"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function decodeJwt(token: string): GoogleProfile | null {
  if (!token) return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const jsonPayload = decodeURIComponent(
    atob(base64)
      .split("")
      .map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
      .join("")
  );
  try {
    return JSON.parse(jsonPayload) as GoogleProfile;
  } catch {
    return null;
  }
}
