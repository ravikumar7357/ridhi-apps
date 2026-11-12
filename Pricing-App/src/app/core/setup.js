/* ================= CORE · SETUP: the Firebase SDK and the project it talks to =================
 * Screens: none of its own. This is the first file of the joined script (see app/ORDER); every screen
 * runs on what it makes.
 * Does: loads the Firebase SDK (app, auth, Firestore) straight from Google's CDN — no build step, no
 * node_modules — holds the project's Firebase config, and creates the two objects the rest of the app
 * shares: `app` and `auth`.
 * Main names: firebaseConfig, app, auth. (The Firestore handle `db` and the helpers $, money and pct are
 * created in core/rights-mirror.js, the next file.) */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendEmailVerification }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, addDoc, query, orderBy, limit, getDocs,
  getDocsFromServer, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// The Firebase project. A web app's Firebase config is not a secret: it only names the project, and the
// Firestore rules plus sign-in are what protect the data.
const firebaseConfig = {
  apiKey: "AIzaSyCBHVKB0bXdawmz2dpAncrWonDZjfRjgqM",
  authDomain: "price-research-48ff3.firebaseapp.com",
  projectId: "price-research-48ff3",
  storageBucket: "price-research-48ff3.firebasestorage.app",
  messagingSenderId: "998139754721",
  appId: "1:998139754721:web:83bc28cd1f7548ab055fa0"
};
const app = initializeApp(firebaseConfig);   // the Firebase app
const auth = getAuth(app);                   // sign-in state; auth.currentUser is whoever is signed in

