// Authentication, app bootstrap (initApp), the unlock screen, and session restore.
import { supabaseClient, setRemember } from "./client.js";
import { state, conversationKeys } from "./state.js";
import { withBusy, showToast, redirectUrl } from "./util.js";
import { ensureUserKeys, idbDelKey, idbGetKey, rewrapPrivateKey, regenerateKeypair } from "./encryption.js";
import { clearAttachmentCache } from "./attachments.js";
import { invalidateSearchIndex } from "./search.js";
import { fetchConversations } from "./chat.js";
import { startPresence, stopPresence } from "./presence.js";
import { startNotifications, stopNotifications } from "./notifications.js";
import { stopReactions } from "./reactions.js";
import { stopReceipts } from "./receipts.js";
import { startCalls, stopCalls } from "./calls.js";
import { startTour } from "./tour.js";
import { refreshMyProfile } from "./profile.js";
import { OTP_LENGTH } from "./config.js";
import { validatePassword, describePasswordPolicy } from "./password.js";

const authScreen = document.getElementById("auth-screen");
const chatApp = document.getElementById("chat-app");
const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const signupStep1 = document.getElementById("signup-step-1");
const signupStep2 = document.getElementById("signup-step-2");
const showSignup = document.getElementById("show-signup");
const showLogin = document.getElementById("show-login");
const authMessage = document.getElementById("auth-message");
const myProfileName = document.getElementById("my-profile-name");
const loginBtn = document.getElementById("login-btn");
const signupBtn = document.getElementById("signup-btn");
const verifyOtpBtn = document.getElementById("verify-otp-btn");
const rememberCheckbox = document.getElementById("remember-me");
const conversationsList = document.getElementById("conversations-list");
const messagesList = document.getElementById("messages-list");
const activeChatWindow = document.getElementById("active-chat-window");
const noChatSelected = document.getElementById("no-chat-selected");

function setAuthMessage(text, ok = false) {
  authMessage.style.color = ok ? "#00a884" : "#f15c6d";
  authMessage.textContent = text;
}

// Encryption is meant to be invisible when it works — but silence when it
// fails is how a chat ends up unencrypted without anyone noticing.
function reportKeyStatus(status) {
  if (status === "ready") return true;
  if (status === "unsupported") {
    showToast("This browser can't encrypt messages — chats will be unencrypted.", "");
  } else if (status === "setup-failed") {
    showToast("Couldn't set up your encryption keys. Messages won't be encrypted until this is fixed.");
  } else if (status === "wrong-password") {
    showToast("Your messages are locked with a different password — they stay unreadable until it's entered.");
  } else if (status === "needs-unlock") {
    showToast("Your messages are locked on this device until you unlock them.");
  } else {
    // Anything unrecognised still has to surface. A key status that reaches
    // the user as silence is how a session ends up sending plaintext while
    // the app claims otherwise.
    showToast("Encryption isn't available right now — messages won't be encrypted.");
  }
  return false;
}

// Copy for the unlock prompt. "Your key isn't on this device" and "your key
// was locked with a different password" are genuinely different problems and
// need different instructions; showing the same sentence for both is what
// made a correct password look rejected.
const UNLOCK_COPY = {
  "not-on-device": "Enter your password to decrypt your chats on this device.",
  "password-mismatch":
    "Your messages were locked with a different password than the one you just used. Enter that earlier password and we'll re-protect them with your current one.",
};

// ---- App bootstrap ----
async function initApp(session) {
  state.currentUser = session.user;
  state.currentUsername = state.currentUser.user_metadata?.username || state.currentUser.email.split("@")[0];
  myProfileName.textContent = state.currentUsername;

  // Only id + username are stored publicly; email stays private in auth.users.
  const { error } = await supabaseClient.from("profiles").upsert({
    id: state.currentUser.id,
    username: state.currentUsername,
  });
  if (error) console.error("Error saving profile:", error.message);

  authScreen.classList.add("hidden");
  chatApp.classList.remove("hidden");

  startPresence(state.currentUser); // go online
  startNotifications();
  startCalls(); // listen for incoming calls anywhere in the app
  await Promise.all([refreshMyProfile(), fetchConversations()]);
}

