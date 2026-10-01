import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail,
  sendEmailVerification }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, collectionGroup, addDoc, getDocs, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Same Firebase project as the Sellora app — so the login accounts and the access list
// (perms/{email}) are shared. This app is a separate frontend + its own backend, nothing more.
/* Creating a printer's account, and letting them change their own PIN, both go straight to the
 * identity service: the SDK's createUser would sign the ADMIN out and in as the printer. */
const FB_KEY = "AIzaSyCBHVKB0bXdawmz2dpAncrWonDZjfRjgqM";
const firebaseConfig = {
  apiKey: FB_KEY,
  authDomain: "price-research-48ff3.firebaseapp.com",
  projectId: "price-research-48ff3",
  storageBucket: "price-research-48ff3.firebasestorage.app",
  messagingSenderId: "998139754721",
  appId: "1:998139754721:web:83bc28cd1f7548ab055fa0"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---- India Stock: now UPLOADED by the user in the "India Stock" tab (Firestore repl/indiastock).
// The old read-only pillow-tracker connection was removed — that project's free read quota was the
// reason, and the user maintains this list themselves now.
let INDIA_STOCK = {}, INDIA_LOADED = false;   // sku↑ → qty
let INDIA_ROWS = [], INDIA_AT = null;         // rows + the moment the warehouse workbook was read
let INDIA_CACHED = false;                     // true while showing the last read rather than a fresh one
let FBA_STOCK = {};   // sku↑ → Total Stock + AWD Available + AWD Transit, built from the Replenishment snapshot
// Lead times in days, used to decide whether a month's shortfall can still be reached by sea or must
// fly. Editable in the Replenishment toolbar. Declared UP HERE because that toolbar wiring runs during
// module evaluation — a `let` further down would be in its temporal dead zone and kill the whole script.
// disp = days to actually get ready goods OUT of India (booking, pickup, gate-in). It applies once the
// goods exist — whether that is India stock on hand today or a production run finishing later.
let LEAD = { prod: 45, disp: 3, air: 15, sea: 80 };
function loadLead() {
  try {
    const s = JSON.parse(localStorage.getItem('repl_lead') || 'null');
    if (s) ['prod', 'disp', 'air', 'sea'].forEach(k => { const n = Number(s[k]); if (isFinite(n) && n >= 0) LEAD[k] = n; });
  } catch (e) {}
}

const $ = id => document.getElementById(id);
const nf = v => (v == null || v === '' ? '' : Number(v).toLocaleString('en-US'));
const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const BRAND_NAME = { SP: 'Ridhi', CPC: 'CPC' };

let API = null;               // { url, key } from Firestore config/replapi
// The PRICE RESEARCH backend, read separately. Shopify is connected only there — this app's own
// Apps Script has no Shopify at all — so the Shopify tab has to go through it.
let PRAPI = null;             // { url, key } from Firestore config/api
let ACCESS_ERR = '';          // set when Firestore DENIES a read — surfaced instead of "no data yet"
let ME = { email: '', admin: false, repl: false, tabs: [], tabsExplicit: false, prodEdit: false, rateApprove: false, fgiEdit: false, fgiEntry: false, empEdit: false, hrEmpOnly: false };
/* 'follow' (Ongoing Purchase Order) and 'india' (India Stock) were dropped on 08 Sep 2026: the
 * first is not wanted, and India stock now comes from the system rather than an uploaded workbook.
 * The PANES and their code are still in this page but unreachable, because what they READ is not
 * theirs alone — poQtyMap() and INDIA_STOCK feed the forecast, the lane decision, Article Review,
 * Create-PO, Top ASIN Status and Replenishment's own India Stock column, and all of those load
 * through ensureRepl/ensureProd, never through these two tabs. */
/* 'prod' (In Production) was dropped on 22 Sep 2026 — Ravi: "remove in production bucket, there is no
 * need now". Its figures still feed Replenishment's In Production column and the forecast, which load
 * through ensureProd; only the screen is gone. */
const REPL_TABS = ['repl', 'article', 'target', 'top', 'shopify', 'pack',
  /* 'cx' (Customer Orders) was dropped on 08 Sep 2026 — its adjustment and production routes were
   * never built, and pt_cxOrders was never written to. Its pane stays in the page, unreachable. */
  /* Quality Control is three jobs, not one: 'qc' is the checks, 'qcalt' is sending rejects out for
   * alteration, 'qcret' is taking them back. One tab, three grants. */
  'pmdb', 'mst', 'att', 'pbase', 'pcut', 'ppress', 'qc', 'qcalt', 'qcret', 'ord', 'so', 'vord', 'vreq', 'rfd', 'vend', 'vlog', 'palloc', 'fgi', 'fba', 'fab', 'acc', 'rep', 'pa', 'ka', 'hr',
  'shop', 'adj', 'shopprod', 'dash'];   // section keys, gated per-user via perms.replTabs — 'dash' is the admins' dashboard
let REPL = { SP: null, CPC: null };   // brand → { rows, at }
let PO = [];                  // purchase orders

