// Conversations, messages, sending, and realtime.
import { supabaseClient } from "./client.js";
import { state } from "./state.js";
import { el, showToast, withBusy, getAvatarColor, safeImageUrl, scrollToBottom, compressImage, announce } from "./util.js";
import { getConversationKey, provisionConversationKey, messagePlaintext } from "./encryption.js";
import { MESSAGES_PAGE_SIZE, THEME_PRESETS } from "./config.js";
import { isOnline, setPresenceListener } from "./presence.js";

// Typing indicator state (for the currently open conversation).
let otherTyping = false;
let typingTimer = null;
let lastTypingSent = 0;

// Compute the header subtitle: typing > online > default.
function refreshChatSubtitle() {
  const conv = state.currentConversation;
  const sub = document.getElementById("active-chat-subtitle");
  if (!conv || !sub) return;
  if (otherTyping) {
    sub.textContent = "typing…";
    sub.className = "chat-subtitle typing";
  } else if (conv.type === "group") {
    sub.textContent = "Group chat";
    sub.className = "chat-subtitle";
  } else if (conv.otherUserId && isOnline(conv.otherUserId)) {
    sub.textContent = "● online";
    sub.className = "chat-subtitle online";
  } else {
    sub.textContent = "Direct message";
    sub.className = "chat-subtitle";
  }
}

const conversationsList = document.getElementById("conversations-list");
const activeChatWindow = document.getElementById("active-chat-window");
const noChatSelected = document.getElementById("no-chat-selected");
const activeChatTitle = document.getElementById("active-chat-title");
const chatApp = document.getElementById("chat-app");
const messagesList = document.getElementById("messages-list");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const fileInput = document.getElementById("file-input");
const fileBtn = document.getElementById("file-btn");
const filePreview = document.getElementById("file-preview");
const directModal = document.getElementById("direct-modal");
const groupModal = document.getElementById("group-modal");

// ---- Conversations ----
export async function fetchConversations() {
  const { data: rows, error } = await supabaseClient
    .from("conversation_participants")
    .select("conversation_id, conversations(*)")
    .eq("user_id", state.currentUser.id);

  if (error) {
    console.error("Error fetching conversations:", error.message);
    showToast("Could not load your conversations.");
    return;
  }

  const conversations = (rows || []).map((row) => row.conversations).filter(Boolean);
  await resolveDirectTitles(conversations);

  allConversations = conversations;
  renderConversations();
}

// Search + filter (All / Direct / Groups) applied client-side over the cached list.
let allConversations = [];
let chatSearch = "";
let chatFilter = "all";

function renderConversations() {
  const q = chatSearch.trim().toLowerCase();
  conversationsList.innerHTML = "";
  allConversations
    .filter((c) => chatFilter === "all" || c.type === chatFilter)
    .filter((c) => {
      if (!q) return true;
      const title = (c.type === "group" ? c.name : c.displayTitle || c.name) || "";
      return title.toLowerCase().includes(q);
    })
    .forEach((c) => renderConversationItem(c));
}

// For direct chats, the display title is the OTHER participant's username
// (conversations.name is stored once from the creator's perspective).
async function resolveDirectTitles(conversations) {
  const directIds = conversations.filter((c) => c.type === "direct").map((c) => c.id);
  if (!directIds.length) return;

  const { data: parts, error } = await supabaseClient
    .from("conversation_participants")
    .select("conversation_id, user_id, profiles(username)")
    .in("conversation_id", directIds);

  if (error || !parts) return;

  const otherName = new Map();
  const otherId = new Map();
  for (const p of parts) {
    if (p.user_id === state.currentUser.id) continue;
    if (!otherName.has(p.conversation_id)) {
      otherName.set(p.conversation_id, p.profiles?.username || null);
      otherId.set(p.conversation_id, p.user_id);
    }
  }

  for (const conv of conversations) {
    if (conv.type === "direct") {
      conv.displayTitle = otherName.get(conv.id) || conv.name || "Direct Message";
      conv.otherUserId = otherId.get(conv.id) || null;
    }
  }
}

