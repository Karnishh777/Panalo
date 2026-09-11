// App lock, per-chat lock, and hidden chats.
//
// These protect against someone picking up your unlocked device — the same
// threat WhatsApp's chat lock addresses. Be clear-eyed about what they are
// NOT: the PIN never leaves this device and is not an encryption key, so it
// doesn't protect the data on the server. Message secrecy comes from the
// encryption in crypto.js, not from here.
//
// The PIN is stored only as a salted SHA-256 hash, so reading localStorage
// doesn't reveal it.
import { showToast } from "./util.js";
import { supabaseClient } from "./client.js";
import { state } from "./state.js";

// Three independent PINs, so unlocking the app doesn't reveal hidden chats and
// knowing one PIN doesn't grant the others.
export const PIN_PURPOSES = ["app", "chat", "hidden"];
const pinKey = (purpose) => `panalo.lock.pin.${purpose}`;
const APP_LOCK_KEY = "panalo.lock.app";  // "1" when the app itself is locked
const LOCKED_CHATS_KEY = "panalo.lock.chats";
const HIDDEN_CHATS_KEY = "panalo.lock.hidden";

function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

export function hasPin(purpose = "app") {
  return !!read(pinKey(purpose), null);
}

export async function setPin(purpose, pin) {
  if (!/^\d{4,8}$/.test(pin || "")) {
    showToast("Use a PIN of 4–8 digits.");
    return false;
  }
  const salt = toHex(crypto.getRandomValues(new Uint8Array(8)));
  write(pinKey(purpose), { salt, hash: await hashPin(pin, salt) });
  return true;
}

export async function verifyPin(purpose, pin) {
  const stored = read(pinKey(purpose), null);
  if (!stored) return false;
  return (await hashPin(pin, stored.salt)) === stored.hash;
}

export function clearPin(purpose) {
  if (purpose) {
    localStorage.removeItem(pinKey(purpose));
    return;
  }
  PIN_PURPOSES.forEach((p) => localStorage.removeItem(pinKey(p)));
  localStorage.removeItem(APP_LOCK_KEY);
  write(LOCKED_CHATS_KEY, []);
  write(HIDDEN_CHATS_KEY, []);
}

// ---- App lock ----
export function appLockEnabled() {
  return localStorage.getItem(APP_LOCK_KEY) === "1";
}
export function setAppLock(on) {
  if (on) localStorage.setItem(APP_LOCK_KEY, "1");
  else localStorage.removeItem(APP_LOCK_KEY);
}

// ---- Per-chat lock ----
export function isChatLocked(convId) {
  return read(LOCKED_CHATS_KEY, []).includes(convId);
}
export function toggleChatLock(convId) {
  const list = read(LOCKED_CHATS_KEY, []);
  const i = list.indexOf(convId);
  if (i >= 0) list.splice(i, 1);
  else list.push(convId);
  write(LOCKED_CHATS_KEY, list);
  return list.includes(convId);
}

// Unlocked chats stay open for this session only, so closing the app re-locks
// them without the user having to remember to.
const unlockedThisSession = new Set();
export function isChatUnlocked(convId) {
  return !isChatLocked(convId) || unlockedThisSession.has(convId);
}
export function markChatUnlocked(convId) {
  unlockedThisSession.add(convId);
}
export function relockAll() {
  unlockedThisSession.clear();
}

// ---- Hidden chats ----
export function isChatHidden(convId) {
  return read(HIDDEN_CHATS_KEY, []).includes(convId);
}
export function toggleChatHidden(convId) {
  const list = read(HIDDEN_CHATS_KEY, []);
  const i = list.indexOf(convId);
  if (i >= 0) list.splice(i, 1);
  else list.push(convId);
  write(HIDDEN_CHATS_KEY, list);
  return list.includes(convId);
}

// Wipe both lock lists for a chat that's being deleted, and drop it from the
// per-session unlocked set so a re-created chat with the same id isn't
// accidentally "already unlocked".
export function forgetChatLock(convId) {
  write(LOCKED_CHATS_KEY, read(LOCKED_CHATS_KEY, []).filter((id) => id !== convId));
  write(HIDDEN_CHATS_KEY, read(HIDDEN_CHATS_KEY, []).filter((id) => id !== convId));
  unlockedThisSession.delete(convId);
}
export function hiddenCount() {
  return read(HIDDEN_CHATS_KEY, []).length;
}

// Hidden chats are revealed for the session, never persisted as "revealed".
let hiddenRevealed = false;
export function hiddenVisible() {
  return hiddenRevealed;
}
export function setHiddenVisible(on) {
  hiddenRevealed = on;
}

