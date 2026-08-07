// ---- Supabase connection ----
// ⬇️ Replace these two values with YOUR new Supabase project's credentials:
//    Supabase Dashboard → Project Settings → API → "Project URL" and the
//    "anon" / publishable key. The anon key is safe to ship in the frontend
//    because Row-Level Security (see supabase-setup.sql) governs all access.
const SUPABASE_URL = "https://zqtvqobonmpxffjxbjpt.supabase.co";
const SUPABASE_KEY = "sb_publishable_TQ1NrHUU3HaIcFRkOWXHuQ_yC3REquy";

// Session persistence: "Keep me logged in" routes the auth session to
// localStorage (survives browser restarts) vs sessionStorage (cleared when the
// tab/browser closes). Default is to remember. All accesses are guarded so that
// storage being unavailable (private mode) never breaks auth.
const REMEMBER_KEY = "panalo.remember";

function rememberEnabled() {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== "false";
  } catch {
    return true;
  }
}

const authStorage = {
  getItem: (key) => {
    try {
      const value = localStorage.getItem(key);
      return value !== null ? value : sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      if (rememberEnabled()) {
        localStorage.setItem(key, value);
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, value);
        localStorage.removeItem(key);
      }
    } catch {
      /* storage unavailable — the session simply won't persist */
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: authStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

function setRemember(value) {
  try {
    localStorage.setItem(REMEMBER_KEY, value ? "true" : "false");
  } catch {
    /* ignore */
  }
}

// Storage prefix that a message image URL must start with to be rendered.
// Rejecting anything else blocks both attribute-injection payloads and
// off-origin image beacons (privacy).
const STORAGE_URL_PREFIX = `${SUPABASE_URL}/storage/`;
const MIN_PASSWORD_LENGTH = 6;
const OTP_LENGTH = 6;

// ---- Elements ----
const authScreen = document.getElementById("auth-screen");
const chatApp = document.getElementById("chat-app");
const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const signupStep1 = document.getElementById("signup-step-1");
const signupStep2 = document.getElementById("signup-step-2");
const showSignup = document.getElementById("show-signup");
const showLogin = document.getElementById("show-login");
const authMessage = document.getElementById("auth-message");

const conversationsList = document.getElementById("conversations-list");
const activeChatWindow = document.getElementById("active-chat-window");
const noChatSelected = document.getElementById("no-chat-selected");
const activeChatTitle = document.getElementById("active-chat-title");
const myProfileName = document.getElementById("my-profile-name");

const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const messagesList = document.getElementById("messages-list");
const fileInput = document.getElementById("file-input");
const fileBtn = document.getElementById("file-btn");
const filePreview = document.getElementById("file-preview");
const sendBtn = document.getElementById("send-btn");

const directModal = document.getElementById("direct-modal");
const groupModal = document.getElementById("group-modal");

const loginBtn = document.getElementById("login-btn");
const signupBtn = document.getElementById("signup-btn");
const verifyOtpBtn = document.getElementById("verify-otp-btn");
const rememberCheckbox = document.getElementById("remember-me");

let currentUser = null;
let currentUsername = "";
let currentConversationId = null;
let realtimeChannel = null;
let pendingSignupEmail = "";
let pendingSignupPassword = "";
let pendingUnlockSession = null;

// Encryption state (see crypto.js)
let myPrivateKey = null; // CryptoKey (RSA) used to unwrap conversation keys
let myPublicKeyB64 = null;
const conversationKeys = new Map(); // conversationId -> AES CryptoKey

// ---- Safe DOM builder ----
// Builds elements without ever parsing strings as HTML. `text` is assigned via
// textContent, so any user-controlled value is inert. This is the single choke
// point that makes stored-XSS structurally impossible in rendered content.
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

// Only allow image URLs served from our own Supabase Storage over http(s).
// Returns a safe URL string or null.
function safeImageUrl(url) {
  if (typeof url !== "string") return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!parsed.href.startsWith(STORAGE_URL_PREFIX)) return null;
  return parsed.href;
}

// Derive the auth redirect from where the app is actually served, so email
// confirmation works in any environment (not just a hardcoded localhost).
function redirectUrl() {
  return window.location.origin + window.location.pathname;
}

// Run an async action while showing a busy state on `button`, preventing
// double-submits. Restores the original label/state afterward no matter what.
async function withBusy(button, busyLabel, fn) {
  if (!button || button.disabled) return;
  const previousLabel = button.textContent;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  if (busyLabel) button.textContent = busyLabel;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = previousLabel;
  }
}

