import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { enableIndexedDbPersistence, getFirestore, type Firestore } from "firebase/firestore";
import { getFunctions, type Functions } from "firebase/functions";
import { getStorage, type FirebaseStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId
);

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let functions: Functions | null = null;
let storage: FirebaseStorage | null = null;

if (isFirebaseConfigured) {
  app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  db = getFirestore(app);
  functions = getFunctions(app);
  const bucketRaw = String(firebaseConfig.storageBucket || "").trim();
  const normalizedBucket = bucketRaw.endsWith(".firebasestorage.app")
    ? bucketRaw.replace(/\.firebasestorage\.app$/, ".appspot.com")
    : bucketRaw;
  storage = normalizedBucket ? getStorage(app, `gs://${normalizedBucket}`) : getStorage(app);
  // Cache Firestore data locally to dramatically reduce repeat reads across app sessions.
  // Ignore errors (e.g. multiple tabs, unsupported browser).
  enableIndexedDbPersistence(db).catch(() => {});
}

export { app, db, functions, storage };