function renderConversationItem(conv) {
  const isGroup = conv.type === "group";
  const title = isGroup ? conv.name : (conv.displayTitle || conv.name || "Direct Message");

  const item = el("div", {
    class: `conv-item${conv.id === state.currentConversationId ? " active" : ""}`,
    role: "button",
    tabindex: "0",
    "aria-label": `Open ${isGroup ? "group chat" : "direct message"}: ${title}`,
  });
  item.dataset.convId = conv.id;

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

async function openConversation(conv, title) {
  state.currentConversationId = conv.id;
  state.currentConversation = conv;
  activeChatTitle.textContent = title;

  // Header avatar + subtitle (matches the redesigned chat header).
  const headerAvatar = document.getElementById("active-chat-avatar");
  headerAvatar.textContent = (title || "?").trim().charAt(0).toUpperCase();
  headerAvatar.style.background = getAvatarColor(title || "?");
  otherTyping = false;
  refreshChatSubtitle(); // live: typing / online / default

  applyChatTheme(conv.theme); // per-chat theme (falls back to default)

  noChatSelected.classList.add("hidden");
  activeChatWindow.classList.remove("hidden");
  chatApp.classList.add("chat-open"); // mobile: switch from list to chat view

  // Update the active highlight in place instead of rebuilding the whole sidebar.
  document.querySelectorAll(".conv-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.convId === String(conv.id));
  });

  await fetchMessages();
  subscribeToMessages();
}

