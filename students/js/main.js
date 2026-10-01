// Panalo Students: outside → crossing → (first time: birth) → inside.
//
// crypto.js and the Supabase SDK are classic scripts loaded before this
// module, so window.PanaloCrypto and window.supabase already exist.
import { startSky } from "./sky.js";
import { initLanding } from "./landing.js";
import { initAuth, restoreSession, showForm, signOut } from "./auth.js";
import { runBirth, needsBirth } from "./birth.js";
import { store, loadStudentProfile, loadAll, resetStore } from "./store.js";
import { initShell, enterShell, leaveShell } from "./shell.js";
import { reducedMotion } from "./motion.js";
import { showToast } from "./ui.js";
import { state } from "../../src/state.js";

const $ = (id) => document.getElementById(id);
const JOIN_KEY = "panalo.students.join";
let inside = false;
// Restoring a stored session and a fast manual sign-in can both finish;
// only the first may enter, or two births would run on top of each other.
let entering = false;

// An invite link: /students/#join=ABCD2345. Remember it through sign-in.
function captureJoin() {
  const m = location.hash.match(/^#join=([A-Za-z0-9-]{4,16})$/);
  if (!m) return false;
  try {
    sessionStorage.setItem(JOIN_KEY, m[1]);
  } catch {}
  return true;
}

function showOutside() {
  if (inside) return;
  const h = location.hash;
  const auth = h === "#login" || h === "#signup" || h.startsWith("#join=");
  $("landing").hidden = auth;
  $("auth").hidden = !auth;
  $("app").hidden = true;
  if (auth) {
    showForm(h === "#signup" ? "signup-form" : "login-form");
    if (h.startsWith("#join=")) {
      const msg = $("auth-message");
      msg.dataset.tone = "ok";
      msg.textContent = "Log in or create an account to ask to join that room.";
    }
    window.scrollTo(0, 0);
  } else {
    initLanding();
  }
}

async function crossOver() {
  const auth = $("auth");
  if (auth.hidden || reducedMotion()) return;
  auth.classList.add("crossing-over");
  await new Promise((r) => setTimeout(r, 950));
}

async function onReady(session, { fresh }) {
  if (entering || inside) return;
  entering = true;
  document.body.classList.add("ready");
  await crossOver();
  $("auth").hidden = true;
  $("auth").classList.remove("crossing-over");
  $("landing").hidden = true;

  store.me = { id: session.user.id, username: state.currentUsername };
  try {
    await loadStudentProfile();
  } catch (e) {
    console.error(e);
    showToast("Couldn't reach your universe. Check your connection.");
  }
  const loading = loadAll().catch((e) => console.error(e));

  if (needsBirth()) {
    document.body.classList.add("in-birth");
    runBirth({
      onDone: async () => {
        document.body.classList.remove("in-birth");
        await loading;
        enter({ firstTime: true });
      },
    });
    return;
  }
  await loading;
  enter({ firstTime: fresh });
}

function enter({ firstTime = false } = {}) {
  inside = true;
  document.body.classList.add("in-app");
  enterShell({ firstTime, pendingJoin: popJoin() });
}

function popJoin() {
  try {
    const code = sessionStorage.getItem(JOIN_KEY);
    sessionStorage.removeItem(JOIN_KEY);
    return code;
  } catch {
    return null;
  }
}

function onSignedOut() {
  inside = false;
  entering = false;
  resetStore();
  leaveShell();
  document.body.classList.remove("in-app");
  location.hash = "#login";
  showOutside();
}

startSky($("sky"));
initAuth({
  onReady,
  onSignedOut,
  onNeedsUnlock: () => {
    document.body.classList.add("ready");
    $("landing").hidden = true;
    $("auth").hidden = false;
  },
  onRecovery: () => {
    document.body.classList.add("ready");
    $("landing").hidden = true;
    $("app").hidden = true;
    $("auth").hidden = false;
  },
});
initShell({ signOut, replayBirth: () => runBirth({ replay: true, onDone: () => {} }) });

captureJoin();
window.addEventListener("hashchange", () => {
  if (captureJoin() && inside) {
    enterShell({ pendingJoin: popJoin() });
    return;
  }
  if (!inside) showOutside();
});

// Forms are handled in JS; none should ever navigate (boot.js also guards
// this before the modules load).
document.addEventListener("submit", (e) => e.preventDefault());

restoreSession()
  .then((result) => {
    if (result === "signed-out") {
      document.body.classList.add("ready");
      showOutside();
    }
  })
  .catch((e) => {
    console.error(e);
    document.body.classList.add("ready");
    showOutside();
  });