// Lightweight, accessible, non-blocking toast (replaces blocking alert()s and
// silent failures). Announced to screen readers via the aria-live container.
function showToast(message, type = "error") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = el("div", { id: "toast-container", "aria-live": "polite", "aria-atomic": "true" });
    document.body.append(container);
  }
  const toast = el("div", { class: `toast${type ? ` toast-${type}` : ""}`, role: "status", text: message });
  container.append(toast);
  setTimeout(() => {
    toast.classList.add("toast-hide");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function setAuthMessage(text, ok = false) {
  authMessage.style.color = ok ? "#00a884" : "#f15c6d";
  authMessage.textContent = text;
}

// ---- Encryption integration (uses PanaloCrypto from crypto.js) ----
// Keys are set up at login; the private key is cached in IndexedDB so reloads stay
// unlocked, and recovered from the password on a fresh device. If any part is
// unavailable, the app falls back to plaintext so messaging never breaks.

function encryptionReady() {
  return !!(myPrivateKey && myPublicKeyB64 && window.PanaloCrypto && PanaloCrypto.isSupported());
}

function openKeyDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("panalo-keys", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("keys");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGetKey(id) {
  try {
    const db = await openKeyDb();
    return await new Promise((resolve) => {
      const r = db.transaction("keys", "readonly").objectStore("keys").get(id);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
async function idbSetKey(id, value) {
  try {
    const db = await openKeyDb();
    await new Promise((resolve) => {
      const r = db.transaction("keys", "readwrite").objectStore("keys").put(value, id);
      r.onsuccess = () => resolve();
      r.onerror = () => resolve();
    });
  } catch {
    /* ignore */
  }
}
async function idbDelKey(id) {
  try {
    const db = await openKeyDb();
    await new Promise((resolve) => {
      const r = db.transaction("keys", "readwrite").objectStore("keys").delete(id);
      r.onsuccess = () => resolve();
      r.onerror = () => resolve();
    });
  } catch {
    /* ignore */
  }
}

// Ensure this user's keypair is ready in memory. With a password: generate on
// first use, or recover from the server blob. Without a password (session
// restore): succeed only if the private key is cached locally, else return false
// so the caller can prompt to unlock.
async function ensureUserKeys(password) {
  if (!window.PanaloCrypto || !PanaloCrypto.isSupported()) return false;

  const [{ data: keyRow }, { data: profileRow }] = await Promise.all([
    supabaseClient.from("user_keys").select("enc_private_key, key_salt, key_iv").eq("user_id", currentUser.id).maybeSingle(),
    supabaseClient.from("profiles").select("public_key").eq("id", currentUser.id).maybeSingle(),
  ]);

  const hasServerKeys = keyRow && profileRow && profileRow.public_key;

  if (hasServerKeys) {
    myPublicKeyB64 = profileRow.public_key;
    const cached = await idbGetKey(currentUser.id);
    if (cached) {
      myPrivateKey = cached;
      return true;
    }
    if (!password) return false; // needs the user to unlock on this device
    try {
      myPrivateKey = await PanaloCrypto.recoverPrivateKey(
        { encPrivateKey: keyRow.enc_private_key, keySalt: keyRow.key_salt, keyIv: keyRow.key_iv },
        password
      );
      await idbSetKey(currentUser.id, myPrivateKey);
      return true;
    } catch {
      return false; // wrong password
    }
  }

  // First time for this user — needs the password to protect the new private key.
  if (!password) return false;
  try {
    const kp = await PanaloCrypto.generateUserKeypair();
    myPublicKeyB64 = await PanaloCrypto.exportPublicKey(kp.publicKey);
    const stored = await PanaloCrypto.protectPrivateKey(kp.privateKey, password);
    await supabaseClient.from("profiles").update({ public_key: myPublicKeyB64 }).eq("id", currentUser.id);
    await supabaseClient.from("user_keys").upsert({
      user_id: currentUser.id,
      enc_private_key: stored.encPrivateKey,
      key_salt: stored.keySalt,
      key_iv: stored.keyIv,
    });
    myPrivateKey = kp.privateKey;
    await idbSetKey(currentUser.id, myPrivateKey);
    return true;
  } catch (e) {
    console.error("Key setup failed:", e);
    return false;
  }
}

// Get (and cache) the AES key for a conversation by unwrapping our stored copy.
async function getConversationKey(conversationId) {
  if (conversationKeys.has(conversationId)) return conversationKeys.get(conversationId);
  if (!myPrivateKey) return null;
  const { data } = await supabaseClient
    .from("conversation_keys")
    .select("wrapped_key")
    .eq("conversation_id", conversationId)
    .eq("user_id", currentUser.id)
    .maybeSingle();
  if (!data) return null;
  try {
    const key = await PanaloCrypto.unwrapConversationKey(data.wrapped_key, myPrivateKey);
    conversationKeys.set(conversationId, key);
    return key;
  } catch {
    return null;
  }
}

// On conversation creation, make a fresh AES key and wrap it to every member's
// public key. Encrypt ONLY if every member already has a key, so nobody in the
// conversation is ever locked out (otherwise the chat stays plaintext).
async function provisionConversationKey(conversationId, memberIds) {
  if (!encryptionReady()) return;
  try {
    const { data: profs } = await supabaseClient.from("profiles").select("id, public_key").in("id", memberIds);
    const members = profs || [];
    if (members.length < memberIds.length || members.some((p) => !p.public_key)) return;

    const convKey = await PanaloCrypto.generateConversationKey();
    const rows = [];
    for (const p of members) {
      const pub = await PanaloCrypto.importPublicKey(p.public_key);
      rows.push({
        conversation_id: conversationId,
        user_id: p.id,
        wrapped_key: await PanaloCrypto.wrapConversationKey(convKey, pub),
      });
    }
    await supabaseClient.from("conversation_keys").insert(rows);
    conversationKeys.set(conversationId, convKey);
  } catch (e) {
    console.error("Could not set up conversation encryption:", e);
  }
}

// Resolve a message row to displayable plaintext (handles legacy unencrypted rows).
async function messagePlaintext(msg) {
  if (!msg.content) return "";
  if (!msg.iv) return msg.content; // legacy / unencrypted message
  const convKey = await getConversationKey(msg.conversation_id);
  if (!convKey) return "🔒 Encrypted — unlock to read";
  try {
    return await PanaloCrypto.decryptMessage(msg.content, msg.iv, convKey);
  } catch {
    return "🔒 Unable to decrypt";
  }
}

// Unlock screen (session restored but private key not cached on this device).
function showUnlockModal(session) {
  pendingUnlockSession = session;
  const modal = document.getElementById("unlock-modal");
  const input = document.getElementById("unlock-password");
  input.value = "";
  modal.classList.remove("hidden");
  input.focus();
}

const unlockBtn = document.getElementById("unlock-btn");
unlockBtn.addEventListener("click", () =>
  withBusy(unlockBtn, "Unlocking…", async () => {
    const password = document.getElementById("unlock-password").value;
    if (!password) return;
    const ok = await ensureUserKeys(password);
    if (!ok) {
      showToast("Wrong password — could not unlock.");
      return;
    }
    document.getElementById("unlock-modal").classList.add("hidden");
    const session = pendingUnlockSession;
    pendingUnlockSession = null;
    initApp(session);
  })
);

document.getElementById("unlock-logout-btn").addEventListener("click", async () => {
  document.getElementById("unlock-modal").classList.add("hidden");
  await supabaseClient.auth.signOut();
  location.reload();
});

// ---- Avatar helper: colored circle with initial, based on name ----
const AVATAR_COLORS = ["#00d69b", "#6fd3ff", "#ffb86f", "#ff8888", "#c792ff", "#ffe066", "#7ef2c2", "#ff9ecb"];

function getAvatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ---- Auth View Toggle ----
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

// ---- Sign Up (Step 1: create account, trigger email OTP) ----
signupBtn.addEventListener("click", () =>
  withBusy(signupBtn, "Sending…", async () => {
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

    setRemember(true); // new accounts stay logged in by default

    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: { data: { username }, emailRedirectTo: redirectUrl() },
    });

    if (error) {
      setAuthMessage(error.message);
      return;
    }

    // Email confirmation disabled → session issued immediately.
    if (data.session) {
      currentUser = data.session.user;
      await ensureUserKeys(password);
      initApp(data.session);
      return;
    }

    // Email confirmation enabled → verify the 6-digit code in step 2.
    pendingSignupEmail = email;
    pendingSignupPassword = password;
    signupStep1.classList.add("hidden");
    signupStep2.classList.remove("hidden");
    document.getElementById("otp-code-input").focus();
    setAuthMessage("We sent a 6-digit code to your email. Enter it below.", true);
  })
);

// ---- Sign Up (Step 2: verify email OTP) ----
verifyOtpBtn.addEventListener("click", () =>
  withBusy(verifyOtpBtn, "Verifying…", async () => {
    const token = document.getElementById("otp-code-input").value.trim();
    if (token.length !== OTP_LENGTH) {
      setAuthMessage(`Enter the ${OTP_LENGTH}-digit code.`);
      return;
    }

    setRemember(true);

    const { data, error } = await supabaseClient.auth.verifyOtp({
      email: pendingSignupEmail,
      token,
      type: "signup",
    });

    if (error) {
      setAuthMessage(error.message);
      return;
    }
    if (data.session) {
      currentUser = data.session.user;
      await ensureUserKeys(pendingSignupPassword);
      pendingSignupPassword = "";
      initApp(data.session);
    }
  })
);

// ---- Log In ----
loginBtn.addEventListener("click", () =>
  withBusy(loginBtn, "Logging in…", async () => {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    setRemember(rememberCheckbox ? rememberCheckbox.checked : true);

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthMessage(error.message);
    } else {
      currentUser = data.session.user;
      await ensureUserKeys(password);
      initApp(data.session);
    }
  })
);

// ---- Log Out ----
document.getElementById("logout-btn").addEventListener("click", async () => {
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  // Lock encryption: drop the cached private key + in-memory conversation keys.
  if (currentUser) await idbDelKey(currentUser.id);
  myPrivateKey = null;
  myPublicKeyB64 = null;
  conversationKeys.clear();
  await supabaseClient.auth.signOut();
  currentUser = null;
  currentUsername = "";
  currentConversationId = null;
  conversationsList.innerHTML = "";
  messagesList.innerHTML = "";
  activeChatWindow.classList.add("hidden");
  noChatSelected.classList.remove("hidden");
  chatApp.classList.add("hidden");
  authScreen.classList.remove("hidden");
});

// ---- Initialize Main App ----
async function initApp(session) {
  currentUser = session.user;
  currentUsername = currentUser.user_metadata?.username || currentUser.email.split("@")[0];
  myProfileName.textContent = currentUsername;

  // Only id + username are stored publicly; email stays private in auth.users.
  const { error } = await supabaseClient.from("profiles").upsert({
    id: currentUser.id,
    username: currentUsername,
  });
  if (error) console.error("Error saving profile:", error.message);

  authScreen.classList.add("hidden");
  chatApp.classList.remove("hidden");

  await fetchConversations();
}

// ---- Fetch Conversations ----
async function fetchConversations() {
  const { data: rows, error } = await supabaseClient
    .from("conversation_participants")
    .select("conversation_id, conversations(*)")
    .eq("user_id", currentUser.id);

  if (error) {
    console.error("Error fetching conversations:", error.message);
    showToast("Could not load your conversations.");
    return;
  }

  const conversations = (rows || []).map((row) => row.conversations).filter(Boolean);
  await resolveDirectTitles(conversations);

  conversationsList.innerHTML = "";
  conversations.forEach((conv) => renderConversationItem(conv));
}

// For direct chats, the display title is the OTHER participant's username.
// conversations.name is stored once from the creator's perspective, so the
// recipient would otherwise see the chat labeled with their own name. This
// resolves the correct counterpart name for whoever is viewing.
async function resolveDirectTitles(conversations) {
  const directIds = conversations.filter((c) => c.type === "direct").map((c) => c.id);
  if (!directIds.length) return;

  const { data: parts, error } = await supabaseClient
    .from("conversation_participants")
    .select("conversation_id, user_id, profiles(username)")
    .in("conversation_id", directIds);

  if (error || !parts) return; // fall back to the stored name

  const otherName = new Map();
  for (const p of parts) {
    if (p.user_id === currentUser.id) continue;
    if (!otherName.has(p.conversation_id)) {
      otherName.set(p.conversation_id, p.profiles?.username || null);
    }
  }

  for (const conv of conversations) {
    if (conv.type === "direct") {
      conv.displayTitle = otherName.get(conv.id) || conv.name || "Direct Message";
    }
  }
}

// ---- Render Conversation ----
function renderConversationItem(conv) {
  const isGroup = conv.type === "group";
  const title = isGroup ? conv.name : (conv.displayTitle || conv.name || "Direct Message");

  const item = el("div", {
    class: `conv-item${conv.id === currentConversationId ? " active" : ""}`,
    role: "button",
    tabindex: "0",
    "aria-label": `Open ${isGroup ? "group chat" : "direct message"}: ${title}`,
  });

  const avatar = el("div", { class: "avatar", text: (title || "?").trim().charAt(0).toUpperCase() });
  avatar.style.background = getAvatarColor(title || "?");

  item.append(
    avatar,
    el("div", { class: "conv-info" }, [
      el("div", { class: "conv-title", text: title }),
      el("div", { class: "conv-type", text: isGroup ? "Group Chat" : "Direct Message" }),
    ])
  );

  const open = () => openConversation(conv, title);
  item.addEventListener("click", open);
  item.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });

  conversationsList.append(item);
}

// ---- Open Conversation ----
async function openConversation(conv, title) {
  currentConversationId = conv.id;
  activeChatTitle.textContent = title;

  noChatSelected.classList.add("hidden");
  activeChatWindow.classList.remove("hidden");

  fetchConversations();
  await fetchMessages();
  subscribeToMessages();
}

// ---- Modals ----
document.getElementById("new-direct-btn").addEventListener("click", () => directModal.classList.remove("hidden"));
document.getElementById("close-direct-modal").addEventListener("click", () => directModal.classList.add("hidden"));

document.getElementById("new-group-btn").addEventListener("click", () => groupModal.classList.remove("hidden"));
document.getElementById("close-group-modal").addEventListener("click", () => groupModal.classList.add("hidden"));

// Find an existing 1:1 conversation shared with `targetUserId`, or null.
async function findExistingDirect(targetUserId) {
  const { data: mine, error } = await supabaseClient
    .from("conversation_participants")
    .select("conversation_id, conversations!inner(type)")
    .eq("user_id", currentUser.id)
    .eq("conversations.type", "direct");

  if (error || !mine || mine.length === 0) return null;

  const ids = mine.map((row) => row.conversation_id);
  const { data: shared } = await supabaseClient
    .from("conversation_participants")
    .select("conversation_id")
    .eq("user_id", targetUserId)
    .in("conversation_id", ids);

  return shared && shared.length ? shared[0].conversation_id : null;
}

// ---- Create Direct Message ----
const createDirectBtn = document.getElementById("create-direct-btn");
createDirectBtn.addEventListener("click", () =>
  withBusy(createDirectBtn, "Starting…", async () => {
    const usernameField = document.getElementById("direct-username");
    const username = usernameField.value.trim();
    if (!username) return;

    if (username.toLowerCase() === currentUsername.toLowerCase()) {
      showToast("You cannot start a direct chat with yourself.");
      return;
    }

    const { data: targetProfiles, error: lookupError } = await supabaseClient
      .from("profiles")
      .select("id, username")
      .ilike("username", username);

    if (lookupError) {
      showToast("Could not look up that user.");
      return;
    }
    if (!targetProfiles || targetProfiles.length === 0) {
      showToast(`Username "${username}" not found.`);
      return;
    }
    const targetUser = targetProfiles[0];

    // Reuse an existing 1:1 conversation instead of creating a duplicate.
    const existingId = await findExistingDirect(targetUser.id);
    if (existingId) {
      directModal.classList.add("hidden");
      usernameField.value = "";
      const { data: convRow } = await supabaseClient
        .from("conversations")
        .select("*")
        .eq("id", existingId)
        .single();
      await fetchConversations();
      if (convRow) openConversation(convRow, targetUser.username || convRow.name);
      return;
    }

    const { data: newConv, error: convError } = await supabaseClient
      .from("conversations")
      .insert([{ type: "direct", name: targetUser.username }])
      .select()
      .single();

    if (convError || !newConv) {
      showToast("Could not create the chat.");
      return;
    }

    const { error: partError } = await supabaseClient.from("conversation_participants").insert([
      { conversation_id: newConv.id, user_id: currentUser.id },
      { conversation_id: newConv.id, user_id: targetUser.id },
    ]);

    if (partError) {
      showToast("Could not add participants to the chat.");
      return;
    }

    await provisionConversationKey(newConv.id, [currentUser.id, targetUser.id]);

    directModal.classList.add("hidden");
    usernameField.value = "";
    await fetchConversations();
  })
);

// ---- Create Group Chat ----
const createGroupBtn = document.getElementById("create-group-btn");
createGroupBtn.addEventListener("click", () =>
  withBusy(createGroupBtn, "Creating…", async () => {
    const nameField = document.getElementById("group-name-input");
    const membersField = document.getElementById("group-members-input");
    const groupName = nameField.value.trim();
    const usernamesInput = membersField.value.trim();

    if (!groupName) {
      showToast("Please enter a group name.");
      return;
    }

    const usernames = usernamesInput.split(",").map((u) => u.trim()).filter((u) => u.length > 0);

    let foundProfiles = [];
    if (usernames.length) {
      const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, username")
        .in("username", usernames);
      if (error) {
        showToast("Could not look up members.");
        return;
      }
      foundProfiles = data || [];
      const foundNames = new Set(foundProfiles.map((p) => p.username));
      const missing = usernames.filter((u) => !foundNames.has(u));
      if (missing.length) showToast(`Not found: ${missing.join(", ")}`, "");
    }

    const { data: newConv, error: convError } = await supabaseClient
      .from("conversations")
      .insert([{ type: "group", name: groupName }])
      .select()
      .single();

    if (convError || !newConv) {
      showToast("Could not create the group.");
      return;
    }

    const participants = [{ conversation_id: newConv.id, user_id: currentUser.id }];
    foundProfiles.forEach((p) => participants.push({ conversation_id: newConv.id, user_id: p.id }));

    const { error: partError } = await supabaseClient.from("conversation_participants").insert(participants);
    if (partError) {
      showToast("Could not add members to the group.");
      return;
    }

    await provisionConversationKey(newConv.id, [currentUser.id, ...foundProfiles.map((p) => p.id)]);

    groupModal.classList.add("hidden");
    nameField.value = "";
    membersField.value = "";
    await fetchConversations();
  })
);

// ---- Fetch Messages ----
async function fetchMessages() {
  if (!currentConversationId) return;

  const { data, error } = await supabaseClient
    .from("messages")
    .select("*")
    .eq("conversation_id", currentConversationId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching messages:", error.message);
    showToast("Could not load messages.");
    return;
  }

  messagesList.innerHTML = "";
  if (data) data.forEach((msg) => renderMessage(msg));
  scrollToBottom();
}

// ---- Render Message ----
function renderMessage(msg) {
  const isMine = msg.user_id === currentUser.id;

  const messageEl = el("div", {
    class: `message${isMine ? " my-message" : ""}`,
    id: `msg-${msg.id}`,
  });

  messageEl.append(el("div", { class: "message-author", text: isMine ? "You" : (msg.username || "Unknown") }));

  if (msg.content) {
    const textEl = el("div", { class: "message-text", text: msg.iv ? "…" : msg.content });
    messageEl.append(textEl);
    if (msg.iv) {
      messagePlaintext(msg).then((plaintext) => {
        textEl.textContent = plaintext;
      });
    }
  }

  const imageUrl = safeImageUrl(msg.file_url);
  if (imageUrl) {
    messageEl.append(el("img", { class: "chat-image", src: imageUrl, alt: "Shared image", loading: "lazy" }));
  }

  const time = new Date(msg.created_at || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const footer = el("div", { class: "message-footer" }, [el("span", { class: "message-time", text: time })]);
  if (isMine) {
    footer.append(
      el("button", {
        class: "delete-btn",
        type: "button",
        text: "Delete",
        "aria-label": "Delete message",
        onClick: () => deleteMessage(msg.id),
      })
    );
  }
  messageEl.append(footer);

  messagesList.append(messageEl);
}

// ---- Delete Message ----
async function deleteMessage(msgId) {
  const { error } = await supabaseClient.from("messages").delete().eq("id", msgId);
  if (error) showToast("Could not delete the message.");
}

// ---- Image compression (client-side, before upload) ----
// Downscales large photos and re-encodes to WebP/JPEG to save bandwidth, memory,
// and storage — a big win on slow connections and low-end devices. Any failure
// (or no real size gain) falls back to uploading the original untouched.
const MAX_IMAGE_DIMENSION = 1600;
const IMAGE_QUALITY = 0.8;
const COMPRESS_MIN_BYTES = 200 * 1024; // don't bother with already-small images

async function compressImage(file) {
  // Leave GIFs (animation) and already-small files alone.
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  if (file.size <= COMPRESS_MIN_BYTES) return file;

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob =
      (await new Promise((res) => canvas.toBlob(res, "image/webp", IMAGE_QUALITY))) ||
      (await new Promise((res) => canvas.toBlob(res, "image/jpeg", IMAGE_QUALITY)));

    if (!blob || blob.size >= file.size) return file; // no real gain → keep original

    const ext = blob.type === "image/webp" ? "webp" : "jpg";
    const baseName = file.name.replace(/\.[^./\\]+$/, "") || "image";
    return new File([blob], `${baseName}.${ext}`, { type: blob.type });
  } catch {
    return file; // any failure → upload the original
  }
}

// ---- Send Message ----
fileBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) filePreview.classList.remove("hidden");
  else filePreview.classList.add("hidden");
});

