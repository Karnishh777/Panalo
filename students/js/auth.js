// Signing in, signing up, unlocking and recovery for Panalo Students.
//
// The rules here are Panalo Chat's (src/auth.js), because they protect the
// same encryption keys in the same database and must not drift apart:
//   - keys are set up or recovered with the password at login;
//   - a password that opens the account but not the stored key is NEVER
//     waved through: we ask for the earlier password and re-protect the key,
//     or every new message would go out in the clear;
//   - a password reset re-protects the cached key, or regenerates keys and
//     says plainly that older messages are gone.
import { supabaseClient, setRemember } from "../../src/client.js";
import { state, conversationKeys } from "../../src/state.js";
import { withBusy, showToast, redirectUrl } from "../../src/util.js";
import { ensureUserKeys, idbDelKey, idbGetKey, rewrapPrivateKey, clearKeyProblems } from "../../src/encryption.js";
import { clearAttachmentCache } from "../../src/attachments.js";
import { clearPersistedIndex } from "../../src/search.js";
import { stopPresence } from "../../src/presence.js";
import { validatePassword, describePasswordPolicy, breachedPassword } from "../../src/password.js";
import { captcha } from "../../src/captcha.js";
import { ageGate, validCode } from "./age-gate.js";
import { clearTimer } from "./timer-state.js";
import { stopSync } from "./sync.js";
import { keysAfterPasswordReset } from "../../src/keyflow.js";

const $ = (id) => document.getElementById(id);
const FORMS = ["login-form", "forgot-form", "signup-form", "otp-form", "unlock-form", "recovery-form", "age-form", "guardian-form", "young-form", "parent-start-form", "parent-code-form", "parent-decide"];
const USERNAME_RE = /^[a-z0-9._]{3,30}$/i;

let hooks = { onReady: () => {}, onSignedOut: () => {} };
let pending = { email: "", password: "", session: null, rewrap: "" };
let inRecovery = false;

function message(text, ok = false) {
  const m = $("auth-message");
  m.dataset.tone = ok ? "ok" : "error";
  m.textContent = text || "";
}

export function showForm(id) {
  FORMS.forEach((f) => ($(f).hidden = f !== id));
  message("");
  const first = $(id).querySelector("input");
  if (first && window.matchMedia("(min-width: 861px)").matches) setTimeout(() => first.focus(), 60);
}

// Encryption that fails silently is how a chat ends up unencrypted without
// anyone noticing; say what happened.
function reportKeyStatus(status) {
  if (status === "ready") return;
  const text = {
    unsupported: "This browser can't encrypt messages — chats will be unencrypted here.",
    "setup-failed": "Couldn't set up your encryption keys. Messages won't be encrypted until this is fixed.",
    "needs-unlock": "Your messages are locked on this device until you unlock them.",
  }[status] || "Encryption isn't available right now — messages won't be encrypted.";
  showToast(text, "");
}

function showUnlock(session, reason) {
  pending.session = session;
  $("unlock-lead").textContent =
    reason === "password-mismatch"
      ? "Your messages were locked with a different password than the one you just used. Enter that earlier password and we'll move them to your current one."
      : "Your messages are encrypted. Enter your password to open them on this device.";
  hooks.onNeedsUnlock?.();
  showForm("unlock-form");
}

async function ready(session, { fresh = false } = {}) {
  state.currentUser = session.user;
  state.currentUsername = session.user.user_metadata?.username || session.user.email?.split("@")[0] || "you";
  // How old, and if under 18, has a parent agreed? (age-gate.js)
  // The crossing is shown only if there's a question to ask.
  await ageGate({ show: (id) => (hooks.onNeedsUnlock?.(), showForm(id)), signOut: async () => { await signOut(); location.hash = "#login"; location.reload(); } });
  await hooks.onReady(session, { fresh });
}

export async function signOut() {
  // Nothing typed during sign-in or recovery outlives the session.
  pending = { email: "", password: "", session: null, rewrap: "" };
  stopSync();
  clearTimer({ everywhere: false });
  try {
    localStorage.removeItem("panalo.students.synced");
  } catch {}
  if (state.currentUser) await idbDelKey(state.currentUser.id);
  stopPresence();
  state.myPrivateKey = null;
  state.myPublicKeyB64 = null;
  clearAttachmentCache();
  await clearPersistedIndex(); // Panalo Chat's on-device search index, if this browser has one
  conversationKeys.clear();
  clearKeyProblems();
  await supabaseClient.auth.signOut();
  state.currentUser = null;
  state.currentUsername = "";
  hooks.onSignedOut();
}