// Find an existing 1:1 conversation shared with `targetUserId`, or null.
async function findExistingDirect(targetUserId) {
  const { data: mine, error } = await supabaseClient
    .from("conversation_participants")
    .select("conversation_id, conversations!inner(type)")
    .eq("user_id", state.currentUser.id)
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

async function createDirect() {
  const usernameField = document.getElementById("direct-username");
  const username = usernameField.value.trim();
  if (!username) return;

  if (username.toLowerCase() === state.currentUsername.toLowerCase()) {
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

  const existingId = await findExistingDirect(targetUser.id);
  if (existingId) {
    directModal.classList.add("hidden");
    usernameField.value = "";
    const { data: convRow } = await supabaseClient.from("conversations").select("*").eq("id", existingId).single();
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
    { conversation_id: newConv.id, user_id: state.currentUser.id },
    { conversation_id: newConv.id, user_id: targetUser.id },
  ]);

  if (partError) {
    showToast("Could not add participants to the chat.");
    return;
  }

  await provisionConversationKey(newConv.id, [state.currentUser.id, targetUser.id]);

  directModal.classList.add("hidden");
  usernameField.value = "";
  await fetchConversations();
}

async function createGroup() {
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
    const { data, error } = await supabaseClient.from("profiles").select("id, username").in("username", usernames);
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

  const participants = [{ conversation_id: newConv.id, user_id: state.currentUser.id }];
  foundProfiles.forEach((p) => participants.push({ conversation_id: newConv.id, user_id: p.id }));

  const { error: partError } = await supabaseClient.from("conversation_participants").insert(participants);
  if (partError) {
    showToast("Could not add members to the group.");
    return;
  }

  await provisionConversationKey(newConv.id, [state.currentUser.id, ...foundProfiles.map((p) => p.id)]);

  groupModal.classList.add("hidden");
  nameField.value = "";
  membersField.value = "";
  await fetchConversations();
}

// ---- Messages (paginated: newest page first, older on scroll-up) ----
async function fetchMessages() {
  if (!state.currentConversationId) return;

  state.oldestLoadedAt = null;
  state.hasMoreOlderMessages = false;
  state.loadingOlder = false;

  const { data, error } = await supabaseClient
    .from("messages")
    .select("*")
    .eq("conversation_id", state.currentConversationId)
    .order("created_at", { ascending: false })
    .limit(MESSAGES_PAGE_SIZE);

  if (error) {
    console.error("Error fetching messages:", error.message);
    showToast("Could not load messages.");
    return;
  }

  messagesList.innerHTML = "";
  (data || []).slice().reverse().forEach((msg) => renderMessage(msg));

  if (data && data.length) state.oldestLoadedAt = data[data.length - 1].created_at;
  state.hasMoreOlderMessages = (data || []).length === MESSAGES_PAGE_SIZE;
  scrollToBottom();
}

async function loadOlderMessages() {
  if (state.loadingOlder || !state.hasMoreOlderMessages || !state.oldestLoadedAt || !state.currentConversationId) return;
  state.loadingOlder = true;

  const container = document.getElementById("messages-container");
  const prevHeight = container.scrollHeight;
  const prevTop = container.scrollTop;

  const { data, error } = await supabaseClient
    .from("messages")
    .select("*")
    .eq("conversation_id", state.currentConversationId)
    .lt("created_at", state.oldestLoadedAt)
    .order("created_at", { ascending: false })
    .limit(MESSAGES_PAGE_SIZE);

  if (error) {
    state.loadingOlder = false;
    return;
  }

  (data || []).forEach((msg) => renderMessage(msg, true));

  if (data && data.length) state.oldestLoadedAt = data[data.length - 1].created_at;
  state.hasMoreOlderMessages = (data || []).length === MESSAGES_PAGE_SIZE;

  container.scrollTop = prevTop + (container.scrollHeight - prevHeight);
  state.loadingOlder = false;
}

function renderMessage(msg, prepend = false) {
  // Idempotent: dedupes the realtime echo of an optimistically-rendered message.
  if (document.getElementById(`msg-${msg.id}`)) return;

  const isMine = msg.user_id === state.currentUser.id;

  const messageEl = el("div", {
    class: `message${isMine ? " my-message" : ""}${msg._pending ? " pending" : ""}`,
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

  const imageUrl = msg._localPreview || safeImageUrl(msg.file_url);
  if (imageUrl) {
    messageEl.append(el("img", { class: "chat-image", src: imageUrl, alt: "Shared image", loading: "lazy" }));
  }

  const time = new Date(msg.created_at || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const footer = el("div", { class: "message-footer" }, [
    el("span", { class: "message-time", text: msg._pending ? "Sending…" : time }),
  ]);
  if (isMine && !msg._pending) {
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

  if (prepend) messagesList.insertBefore(messageEl, messagesList.firstChild);
  else messagesList.append(messageEl);
}

async function deleteMessage(msgId) {
  const { error } = await supabaseClient.from("messages").delete().eq("id", msgId);
  if (error) showToast("Could not delete the message.");
}

// ---- Sending (optimistic) ----
function handleSend() {
  const content = messageInput.value.trim();
  const file = fileInput.files[0];

  if (!content && !file) return;
  if (!state.currentConversationId) return;

  const convId = state.currentConversationId;
  messageInput.value = "";
  fileInput.value = "";
  filePreview.classList.add("hidden");
  filePreview.innerHTML = "";

  sendMessage(content, file, convId);
}

async function sendMessage(content, file, convId) {
  const tempId = "temp-" + crypto.randomUUID();
  const localPreview = file ? URL.createObjectURL(file) : null;
  const retry = () => sendMessage(content, file, convId);

  renderMessage({
    id: tempId,
    user_id: state.currentUser.id,
    username: state.currentUsername,
    content,
    iv: null,
    file_url: null,
    _localPreview: localPreview,
    created_at: new Date().toISOString(),
    conversation_id: convId,
    _pending: true,
  });
  scrollToBottom();

  try {
    let fileUrl = null;
    if (file) {
      if (!file.type.startsWith("image/")) return markSendFailed(tempId, "Only images can be attached", retry);
      const toUpload = await compressImage(file);
      const ext = (toUpload.name.split(".").pop() || "img").toLowerCase();
      const fileName = `${Date.now()}_${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabaseClient.storage
        .from("chat-files")
        .upload(fileName, toUpload, { contentType: toUpload.type || undefined });
      if (uploadError) return markSendFailed(tempId, "Image upload failed", retry);
      fileUrl = supabaseClient.storage.from("chat-files").getPublicUrl(fileName).data.publicUrl;
    }

    let storedContent = content;
    let storedIv = null;
    if (content) {
      const convKey = await getConversationKey(convId);
      if (convKey) {
        const encrypted = await window.PanaloCrypto.encryptMessage(content, convKey);
        storedContent = encrypted.ciphertext;
        storedIv = encrypted.iv;
      }
    }

    const { data: inserted, error: insertError } = await supabaseClient
      .from("messages")
      .insert([
        {
          content: storedContent,
          iv: storedIv,
          username: state.currentUsername,
          user_id: state.currentUser.id,
          conversation_id: convId,
          file_url: fileUrl,
        },
      ])
      .select()
      .single();

    if (insertError || !inserted) return markSendFailed(tempId, "Message failed to send", retry);

    reconcileSend(tempId, inserted, localPreview);
  } catch (e) {
    console.error("Send failed:", e);
    markSendFailed(tempId, "Message failed to send", retry);
  }
}

function reconcileSend(tempId, realMsg, localPreview) {
  const tempEl = document.getElementById(`msg-${tempId}`);
  const realEl = document.getElementById(`msg-${realMsg.id}`);

  if (realEl) {
    if (tempEl) tempEl.remove();
    if (localPreview) URL.revokeObjectURL(localPreview);
    return;
  }
  if (!tempEl) return;

  tempEl.id = `msg-${realMsg.id}`;
  tempEl.classList.remove("pending");
  const footer = tempEl.querySelector(".message-footer");
  if (footer) {
    footer.innerHTML = "";
    const time = new Date(realMsg.created_at || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    footer.append(el("span", { class: "message-time", text: time }));
    footer.append(
      el("button", {
        class: "delete-btn",
        type: "button",
        text: "Delete",
        "aria-label": "Delete message",
        onClick: () => deleteMessage(realMsg.id),
      })
    );
  }
}

function markSendFailed(tempId, reason, onRetry) {
  const tempEl = document.getElementById(`msg-${tempId}`);
  if (!tempEl) {
    showToast(reason);
    return;
  }
  tempEl.classList.remove("pending");
  tempEl.classList.add("failed");
  const footer = tempEl.querySelector(".message-footer");
  if (footer) {
    footer.innerHTML = "";
    footer.append(el("span", { class: "message-time", text: reason }));
    footer.append(
      el("button", {
        class: "retry-btn",
        type: "button",
        text: "Retry",
        onClick: () => {
          tempEl.remove();
          onRetry();
        },
      })
    );
  }
}

// ---- Realtime ----
function subscribeToMessages() {
  if (state.realtimeChannel) supabaseClient.removeChannel(state.realtimeChannel);
  otherTyping = false;

  state.realtimeChannel = supabaseClient
    .channel(`room:${state.currentConversationId}`, { config: { broadcast: { self: false } } })
    .on("broadcast", { event: "typing" }, () => {
      otherTyping = true;
      refreshChatSubtitle();
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        otherTyping = false;
        refreshChatSubtitle();
      }, 2500);
    })
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${state.currentConversationId}` },
      (payload) => {
        renderMessage(payload.new);
        scrollToBottom();
        if (payload.new.user_id !== state.currentUser.id) {
          announce(`New message from ${payload.new.username || "someone"}`);
        }
      }
    )
    // DELETE payloads only carry the primary key, so we can't filter by
    // conversation here. The handler is a no-op unless the id is on screen.
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, (payload) => {
      const targetEl = document.getElementById(`msg-${payload.old.id}`);
      if (targetEl) targetEl.remove();
    })
    .subscribe();
}

// ---- Per-chat theme ----
const chatMainEl = document.querySelector(".chat-main");

const THEME_VARS = ["--primary", "--primary-strong", "--grad", "--bubble-out"];

function applyChatTheme(themeId) {
  // "default" (or none) → clear overrides so the chat uses the global accent.
  const preset = themeId && themeId !== "default" ? THEME_PRESETS.find((t) => t.id === themeId) : null;
  if (!preset) {
    THEME_VARS.forEach((v) => chatMainEl.style.removeProperty(v));
    return;
  }
  const grad = `linear-gradient(135deg, ${preset.primary}, ${preset.strong})`;
  chatMainEl.style.setProperty("--primary", preset.primary);
  chatMainEl.style.setProperty("--primary-strong", preset.strong);
  chatMainEl.style.setProperty("--grad", grad);
  chatMainEl.style.setProperty("--bubble-out", grad);
}

function updateSwatchSelection(themeId) {
  document.querySelectorAll(".theme-swatch").forEach((s) => {
    s.classList.toggle("selected", s.dataset.themeId === (themeId || "default"));
  });
}

async function setChatTheme(themeId) {
  applyChatTheme(themeId);
  updateSwatchSelection(themeId);
  if (state.currentConversation) {
    state.currentConversation.theme = themeId;
    // Persist for both members. No-ops gracefully until the backend is set up.
    await supabaseClient.rpc("set_conversation_theme", {
      conv: state.currentConversation.id,
      new_theme: themeId,
    });
  }
}

// ---- Image viewer (open, zoom, download) ----
function openImageViewer(src) {
  const viewer = document.getElementById("image-viewer");
  const img = document.getElementById("viewer-img");
  img.classList.remove("zoomed");
  img.src = src;
  viewer.classList.remove("hidden");
}

function closeImageViewer() {
  document.getElementById("image-viewer").classList.add("hidden");
  document.getElementById("viewer-img").classList.remove("zoomed");
}

// Cross-origin images ignore the <a download> attribute, so fetch the bytes and
// save the blob directly. Falls back to opening in a new tab.
async function downloadImage(src) {
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error("fetch failed");
    const blob = await res.blob();
    const ext = ((blob.type.split("/")[1] || "jpg").split("+")[0]) || "jpg";
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: `panalo-${Date.now()}.${ext}` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch {
    window.open(src, "_blank", "noopener");
    showToast("Opened in a new tab — long-press or right-click to save.", "");
  }
}

// ---- Wire up all chat-related event listeners ----
export function initChatUI() {
  document.getElementById("back-btn").addEventListener("click", () => {
    chatApp.classList.remove("chat-open");
  });

  document.getElementById("messages-container").addEventListener("scroll", () => {
    const container = document.getElementById("messages-container");
    if (container.scrollTop < 80 && state.hasMoreOlderMessages && !state.loadingOlder) {
      loadOlderMessages();
    }
  });

  document.getElementById("new-direct-btn").addEventListener("click", () => {
    directModal.classList.remove("hidden");
    document.getElementById("direct-username").focus();
  });
  document.getElementById("close-direct-modal").addEventListener("click", () => directModal.classList.add("hidden"));
  document.getElementById("new-group-btn").addEventListener("click", () => {
    groupModal.classList.remove("hidden");
    document.getElementById("group-name-input").focus();
  });
  document.getElementById("close-group-modal").addEventListener("click", () => groupModal.classList.add("hidden"));

  const createDirectBtn = document.getElementById("create-direct-btn");
  createDirectBtn.addEventListener("click", () => withBusy(createDirectBtn, "Starting…", createDirect));

  const createGroupBtn = document.getElementById("create-group-btn");
  createGroupBtn.addEventListener("click", () => withBusy(createGroupBtn, "Creating…", createGroup));

  fileBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    filePreview.innerHTML = "";
    if (!file) {
      filePreview.classList.add("hidden");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    filePreview.append(
      el("img", { src: previewUrl, class: "file-preview-thumb", alt: "Selected image" }),
      el("span", { class: "file-preview-name", text: file.name }),
      el("button", {
        class: "file-preview-remove",
        type: "button",
        text: "Remove",
        "aria-label": "Remove selected image",
        onClick: () => {
          fileInput.value = "";
          filePreview.classList.add("hidden");
          filePreview.innerHTML = "";
          URL.revokeObjectURL(previewUrl);
        },
      })
    );
    filePreview.classList.remove("hidden");
  });

  // Image viewer: click a chat image to open; zoom, download, or close.
  messagesList.addEventListener("click", (e) => {
    const img = e.target.closest(".chat-image");
    if (img) openImageViewer(img.src);
  });
  document.getElementById("viewer-close").addEventListener("click", closeImageViewer);
  document.getElementById("image-viewer").addEventListener("click", (e) => {
    if (e.target.id === "image-viewer") closeImageViewer();
  });
  document.getElementById("viewer-img").addEventListener("click", (e) => {
    e.stopPropagation();
    e.currentTarget.classList.toggle("zoomed");
  });
  document.getElementById("viewer-download").addEventListener("click", () => {
    downloadImage(document.getElementById("viewer-img").src);
  });

  messageForm.addEventListener("submit", (e) => {
    e.preventDefault();
    handleSend();
  });

  // Quick-message bar: one tap sends a preset greeting/emoji.
  document.getElementById("quick-bar").addEventListener("click", (e) => {
    const btn = e.target.closest(".quick-btn");
    if (!btn || !state.currentConversationId) return;
    sendMessage(btn.dataset.msg, null, state.currentConversationId);
    scrollToBottom();
  });

  // Theme picker: build swatches once, then wire open/close.
  const themeSwatches = document.getElementById("theme-swatches");
  THEME_PRESETS.forEach((preset) => {
    const swatch = el("button", {
      class: "theme-swatch",
      type: "button",
      title: preset.name,
      "aria-label": `${preset.name} theme`,
      onClick: () => {
        setChatTheme(preset.id);
        document.getElementById("theme-modal").classList.add("hidden");
      },
    });
    swatch.dataset.themeId = preset.id;
    swatch.style.background = `linear-gradient(135deg, ${preset.primary}, ${preset.strong})`;
    themeSwatches.append(swatch);
  });

  document.getElementById("theme-btn").addEventListener("click", () => {
    updateSwatchSelection(state.currentConversation?.theme);
    document.getElementById("theme-modal").classList.remove("hidden");
  });
  document.getElementById("close-theme-modal").addEventListener("click", () => {
    document.getElementById("theme-modal").classList.add("hidden");
  });

  // Typing: broadcast (debounced) that we're typing so the other side sees it.
  messageInput.addEventListener("input", () => {
    const now = Date.now();
    if (now - lastTypingSent > 1500 && state.realtimeChannel && state.currentConversationId) {
      lastTypingSent = now;
      try {
        state.realtimeChannel.send({ type: "broadcast", event: "typing", payload: {} });
      } catch {
        /* ignore */
      }
    }
  });

  // Refresh the header status whenever anyone's online state changes.
  setPresenceListener(refreshChatSubtitle);

  // Chat search + filter tabs.
  const searchInput = document.getElementById("chat-search");
  searchInput.addEventListener("input", () => {
    chatSearch = searchInput.value;
    renderConversations();
  });
  document.querySelectorAll(".filter-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      chatFilter = tab.dataset.filter;
      document.querySelectorAll(".filter-tab").forEach((t) => t.classList.toggle("active", t === tab));
      renderConversations();
    });
  });
}