messageForm.addEventListener("submit", (e) => {
  e.preventDefault();
  handleSend();
});

async function handleSend() {
  const content = messageInput.value.trim();
  const file = fileInput.files[0];

  if (!content && !file) return;
  if (!currentConversationId) return;

  await withBusy(sendBtn, "…", async () => {
    let fileUrl = null;

    if (file) {
      if (!file.type.startsWith("image/")) {
        showToast("Only image files can be attached.");
        return;
      }
      const toUpload = await compressImage(file);
      const ext = (toUpload.name.split(".").pop() || "img").toLowerCase();
      const fileName = `${Date.now()}_${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabaseClient.storage
        .from("chat-files")
        .upload(fileName, toUpload, { contentType: toUpload.type || undefined });
      if (uploadError) {
        showToast("Image upload failed. Please try again.");
        return;
      }
      const { data: publicUrlData } = supabaseClient.storage.from("chat-files").getPublicUrl(fileName);
      fileUrl = publicUrlData.publicUrl;
    }

    // Clear the composer as soon as we commit to sending.
    messageInput.value = "";
    fileInput.value = "";
    filePreview.classList.add("hidden");

    // Encrypt the text with the conversation key if this chat is encrypted;
    // otherwise send plaintext (legacy conversations without keys).
    let storedContent = content;
    let storedIv = null;
    if (content) {
      const convKey = await getConversationKey(currentConversationId);
      if (convKey) {
        const encrypted = await PanaloCrypto.encryptMessage(content, convKey);
        storedContent = encrypted.ciphertext;
        storedIv = encrypted.iv;
      }
    }

    const { error: insertError } = await supabaseClient.from("messages").insert([
      {
        content: storedContent,
        iv: storedIv,
        username: currentUsername,
        user_id: currentUser.id,
        conversation_id: currentConversationId,
        file_url: fileUrl,
      },
    ]);

    if (insertError) {
      messageInput.value = content; // restore text so it isn't lost
      showToast("Message failed to send. Please try again.");
    }
  });
}

// ---- Real-time Listener ----
function subscribeToMessages() {
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);

  realtimeChannel = supabaseClient
    .channel(`room:${currentConversationId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${currentConversationId}` },
      (payload) => {
        renderMessage(payload.new);
        scrollToBottom();
      }
    )
    // DELETE payloads only carry the primary key (default replica identity), so we
    // can't filter by conversation_id here. The handler is a no-op unless the id is
    // actually shown in this conversation, so unrelated deletes are harmless.
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, (payload) => {
      const targetEl = document.getElementById(`msg-${payload.old.id}`);
      if (targetEl) targetEl.remove();
    })
    .subscribe();
}

function scrollToBottom() {
  const container = document.getElementById("messages-container");
  container.scrollTop = container.scrollHeight;
}

supabaseClient.auth.getSession().then(async ({ data: { session } }) => {
  if (!session) return;
  currentUser = session.user;
  const ready = await ensureUserKeys(null);
  if (ready) {
    initApp(session);
  } else {
    // Session is valid but the private key isn't on this device — ask to unlock.
    showUnlockModal(session);
  }
});