export function initAuth(h) {
  hooks = { ...hooks, ...h };
  $("password-hint").textContent = describePasswordPolicy();

  document.querySelectorAll(".pw-reveal").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = $(btn.dataset.reveal);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? "Hide" : "Show";
      btn.setAttribute("aria-pressed", String(show));
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  });

  $("forgot-open").addEventListener("click", () => {
    $("forgot-email").value = $("login-email").value;
    showForm("forgot-form");
  });
  $("forgot-back").addEventListener("click", () => showForm("login-form"));

  $("login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    withBusy($("login-submit"), "Crossing…", async () => {
      const email = $("login-email").value.trim();
      const password = $("login-password").value;
      if (!email || !password) return message("Enter your email and password.");
      setRemember($("login-remember").checked);
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password, options: await captcha() });
      if (error && /not confirmed/i.test(error.message)) {
        // Signed up but never entered the code: finish that instead.
        pending.email = email;
        pending.password = password;
        showForm("otp-form");
        return message("Your email isn't confirmed yet. Enter the code we sent, or send a new one.");
      }
      if (error) return message(/invalid/i.test(error.message) ? "That email and password don't match." : error.message);
      state.currentUser = data.session.user;
      const status = await ensureUserKeys(password);
      if (status === "wrong-password") {
        pending.rewrap = password;
        return showUnlock(data.session, "password-mismatch");
      }
      reportKeyStatus(status);
      await ready(data.session);
    });
  });

  $("signup-form").addEventListener("submit", (e) => {
    e.preventDefault();
    withBusy($("signup-submit"), "Creating…", async () => {
      const username = $("signup-username").value.trim().replace(/^@/, "");
      const email = $("signup-email").value.trim();
      const password = $("signup-password").value;
      if (!USERNAME_RE.test(username)) return message("Usernames are 3–30 letters, numbers, dots or underscores.");
      if (!email) return message("Enter your email.");
      const weak = validatePassword(password);
      if (weak) return message(weak);
      const leaked = await breachedPassword(password);
      if (leaked) return message(leaked);
      const by = Number($("signup-birth-year").value), bm = Number($("signup-birth-month").value);
      if (!bm || !by) return message("Enter your month and year of birth.");
      const now = new Date();
      const age = now.getFullYear() - by - (now.getMonth() + 1 <= bm ? 1 : 0);
      if (by > now.getFullYear() || age > 120) return message("That date of birth doesn't look right.");
      if (age < 13) return message("Panalo is for people 13 and over. We'd love to see you when you're 13.");
      if (!$("signup-age").checked) return message("Please agree to the community rules to continue.");
      setRemember(true);
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { username, birth_year: by, birth_month: bm }, emailRedirectTo: redirectUrl(), ...(await captcha()) },
      });
      if (error) {
        // The profile is created by a trigger in the same transaction
        // (phase 14); a taken username is the only thing it refuses.
        return message(/database error saving new user/i.test(error.message) ? `@${username} is taken. Try another.` : error.message);
      }
      if (data.session) {
        state.currentUser = data.session.user;
        reportKeyStatus(await ensureUserKeys(password));
        return ready(data.session, { fresh: true });
      }
      pending.email = email;
      pending.password = password;
      showForm("otp-form");
    });
  });

  $("otp-resend").addEventListener("click", () => {
    withBusy($("otp-resend"), "Sending…", async () => {
      if (!pending.email) return message("Start again from sign-up or log in.");
      const { error } = await supabaseClient.auth.resend({ type: "signup", email: pending.email, options: { emailRedirectTo: redirectUrl(), ...(await captcha()) } });
      if (error) return message(/rate|seconds/i.test(error.message) ? "Wait a minute before asking for another code." : error.message);
      message("A new code is on its way.", true);
    });
  });

  $("otp-form").addEventListener("submit", (e) => {
    e.preventDefault();
    withBusy($("otp-submit"), "Verifying…", async () => {
      const token = $("otp-code").value.trim();
      if (!validCode(token)) return message("Enter the code from the email.");
      const { data, error } = await supabaseClient.auth.verifyOtp({ email: pending.email, token, type: "signup" });
      if (error) return message(error.message);
      if (!data.session) return message("That code didn't sign you in. Try logging in.");
      state.currentUser = data.session.user;
      reportKeyStatus(await ensureUserKeys(pending.password));
      pending.password = "";
      await ready(data.session, { fresh: true });
    });
  });

  $("forgot-form").addEventListener("submit", (e) => {
    e.preventDefault();
    withBusy($("forgot-submit"), "Sending…", async () => {
      const email = $("forgot-email").value.trim();
      if (!email) return message("Enter your email.");
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl(), ...(await captcha()) });
      if (error) return message(error.message);
      // The same words whether or not the address has an account.
      showForm("login-form");
      message("If that address has an account, a reset link is on its way.", true);
    });
  });

  $("unlock-form").addEventListener("submit", (e) => {
    e.preventDefault();
    withBusy($("unlock-submit"), "Unlocking…", async () => {
      const password = $("unlock-password").value;
      if (!password) return;
      const status = await ensureUserKeys(password);
      if (status !== "ready") {
        return message(status === "wrong-password" ? "That password doesn't open your messages." : "Couldn't unlock. Try again.");
      }
      if (pending.rewrap) {
        const r = await rewrapPrivateKey(pending.rewrap);
        pending.rewrap = "";
        showToast(r === "ready" ? "Unlocked — your messages now use your current password." : "Unlocked, but your key couldn't move to the new password. You'll be asked again next time.", r === "ready" ? "success" : "");
      }
      $("unlock-password").value = "";
      const session = pending.session;
      pending.session = null;
      await ready(session);
    });
  });

  $("unlock-signout").addEventListener("click", async () => {
    pending = { email: "", password: "", session: null, rewrap: "" };
    await supabaseClient.auth.signOut();
    location.hash = "#login";
    location.reload();
  });

  // Password recovery: Supabase parses the link and fires this event.
  supabaseClient.auth.onAuthStateChange(async (event) => {
    if (event !== "PASSWORD_RECOVERY") return;
    inRecovery = true;
    hooks.onRecovery?.();
    const uid = (await supabaseClient.auth.getUser()).data.user?.id;
    const cached = uid ? await idbGetKey(uid) : null;
    $("recovery-lead").textContent = cached
      ? "Your encryption key is cached on this device, so your messages will move to the new password."
      : "Your encryption key isn't cached on this device. A new password means new keys — older encrypted messages will no longer be readable.";
    showForm("recovery-form");
  });

  $("recovery-form").addEventListener("submit", (e) => {
    e.preventDefault();
    withBusy($("recovery-submit"), "Saving…", async () => {
      const next = $("recovery-password").value;
      const weak = validatePassword(next);
      if (weak) return message(weak);
      if (next !== $("recovery-confirm").value) return message("The passwords don't match.");
      const leaked = await breachedPassword(next);
      if (leaked) return message(leaked);
      const { data, error } = await supabaseClient.auth.updateUser({ password: next });
      if (error) return message(error.message);
      state.currentUser = data.user;
      // The same rule as Panalo Chat, from the same code (src/keyflow.js).
      const moved = await keysAfterPasswordReset(next);
      if (moved === "move-failed") return message("Password set, but your key didn't move with it. Try again while signed in.");
      if (moved === "regenerate-failed") return message("Password set, but new keys couldn't be created. Try again.");
      showToast(moved === "moved" ? "Password updated — your messages moved with it." : "New password and new keys. Older encrypted messages can't be read any more.", moved === "moved" ? "success" : "");
      inRecovery = false;
      history.replaceState(null, "", location.pathname);
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session) await ready(session);
    });
  });
}

// On load: restore a stored session, or report there isn't one.
export async function restoreSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (inRecovery) return "recovery";
  if (!session) return "signed-out";
  state.currentUser = session.user;
  const status = await ensureUserKeys(null);
  if (status === "ready" || status === "unsupported") {
    reportKeyStatus(status);
    await ready(session);
    return "ready";
  }
  showUnlock(session, "not-on-device");
  return "locked";
}
