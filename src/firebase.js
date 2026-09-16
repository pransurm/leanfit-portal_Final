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
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyFakeKeyForLeanFitDemo123456789",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "leanfit-portal.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "leanfit-portal",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "leanfit-portal.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "123456789012",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:123456789012:web:abcdef1234567890"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

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
