import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signOut, 
  onAuthStateChanged,
  getIdToken
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCqIaeclbQc12rYVwEJRhMKIoNq5yafhrc",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "project-2875a590-5860-4bb6-a46.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "project-2875a590-5860-4bb6-a46",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "project-2875a590-5860-4bb6-a46.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "531999071701",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:531999071701:web:6022d359a6cfbac644f15c",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-D4Z85X7TZK"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

export async function registerWithEmail(email, password) {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const freshToken = await getIdToken(userCredential.user, true);
    return { user: userCredential.user, token: freshToken, error: null };
  } catch (err) {
    return { user: null, error: err.message, code: err.code };
  }
}

export async function loginWithEmail(email, password) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    // Force immediate token refresh so any newly set custom claims (e.g. role: coach) take effect instantly
    const freshToken = await getIdToken(userCredential.user, true);
    return { user: userCredential.user, token: freshToken, error: null };
  } catch (err) {
    return { user: null, error: err.message };
  }
}

export async function logoutUser() {
  try {
    await signOut(auth);
    return { error: null };
  } catch (err) {
    return { error: err.message };
  }
}

export async function getCurrentToken(forceRefresh = false) {
  if (!auth.currentUser) return null;
  try {
    return await getIdToken(auth.currentUser, forceRefresh);
  } catch (err) {
    return null;
  }
}

export async function refreshAuthToken(force = true) {
  if (!auth.currentUser) return null;
  try {
    return await getIdToken(auth.currentUser, force);
  } catch (err) {
    console.warn("Forced token refresh failed:", err);
    return null;
  }
}
