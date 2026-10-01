import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendEmailVerification }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, addDoc, query, orderBy, limit, getDocs, getDocsFromServer, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCBHVKB0bXdawmz2dpAncrWonDZjfRjgqM",
  authDomain: "price-research-48ff3.firebaseapp.com",
  projectId: "price-research-48ff3",
  storageBucket: "price-research-48ff3.firebasestorage.app",
  messagingSenderId: "998139754721",
  appId: "1:998139754721:web:83bc28cd1f7548ab055fa0"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

