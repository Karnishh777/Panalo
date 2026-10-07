// Panalo Students: outside → crossing → (first time: birth) → inside.
//
// crypto.js and the Supabase SDK are classic scripts loaded before this
// module, so window.PanaloCrypto and window.supabase already exist.
import { startSky } from "./sky.js";
import { initLanding } from "./landing.js";
import { initAuth, restoreSession, showForm, signOut } from "./auth.js";
import { showParent } from "./parent.js";
import { runBirth, needsBirth } from "./birth.js";
import { store, loadStudentProfile, loadAll, resetStore } from "./store.js";
import { initShell, enterShell, leaveShell } from "./shell.js";
import { initLooks } from "./looks.js";
import { reducedMotion } from "./motion.js";
import { showToast } from "./ui.js";
import { state } from "../../src/state.js";

const $ = (id) => document.getElementById(id);
const JOIN_KEY = "panalo.students.join";
// A link to somewhere inside (e.g. #/moderate) opened while signed out:
// remember it through sign-in and go there afterwards.
const AFTER_KEY = "panalo.students.after";
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

let deepLink = false;
function showOutside() {
  if (inside) return;
  if (/^#\/[a-z]+/.test(location.hash)) {
    try {
      sessionStorage.setItem(AFTER_KEY, location.hash);
    } catch {}
    history.replaceState(null, "", "#login");
    deepLink = true;
  }
  const h = location.hash;
  if (h === "#parent") {
    // A parent or guardian approving their child's account.
    $("landing").hidden = true;
    $("auth").hidden = false;
    $("app").hidden = true;
    showParent({ show: showForm });
    window.scrollTo(0, 0);
    return;
  }
  const auth = h === "#login" || h === "#signup" || h.startsWith("#join=");
  $("landing").hidden = auth;
  $("auth").hidden = !auth;
  $("app").hidden = true;
  if (auth) {
    showForm(h === "#signup" ? "signup-form" : "login-form");
    if (deepLink) {
      deepLink = false;
      const msg = $("auth-message");
      msg.dataset.tone = "ok";
      msg.textContent = "Log in, or create an account, to continue to that page.";
    }
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
  let after = null;
  try {
    after = sessionStorage.getItem(AFTER_KEY);
    sessionStorage.removeItem(AFTER_KEY);
  } catch {}
  if (after) history.replaceState(null, "", after);
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
initLooks();
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

// A parent's link never signs anyone into the app.
const boot = location.hash === "#parent" ? Promise.resolve("signed-out") : restoreSession();
boot
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
