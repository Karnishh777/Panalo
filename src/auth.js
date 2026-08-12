// Authentication, app bootstrap (initApp), the unlock screen, and session restore.
import { supabaseClient, setRemember } from "./client.js";
import { state, conversationKeys } from "./state.js";
import { withBusy, showToast, redirectUrl } from "./util.js";
import { ensureUserKeys, idbDelKey } from "./encryption.js";
import { fetchConversations } from "./chat.js";
import { startPresence, stopPresence } from "./presence.js";
import { startNotifications, stopNotifications } from "./notifications.js";
import { stopReactions } from "./reactions.js";
import { stopReceipts } from "./receipts.js";
import { startCalls, stopCalls } from "./calls.js";
import { refreshMyProfile } from "./profile.js";
import { MIN_PASSWORD_LENGTH, OTP_LENGTH } from "./config.js";

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
  }
  return false;
}

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
function showUnlockModal(session) {
  state.pendingUnlockSession = session;
  const modal = document.getElementById("unlock-modal");
  const input = document.getElementById("unlock-password");
  input.value = "";
  modal.classList.remove("hidden");
  input.focus();
}

// ---- Wire up all auth-related event listeners + restore an existing session ----
export function initAuth() {
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
      if (password.length < MIN_PASSWORD_LENGTH) {
        setAuthMessage(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
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
        reportKeyStatus(await ensureUserKeys(password));
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
      const session = state.pendingUnlockSession;
      state.pendingUnlockSession = null;
      initApp(session);
    })
  );

  document.getElementById("unlock-logout-btn").addEventListener("click", async () => {
    document.getElementById("unlock-modal").classList.add("hidden");
    await supabaseClient.auth.signOut();
    location.reload();
  });

  // Restore an existing session on load.
  supabaseClient.auth.getSession().then(async ({ data: { session } }) => {
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