// ---- Unlock screen (session restored but private key not cached here) ----
function showUnlockModal(session, reason = "not-on-device") {
  state.pendingUnlockSession = session;
  const modal = document.getElementById("unlock-modal");
  const input = document.getElementById("unlock-password");
  const subtitle = document.getElementById("unlock-subtitle");
  if (subtitle) subtitle.textContent = UNLOCK_COPY[reason] || UNLOCK_COPY["not-on-device"];
  input.value = "";
  modal.classList.remove("hidden");
  input.focus();
}

// ---- Wire up all auth-related event listeners + restore an existing session ----
export function initAuth() {
  // State the password rule up front. Discovering it by being rejected is a
  // worse experience than reading one line before you start typing, and the
  // text is generated from the same constants the validator uses, so the two
  // can't drift apart.
  const hint = document.getElementById("password-hint");
  if (hint) hint.textContent = describePasswordPolicy();

  showSignup.addEventListener("click", (e) => {
    e.preventDefault();
    loginForm.classList.add("hidden");
    signupForm.classList.remove("hidden");
    signupStep1.classList.remove("hidden");
    signupStep2.classList.add("hidden");
    authMessage.textContent = "";
  });

  showLogin.addEventListener("click", (e) => {
    e.preventDefault();
    signupForm.classList.add("hidden");
    loginForm.classList.remove("hidden");
    authMessage.textContent = "";
  });

  // Sign up (step 1: create account; step 2 shown only if email confirmation is on)
  signupBtn.addEventListener("click", () =>
    withBusy(signupBtn, "Creating account…", async () => {
      const username = document.getElementById("signup-username").value.trim();
      const email = document.getElementById("signup-email").value.trim();
      const password = document.getElementById("signup-password").value;

      if (!username || !email || !password) {
        setAuthMessage("Please fill in all fields.");
        return;
      }
      const weak = validatePassword(password);
      if (weak) {
        setAuthMessage(weak);
        return;
      }

      setRemember(true);

      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { username }, emailRedirectTo: redirectUrl() },
      });

      if (error) {
        setAuthMessage(error.message);
        return;
      }

      if (data.session) {
        state.currentUser = data.session.user;
        reportKeyStatus(await ensureUserKeys(password));
        initApp(data.session);
        startTour(); // brand-new account: show the welcome tour once
        return;
      }

      state.pendingSignupEmail = email;
      state.pendingSignupPassword = password;
      signupStep1.classList.add("hidden");
      signupStep2.classList.remove("hidden");
      document.getElementById("otp-code-input").focus();
      authMessage.textContent = "";
    })
  );

  // Sign up (step 2: verify email OTP)
  verifyOtpBtn.addEventListener("click", () =>
    withBusy(verifyOtpBtn, "Verifying…", async () => {
      const token = document.getElementById("otp-code-input").value.trim();
      if (token.length !== OTP_LENGTH) {
        setAuthMessage(`Enter the ${OTP_LENGTH}-digit code.`);
        return;
      }

      setRemember(true);

      const { data, error } = await supabaseClient.auth.verifyOtp({
        email: state.pendingSignupEmail,
        token,
        type: "signup",
      });

      if (error) {
        setAuthMessage(error.message);
        return;
      }
      if (data.session) {
        state.currentUser = data.session.user;
        reportKeyStatus(await ensureUserKeys(state.pendingSignupPassword));
        state.pendingSignupPassword = "";
        initApp(data.session);
        startTour(); // account verified for the first time
      }
    })
  );

  // Log in
  loginBtn.addEventListener("click", () =>
    withBusy(loginBtn, "Logging in…", async () => {
      const email = document.getElementById("login-email").value.trim();
      const password = document.getElementById("login-password").value;

      setRemember(rememberCheckbox ? rememberCheckbox.checked : true);

      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) {
        setAuthMessage(error.message);
      } else {
        state.currentUser = data.session.user;
        const keyStatus = await ensureUserKeys(password);
        // The account password was right -- Supabase just accepted it -- but
        // the stored private key was protected with a different one. That
        // happens after a password change made outside this app, or a
        // recovery that only half-completed.
        //
        // This used to fall through to initApp() with no key and no message:
        // old messages showed as locked, and every NEW message was sent as
        // plaintext, because sendMessage() silently skips encryption when
        // there's no conversation key. A session that quietly stops
        // encrypting while the app says it encrypts is the worst possible
        // outcome, so ask for the earlier password instead.
        if (keyStatus === "wrong-password") {
          state.pendingRewrapPassword = password;
          showUnlockModal(data.session, "password-mismatch");
          return;
        }
        reportKeyStatus(keyStatus);
        initApp(data.session);
      }
    })
  );

  // Log out
  document.getElementById("logout-btn").addEventListener("click", async () => {
    if (state.realtimeChannel) {
      supabaseClient.removeChannel(state.realtimeChannel);
      state.realtimeChannel = null;
    }
    // Lock encryption: drop the cached private key + in-memory conversation keys.
    if (state.currentUser) await idbDelKey(state.currentUser.id);
    stopPresence();
    stopNotifications();
    stopReactions();
    stopReceipts();
    stopCalls();
    state.myPrivateKey = null;
    state.myPublicKeyB64 = null;
    state.pendingRewrapPassword = "";
    // Decrypted attachments must not outlive the session allowed to see them.
    clearAttachmentCache();
    // The index holds decrypted message text. It must not survive the
    // session that was allowed to read it.
    invalidateSearchIndex();
    conversationKeys.clear();
    await supabaseClient.auth.signOut();
    state.currentUser = null;
    state.currentUsername = "";
    state.currentConversationId = null;
    conversationsList.innerHTML = "";
    messagesList.innerHTML = "";
    activeChatWindow.classList.add("hidden");
    noChatSelected.classList.remove("hidden");
    chatApp.classList.remove("chat-open");
    chatApp.classList.add("hidden");
    authScreen.classList.remove("hidden");
  });

  // Unlock modal
  const unlockBtn = document.getElementById("unlock-btn");
  unlockBtn.addEventListener("click", () =>
    withBusy(unlockBtn, "Unlocking…", async () => {
      const password = document.getElementById("unlock-password").value;
      if (!password) return;
      const status = await ensureUserKeys(password);
      if (status !== "ready") {
        // Say what actually went wrong. Reporting every failure as a bad
        // password is what made correct passwords look rejected.
        if (status === "wrong-password") showToast("That password doesn't match — your messages stay locked.");
        else reportKeyStatus(status);
        return;
      }
      document.getElementById("unlock-modal").classList.add("hidden");

      // Arriving here from a password mismatch means the key is now in
      // memory, unwrapped with the OLD password. Re-protect it with the one
      // they actually log in with, so the next login just works instead of
      // asking again forever.
      if (state.pendingRewrapPassword) {
        const rewrap = await rewrapPrivateKey(state.pendingRewrapPassword);
        state.pendingRewrapPassword = "";
        showToast(
          rewrap === "ready"
            ? "Unlocked — your messages now use your current password."
            : "Unlocked, but we couldn't move your key to the new password. You'll be asked again next time.",
          rewrap === "ready" ? "success" : ""
        );
      }

      const session = state.pendingUnlockSession;
      state.pendingUnlockSession = null;
      initApp(session);
    })
  );

  document.getElementById("unlock-logout-btn").addEventListener("click", async () => {
    state.pendingRewrapPassword = "";
    document.getElementById("unlock-modal").classList.add("hidden");
    await supabaseClient.auth.signOut();
    location.reload();
  });

  // ---- Forgot password (sends an email link) ----
  const forgotModal = document.getElementById("forgot-password-modal");
  document.getElementById("forgot-password").addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("forgot-email").value = document.getElementById("login-email").value || "";
    forgotModal.classList.remove("hidden");
    document.getElementById("forgot-email").focus();
  });
  document.getElementById("close-forgot-modal").addEventListener("click", () => forgotModal.classList.add("hidden"));

  const sendResetBtn = document.getElementById("send-reset-link");
  sendResetBtn.addEventListener("click", () =>
    withBusy(sendResetBtn, "Sending…", async () => {
      const email = document.getElementById("forgot-email").value.trim();
      if (!email) return showToast("Enter your email.");
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
      if (error) return showToast(error.message);
      // Always the same message whether or not the email exists, so this can't
      // be used to probe which addresses have accounts.
      forgotModal.classList.add("hidden");
      showToast("If that address has an account, a reset link is on its way. Check spam too.", "success");
    })
  );

  // ---- Recovery landing (the app opens with a Supabase recovery token) ----
  // Supabase fires PASSWORD_RECOVERY once it parses the recovery hash. Rather
  // than reason about URLs ourselves, listen for that event.
  const recoveryModal = document.getElementById("recovery-modal");
  let inRecovery = false;
  supabaseClient.auth.onAuthStateChange(async (event) => {
    if (event !== "PASSWORD_RECOVERY") return;
    inRecovery = true;
    authScreen.classList.remove("hidden");
    chatApp.classList.add("hidden");
    // Tell the user whether their messages will survive the reset.
    const uid = (await supabaseClient.auth.getUser()).data.user?.id;
    const cached = uid ? await idbGetKey(uid) : null;
    document.getElementById("recovery-key-hint").textContent = cached
      ? "Your encryption key is cached on this device — we'll re-protect it with the new password so your messages stay readable."
      : "Your encryption key isn't cached on this device. Setting a new password will generate fresh keys — older encrypted messages will become unreadable.";
    ["recovery-new-password", "recovery-confirm-password"].forEach((id) => (document.getElementById(id).value = ""));
    recoveryModal.classList.remove("hidden");
    document.getElementById("recovery-new-password").focus();
  });

  const saveRecoveryBtn = document.getElementById("save-recovery-password");
  saveRecoveryBtn.addEventListener("click", () =>
    withBusy(saveRecoveryBtn, "Setting…", async () => {
      const next = document.getElementById("recovery-new-password").value;
      const confirm = document.getElementById("recovery-confirm-password").value;
      const weakNext = validatePassword(next);
      if (weakNext) return showToast(weakNext);
      if (next !== confirm) return showToast("Passwords don't match.");

      const { data: userData, error } = await supabaseClient.auth.updateUser({ password: next });
      if (error) return showToast(error.message);

      // Try to keep old messages readable: if the private key sits in IndexedDB
      // from a previous session on this device, re-wrap it with the new
      // password. Otherwise, generate new keys and accept the loss.
      state.currentUser = userData.user;
      const cached = await idbGetKey(state.currentUser.id);
      if (cached) {
        state.myPrivateKey = cached;
        const result = await rewrapPrivateKey(next);
        if (result !== "ready") {
          showToast("Password set, but the encryption key didn't move with it. Try again while still signed in.");
          return;
        }
        showToast("Password updated — your messages moved with it.", "success");
      } else {
        const result = await regenerateKeypair(next);
        if (result !== "ready") {
          showToast("Password set, but couldn't create new keys. Try again.");
          return;
        }
        showToast("New password and fresh keys. Older encrypted messages are no longer readable — new ones will work.", "");
      }

      recoveryModal.classList.add("hidden");
      inRecovery = false;
      // Wipe the recovery hash so a refresh doesn't retrigger.
      history.replaceState(null, "", location.pathname);

      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session) initApp(session);
    })
  );

  // Restore an existing session on load.
  supabaseClient.auth.getSession().then(async ({ data: { session } }) => {
    if (inRecovery) return; // the recovery event will drive the flow

    if (!session) return;
    state.currentUser = session.user;
    const status = await ensureUserKeys(null);
    if (status === "ready") {
      initApp(session);
    } else if (status === "unsupported") {
      // No Web Crypto here — asking for a password would achieve nothing.
      reportKeyStatus(status);
      initApp(session);
    } else {
      showUnlockModal(session);
    }
  });
}
