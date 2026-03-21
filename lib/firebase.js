// /lib/firebase.js
import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const missingFirebaseKeys = [];
if (!firebaseConfig.apiKey) missingFirebaseKeys.push("NEXT_PUBLIC_FIREBASE_API_KEY");
if (!firebaseConfig.authDomain) missingFirebaseKeys.push("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN");
if (!firebaseConfig.projectId) missingFirebaseKeys.push("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
if (!firebaseConfig.storageBucket) missingFirebaseKeys.push("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET");
if (!firebaseConfig.messagingSenderId) missingFirebaseKeys.push("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID");
if (!firebaseConfig.appId) missingFirebaseKeys.push("NEXT_PUBLIC_FIREBASE_APP_ID");

if (missingFirebaseKeys.length > 0) {
  const errorMessage = `Missing Firebase environment variables: ${missingFirebaseKeys.join(", ")}`;
  if (process.env.NODE_ENV === "production") {
    throw new Error(errorMessage);
  }
  console.warn(errorMessage);
}

// Initialize Firebase (Singleton pattern)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const db = getFirestore(app);
export const auth = getAuth(app);

// Export the app instance too for other services
export default app;