// ---- PIN prompt ----
// One prompt used for every case, so unlocking always looks the same.
export function askPin({ purpose = "app", title = "Enter your PIN", subtitle = "", allowCancel = true } = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById("pin-modal");
    const input = document.getElementById("pin-input");
    const cancel = document.getElementById("pin-cancel");
    const forgot = document.getElementById("pin-forgot");
    document.getElementById("pin-title").textContent = title;
    document.getElementById("pin-subtitle").textContent = subtitle;
    cancel.style.display = allowCancel ? "" : "none";
    // "Forgot?" is only meaningful once the user is signed in — the account
    // password is what proves identity to clear a PIN.
    forgot.parentElement.style.display = state.currentUser ? "" : "none";
    input.value = "";
    modal.classList.remove("hidden");
    setTimeout(() => input.focus(), 50);

    const done = (value) => {
      modal.classList.add("hidden");
      submit.removeEventListener("click", onSubmit);
      cancel.removeEventListener("click", onCancel);
      forgot.removeEventListener("click", onForgot);
      input.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onSubmit = async () => {
      const pin = input.value.trim();
      if (!pin) return;
      if (await verifyPin(purpose, pin)) return done(true);
      input.value = "";
      input.classList.add("shake");
      setTimeout(() => input.classList.remove("shake"), 400);
      showToast("Wrong PIN.");
    };
    const onCancel = () => done(false);
    // Forgotten PIN → verify account password → clear this purpose's PIN.
    // Deliberately not an email round-trip: the PIN is a local salted hash and
    // never leaves the device, so an email link couldn't reset it anyway.
    const onForgot = async (e) => {
      e.preventDefault();
      if (!state.currentUser) {
        showToast("Sign in first, then reset your PIN.");
        return;
      }
      const password = window.prompt("Enter your account password to reset this PIN:");
      if (!password) return;
      const { error } = await supabaseClient.auth.signInWithPassword({
        email: state.currentUser.email,
        password,
      });
      if (error) {
        showToast("That password doesn't match.");
        return;
      }
      clearPin(purpose);
      // App lock loses its guard once its PIN is gone.
      if (purpose === "app") localStorage.removeItem("panalo.lock.app");
      // Locked chats need their PIN — dropping the PIN unlocks all of them.
      if (purpose === "chat") localStorage.setItem("panalo.lock.chats", "[]");
      // Hidden chats stay hidden but no longer need a PIN to reveal.
      showToast("PIN cleared — set a new one in Settings when you like.", "success");
      done(true);
    };
    const onKey = (e) => {
      if (e.key === "Enter") onSubmit();
    };

    const submit = document.getElementById("pin-submit");
    submit.addEventListener("click", onSubmit);
    cancel.addEventListener("click", onCancel);
    forgot.addEventListener("click", onForgot);
    input.addEventListener("keydown", onKey);
  });
}

// Gate the whole app behind the PIN on startup.
export async function enforceAppLock() {
  if (!appLockEnabled() || !hasPin("app")) return;
  document.body.classList.add("app-locked");
  await askPin({
    purpose: "app",
    title: "Panalo is locked",
    subtitle: "Enter your PIN to continue",
    allowCancel: false,
  });
  document.body.classList.remove("app-locked");
}

// ---- The hidden-chats shortcut ----
// Deliberately not a switch in Settings: a visible "show hidden chats" control
// tells anyone holding your phone that there's something to look for. The
// gesture leaves no trace in the interface.
export const SHORTCUT_LABEL = navigator.platform?.toLowerCase().includes("mac")
  ? "⌘ + Shift + H"
  : "Ctrl + Shift + H";

export function initHiddenShortcut(onToggle) {
  const reveal = async () => {
    if (hiddenVisible()) {
      setHiddenVisible(false);
      onToggle(false);
      return;
    }
    if (!hiddenCount()) {
      // Nothing hidden: stay silent rather than confirm the gesture exists.
      return;
    }
    if (hasPin("hidden") && !(await askPin({
      purpose: "hidden",
      title: "Hidden chats",
      subtitle: "Enter your hidden-chats PIN",
    }))) {
      return;
    }
    setHiddenVisible(true);
    onToggle(true);
  };

  document.addEventListener("keydown", (e) => {
    // ⌘⇧H on a Mac, Ctrl+Shift+H elsewhere.
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "h" || e.key === "H")) {
      e.preventDefault();
      reveal();
    }
  });

  // Two-finger tap on touch devices — a quick tap, not a scroll or a pinch.
  let twoFingerStart = 0;
  document.addEventListener("touchstart", (e) => {
    twoFingerStart = e.touches.length === 2 ? Date.now() : 0;
  }, { passive: true });
  document.addEventListener("touchend", (e) => {
    if (!twoFingerStart || e.touches.length) return;
    const quick = Date.now() - twoFingerStart < 400;
    twoFingerStart = 0;
    if (quick) reveal();
  }, { passive: true });
}
