// Conversations, messages, sending, and realtime.
import { supabaseClient } from "./client.js";
import { state } from "./state.js";
import { el, showToast, withBusy, getAvatarColor, safeImageUrl, scrollToBottom, compressImage, announce, setAvatar } from "./util.js";
import { getConversationKey, provisionConversationKey, messagePlaintext } from "./encryption.js";
import { MESSAGES_PAGE_SIZE, THEME_PRESETS, FONT_PRESETS, MAX_FILE_BYTES } from "./config.js";
import { isOnline, setPresenceListener } from "./presence.js";
import { isMuted, toggleMute, setInboxListener, setOpenChatListener } from "./notifications.js";
import {
  markRead, countUnread, isUnreadMessage, formatCount, updateTitleBadge,
  getLastRead, mergeServerMarkers,
} from "./unread.js";
import {
  getNickname, isPinned, togglePin,
  getStars, toggleStar, isStarred,
  getPinnedMessages, isMessagePinned, toggleMessagePin,
  getChatFont, getChatWallpaper,
} from "./prefs.js";
import { icon } from "./icons.js";
import {
  REACTION_EMOJIS, groupedReactions, loadReactions, toggleReaction,
  setReactionListener, startReactions,
} from "./reactions.js";
import {
  markConversationRead, loadReadState, isReadByAll, subscribeReceipts,
  setReceiptListener, loadMyReadMarkers,
} from "./receipts.js";
import { openChatInfo, closeChatInfo, setChatInfoCallbacks, displayTitle, initChatInfo } from "./chatinfo.js";

// Message rows currently on screen (id → row) — powers the actions menu.
const msgCache = new Map();
// Members of the open conversation, needed to decide when a message is read.
let currentMemberIds = [];
// The message we're currently replying to, if any.
let replyTarget = null;

// Look a message up on screen first, then fall back to the server (for quoted
// messages that scrolled out of the loaded page).
async function resolveMessage(id) {
  if (msgCache.has(id)) return msgCache.get(id);
  const { data } = await supabaseClient.from("messages").select("*").eq("id", id).maybeSingle();
  if (data) msgCache.set(id, data);
  return data || null;
}

// Scroll to a message and flash it, if it's currently loaded.
function jumpToMessage(id) {
  const target = document.getElementById(`msg-${id}`);
  if (!target) {
    showToast("That message is further up — scroll to load it.", "");
    return;
  }
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("flash");
  setTimeout(() => target.classList.remove("flash"), 1200);
}

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
  // Read positions from your other devices win before unread is computed.
  mergeServerMarkers(await loadMyReadMarkers());
  await hydrateConversationMeta();
  renderConversations();
}

// One query gives us, for every chat: the latest message (preview + ordering)
// and the unread count. RLS already limits this to the user's own chats.
const META_SCAN_LIMIT = 500;

async function hydrateConversationMeta() {
  if (!allConversations.length) {
    refreshUnreadBadges();
    return;
  }
  const { data } = await supabaseClient
    .from("messages")
    .select("id, conversation_id, user_id, username, content, iv, file_url, created_at")
    .order("created_at", { ascending: false })
    .limit(META_SCAN_LIMIT);

  const byConv = new Map();
  for (const m of data || []) {
    if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
    byConv.get(m.conversation_id).push(m);
  }

  for (const conv of allConversations) {
    const msgs = byConv.get(conv.id) || [];
    conv.lastMessage = msgs[0] || null;
    conv.lastAt = msgs[0]?.created_at || conv.created_at || null;
    conv.unread = countUnread(conv.id, msgs);
  }
  refreshUnreadBadges();
}

// Short, human timestamp for the chat list ("09:42", "Mon", "3 Aug").
function listTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const daysAgo = (now - d) / 86400000;
  if (daysAgo < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

// Total unread on the rail icons + the browser tab title.
function refreshUnreadBadges() {
  const totals = { all: 0, direct: 0, group: 0 };
  for (const c of allConversations) {
    const n = c.unread || 0;
    if (!n) continue;
    totals.all += n;
    if (c.type === "direct") totals.direct += n;
    if (c.type === "group") totals.group += n;
  }
  document.querySelectorAll(".rail-btn[data-view]").forEach((btn) => {
    const view = btn.dataset.view;
    const count = totals[view] || 0;
    let dot = btn.querySelector(".rail-badge");
    if (count > 0) {
      if (!dot) {
        dot = el("span", { class: "rail-badge" });
        btn.append(dot);
      }
      dot.textContent = formatCount(count);
    } else if (dot) {
      dot.remove();
    }
  });
  updateTitleBadge(totals.all);
}

// Search + filter (All / Direct / Groups) applied client-side over the cached list.
let allConversations = [];
let chatSearch = "";
let chatFilter = "all";

function renderConversations() {
  conversationsList.innerHTML = "";
  if (chatFilter === "starred") {
    renderStarredList();
    return;
  }
  const q = chatSearch.trim().toLowerCase();
  const items = allConversations
    .filter((c) => chatFilter === "all" || c.type === chatFilter)
    .filter((c) => {
      if (!q) return true;
      const title = (c.type === "group" ? c.name : c.displayTitle || c.name) || "";
      return title.toLowerCase().includes(q) || getNickname(c.id).toLowerCase().includes(q);
    });
  // Pinned chats first, then most recent activity — like every messenger.
  items.sort((a, b) => {
    const pin = Number(isPinned(b.id)) - Number(isPinned(a.id));
    if (pin) return pin;
    return String(b.lastAt || "").localeCompare(String(a.lastAt || ""));
  });
  if (!items.length) {
    conversationsList.append(el("div", { class: "list-empty", text: q ? "No chats match your search." : "No chats here yet." }));
    return;
  }
  items.forEach((c) => renderConversationItem(c));
}

// ---- Starred messages view (⭐ in the rail) ----
async function renderStarredList() {
  const stars = getStars();
  if (!stars.length) {
    conversationsList.append(el("div", { class: "list-empty", text: "No starred messages yet.\nHover a message → ⋮ → Star." }));
    return;
  }
  const { data } = await supabaseClient
    .from("messages")
    .select("*")
    .in("id", stars.map((s) => s.id))
    .order("created_at", { ascending: false });

  const rows = data || [];
  if (!rows.length) {
    conversationsList.append(el("div", { class: "list-empty", text: "Starred messages are no longer available." }));
    return;
  }
  const titleOf = (convId) => {
    const conv = allConversations.find((c) => c.id === convId);
    return conv ? displayTitle(conv) : "Chat";
  };
  for (const msg of rows) {
    const when = new Date(msg.created_at).toLocaleDateString([], { month: "short", day: "numeric" });
    const textEl = el("div", { class: "star-item-text", text: msg.file_url ? "📎 Attachment" : "…" });
    if (msg.content) messagePlaintext(msg).then((t) => (textEl.textContent = t));
    const item = el("div", { class: "star-item", role: "button", tabindex: "0" }, [
      el("div", { class: "star-item-top" }, [
        el("span", { text: `⭐ ${titleOf(msg.conversation_id)} · ${msg.username || "?"}` }),
        el("span", { text: when }),
      ]),
      textEl,
    ]);
    item.addEventListener("click", () => {
      const conv = allConversations.find((c) => c.id === msg.conversation_id);
      if (conv) openConversation(conv, displayTitle(conv));
    });
    conversationsList.append(item);
  }
}

// For direct chats, the display title is the OTHER participant's username
// (conversations.name is stored once from the creator's perspective).
async function resolveDirectTitles(conversations) {
  const directIds = conversations.filter((c) => c.type === "direct").map((c) => c.id);
  if (!directIds.length) return;

  let { data: parts, error } = await supabaseClient
    .from("conversation_participants")
    .select("conversation_id, user_id, profiles(username, avatar_url, bio)")
    .in("conversation_id", directIds);

  // Graceful fallback until supabase-phase5.sql adds avatar_url/bio.
  if (error && /column/i.test(error.message)) {
    ({ data: parts, error } = await supabaseClient
      .from("conversation_participants")
      .select("conversation_id, user_id, profiles(username)")
      .in("conversation_id", directIds));
  }
  if (error || !parts) return;

  const others = new Map();
  for (const p of parts) {
    if (p.user_id === state.currentUser.id) continue;
    if (!others.has(p.conversation_id)) others.set(p.conversation_id, p);
  }

  for (const conv of conversations) {
    if (conv.type === "direct") {
      const other = others.get(conv.id);
      conv.displayTitle = other?.profiles?.username || conv.name || "Direct Message";
      conv.otherUserId = other?.user_id || null;
      conv.otherAvatar = other?.profiles?.avatar_url || null;
      conv.otherBio = other?.profiles?.bio || null;
    }
  }
}

function renderConversationItem(conv) {
  const isGroup = conv.type === "group";
  const baseTitle = isGroup ? conv.name : (conv.displayTitle || conv.name || "Direct Message");
  const title = getNickname(conv.id) || baseTitle;

  const item = el("div", {
    class: `conv-item${conv.id === state.currentConversationId ? " active" : ""}`,
    role: "button",
    tabindex: "0",
    "aria-label": `Open ${isGroup ? "group chat" : "direct message"}: ${title}`,
  });
  item.dataset.convId = conv.id;

  const avatar = el("div", { class: "avatar" });
  setAvatar(avatar, baseTitle, isGroup ? null : conv.otherAvatar);

  // Preview line: the last message, decrypted, with the sender's name in groups.
  const last = conv.lastMessage;
  const previewEl = el("div", { class: "conv-preview" });
  if (!last) {
    previewEl.textContent = isGroup ? "Group Chat" : "Direct Message";
  } else if (last.file_url) {
    previewEl.textContent = "📎 Attachment";
  } else {
    previewEl.textContent = "…";
    messagePlaintext(last).then((text) => {
      const mine = last.user_id === state.currentUser.id;
      const who = mine ? "You: " : isGroup ? `${last.username || "?"}: ` : "";
      previewEl.textContent = who + text;
    });
  }

  const unread = conv.unread || 0;
  if (unread > 0) item.classList.add("has-unread");

  item.append(
    avatar,
    el("div", { class: "conv-info" }, [
      el("div", { class: "conv-row-top" }, [
        el("div", { class: "conv-title", text: title }),
        el("span", { class: "conv-time", text: listTime(conv.lastAt) }),
      ]),
      el("div", { class: "conv-row-bottom" }, [
        previewEl,
        isPinned(conv.id) ? el("span", { class: "conv-pin", "aria-label": "Pinned" }, [icon("pin", 13)]) : null,
        isMuted(conv.id) ? el("span", { class: "conv-pin", "aria-label": "Muted" }, [icon("bellOff", 13)]) : null,
        unread > 0 ? el("span", { class: "conv-badge", text: formatCount(unread), "aria-label": `${unread} unread` }) : null,
      ]),
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

async function openConversation(conv) {
  state.currentConversationId = conv.id;
  state.currentConversation = conv;
  const title = displayTitle(conv); // nickname > resolved title
  activeChatTitle.textContent = title;

  // Header avatar + subtitle (matches the redesigned chat header).
  const headerAvatar = document.getElementById("active-chat-avatar");
  const baseTitle = conv.type === "group" ? conv.name : conv.displayTitle || conv.name;
  setAvatar(headerAvatar, baseTitle, conv.type === "group" ? null : conv.otherAvatar);
  otherTyping = false;
  refreshChatSubtitle(); // live: typing / online / default

  closeChatInfo(); // drawer belongs to the previous chat
  applyChatTheme(conv.theme); // per-chat theme (falls back to default)
  applyChatFont(conv.id); // personal per-chat font
  applyChatWallpaper(conv.id); // personal per-chat wallpaper
  refreshPinnedBar(conv.id);

  noChatSelected.classList.add("hidden");
  activeChatWindow.classList.remove("hidden");
  chatApp.classList.add("chat-open"); // mobile: switch from list to chat view

  // Update the active highlight in place instead of rebuilding the whole sidebar.
  document.querySelectorAll(".conv-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.convId === String(conv.id));
  });

  cancelReply();

  // Who's in this chat + where everyone has read up to (drives the ✓✓ ticks).
  const [{ data: parts }] = await Promise.all([
    supabaseClient.from("conversation_participants").select("user_id").eq("conversation_id", conv.id),
    loadReadState(conv.id),
  ]);
  currentMemberIds = (parts || []).map((p) => p.user_id);

  await fetchMessages();

  // Everything on screen counts as read — locally and for the other side.
  markRead(conv.id);
  markConversationRead(conv.id);
  conv.unread = 0;
  refreshUnreadBadges();
  renderConversations();
  subscribeToMessages();
  subscribeReceipts(conv.id);
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
  msgCache.clear();
  const ordered = (data || []).slice().reverse();
  // Reactions for this page arrive before rendering, so pills appear at once.
  await loadReactions(ordered.map((m) => m.id));
  // "Unread messages" divider before the first message we haven't seen.
  const firstUnread = ordered.find((m) => isUnreadMessage(state.currentConversationId, m));
  ordered.forEach((msg) => {
    if (firstUnread && msg.id === firstUnread.id) {
      messagesList.append(el("div", { class: "day-separator unread-divider", text: "Unread messages" }));
    }
    renderMessage(msg);
  });

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

  await loadReactions((data || []).map((m) => m.id), { replace: false });
  (data || []).forEach((msg) => renderMessage(msg, true));

  if (data && data.length) state.oldestLoadedAt = data[data.length - 1].created_at;
  state.hasMoreOlderMessages = (data || []).length === MESSAGES_PAGE_SIZE;

  container.scrollTop = prevTop + (container.scrollHeight - prevHeight);
  state.loadingOlder = false;
}

// Non-image attachments live under files/ with size + name encoded in the path:
//   files/<ts>_<uuid>_s<bytes>__<original-name>
function parseFileMeta(url) {
  const safe = safeImageUrl(url); // same allow-list as images
  if (!safe || !safe.includes("/chat-files/files/")) return null;
  let base = safe.split("/").pop() || "";
  try {
    base = decodeURIComponent(base);
  } catch {
    /* keep raw */
  }
  const m = /_s(\d+)__(.+)$/.exec(base);
  return { url: safe, size: m ? Number(m[1]) : 0, name: m ? m[2] : base };
}

function prettyBytes(n) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Broad file-type icon (vector, so it recolors with the theme).
function fileIcon(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "sound";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "heic"].includes(ext)) return "image";
  return "file";
}

// Save any storage file with its original name (blob fetch, like images).
async function downloadFile(url, name) {
  if (!url) return; // still uploading
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("fetch failed");
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = el("a", { href: objUrl, download: name || `panalo-${Date.now()}` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

function renderFileBubble(meta) {
  return el("div", { class: "file-bubble" }, [
    el("span", { class: "file-bubble-icon" }, [icon(fileIcon(meta.name), 26)]),
    el("div", { class: "file-bubble-meta" }, [
      el("div", { class: "file-bubble-name", text: meta.name }),
      el("div", { class: "file-bubble-size", text: prettyBytes(meta.size) }),
    ]),
    el("button", {
      class: "file-download-btn",
      type: "button",
      "aria-label": `Download ${meta.name}`,
      onClick: () => downloadFile(meta.url, meta.name),
    }, [icon("download", 16)]),
  ]);
}

// Star/pin flags shown in the footer, refreshed after every toggle.
function refreshMsgFlags(msgId) {
  const flagEl = document.querySelector(`#msg-${CSS.escape(String(msgId))} .msg-flags`);
  if (!flagEl) return;
  const convId = state.currentConversationId;
  flagEl.innerHTML = "";
  if (isStarred(msgId)) flagEl.append(icon("star", 12));
  if (isMessagePinned(convId, msgId)) flagEl.append(icon("pin", 12));
}

function renderMessage(msg, prepend = false) {
  // Idempotent: dedupes the realtime echo of an optimistically-rendered message.
  if (document.getElementById(`msg-${msg.id}`)) return;
  msgCache.set(msg.id, msg);

  const isMine = msg.user_id === state.currentUser.id;

  const messageEl = el("div", {
    class: `message${isMine ? " my-message" : ""}${msg._pending ? " pending" : ""}`,
    id: `msg-${msg.id}`,
  });

  messageEl.append(el("div", { class: "message-author", text: isMine ? "You" : (msg.username || "Unknown") }));

  // Quoted message being replied to (text resolved + decrypted lazily).
  if (msg.reply_to) {
    const quote = el("button", {
      class: "reply-quote",
      type: "button",
      "aria-label": "Jump to the replied message",
      onClick: (e) => {
        e.stopPropagation();
        jumpToMessage(msg.reply_to);
      },
    }, [
      el("span", { class: "reply-quote-author", text: "…" }),
      el("span", { class: "reply-quote-text", text: "…" }),
    ]);
    messageEl.append(quote);
    resolveMessage(msg.reply_to).then(async (parent) => {
      if (!parent) {
        quote.querySelector(".reply-quote-author").textContent = "Message";
        quote.querySelector(".reply-quote-text").textContent = "no longer available";
        quote.classList.add("missing");
        return;
      }
      quote.querySelector(".reply-quote-author").textContent =
        parent.user_id === state.currentUser.id ? "You" : parent.username || "Unknown";
      quote.querySelector(".reply-quote-text").textContent = parent.file_url
        ? "📎 Attachment"
        : await messagePlaintext(parent);
    });
  }

  if (msg.content) {
    const textEl = el("div", { class: "message-text", text: msg.iv ? "…" : msg.content });
    messageEl.append(textEl);
    if (msg.iv) {
      messagePlaintext(msg).then((plaintext) => {
        textEl.textContent = plaintext;
        msg._plain = plaintext; // cached for the edit flow
      });
    } else {
      msg._plain = msg.content;
    }
  }

  const fileMeta = msg._localFileMeta || parseFileMeta(msg.file_url);
  if (fileMeta) {
    messageEl.append(renderFileBubble(fileMeta));
  } else {
    const imageUrl = msg._localPreview || safeImageUrl(msg.file_url);
    if (imageUrl) {
      messageEl.append(el("img", { class: "chat-image", src: imageUrl, alt: "Shared image", loading: "lazy" }));
    }
  }

  const time = new Date(msg.created_at || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const footer = el("div", { class: "message-footer" }, [
    el("span", { class: "msg-flags", "aria-hidden": "true" }),
    el("span", { class: "message-time", text: msg._pending ? "Sending…" : time }),
  ]);
  if (msg.edited_at) footer.append(el("span", { class: "edited-tag", text: "edited" }));
  // Delivery ticks live on our own messages only.
  if (isMine && !msg._pending) footer.append(el("span", { class: "ticks", "aria-label": "Sent" }));
  messageEl.append(footer);

  // Reactions sit under the bubble content, above the footer.
  const reactionBar = el("div", { class: "reaction-bar" });
  messageEl.insertBefore(reactionBar, footer);

  if (!msg._pending) {
    messageEl.append(
      el("button", {
        class: "msg-menu-btn",
        type: "button",
        "aria-label": "Message actions",
        onClick: (e) => {
          e.stopPropagation();
          openMsgActions(msg, e.currentTarget);
        },
      }, [icon("more", 13)])
    );
  }

  if (prepend) messagesList.insertBefore(messageEl, messagesList.firstChild);
  else messagesList.append(messageEl);
  refreshMsgFlags(msg.id);
  renderReactions(msg.id);
  if (isMine && !msg._pending) refreshTicks(msg);
}

// ---- Reactions ----
function renderReactions(msgId) {
  const bar = document.querySelector(`#msg-${CSS.escape(String(msgId))} .reaction-bar`);
  if (!bar) return;
  const groups = groupedReactions(msgId);
  bar.innerHTML = "";
  bar.classList.toggle("empty", groups.length === 0);
  groups.forEach((g) => {
    bar.append(
      el("button", {
        class: `reaction-pill${g.mine ? " mine" : ""}`,
        type: "button",
        "aria-label": `${g.emoji} ${g.count}`,
        onClick: (e) => {
          e.stopPropagation();
          toggleReaction(msgId, g.emoji);
        },
      }, [
        el("span", { class: "reaction-emoji", text: g.emoji }),
        el("span", { class: "reaction-count", text: String(g.count) }),
      ])
    );
  });
}

// Quick emoji picker, opened from a message's actions menu.
let pickerEl = null;

function closeReactionPicker() {
  pickerEl?.remove();
  pickerEl = null;
}

function openReactionPicker(msgId, anchorRect) {
  closeReactionPicker();
  pickerEl = el("div", { class: "reaction-picker", role: "menu" });
  REACTION_EMOJIS.forEach((emoji) => {
    pickerEl.append(
      el("button", {
        class: "reaction-choice",
        type: "button",
        text: emoji,
        "aria-label": `React with ${emoji}`,
        onClick: (e) => {
          e.stopPropagation();
          toggleReaction(msgId, emoji);
          closeReactionPicker();
        },
      })
    );
  });
  document.body.append(pickerEl);
  placePopup(pickerEl, anchorRect, "above");
}

// ---- Read receipts (✓ sent, ✓✓ read by everyone else) ----
function refreshTicks(msg) {
  const tickEl = document.querySelector(`#msg-${CSS.escape(String(msg.id))} .ticks`);
  if (!tickEl) return;
  const read = isReadByAll(msg.conversation_id, msg, currentMemberIds);
  tickEl.innerHTML = "";
  tickEl.append(icon(read ? "checkDouble" : "check", 14));
  tickEl.classList.toggle("read", read);
  tickEl.setAttribute("aria-label", read ? "Read" : "Sent");
}

function refreshAllTicks() {
  for (const msg of msgCache.values()) {
    if (msg.user_id === state.currentUser?.id && !msg._pending) refreshTicks(msg);
  }
}

// ---- Per-message actions (star / pin / edit / delete) ----
let msgActionsEl = null;

function closeMsgActions() {
  msgActionsEl?.remove();
  msgActionsEl = null;
}

function openMsgActions(msg, anchor) {
  closeMsgActions();
  const isMine = msg.user_id === state.currentUser.id;
  const convId = state.currentConversationId;

  const items = [
    { ico: "smile", label: "React", act: () => openReactionPicker(msg.id, anchor.getBoundingClientRect()) },
    { ico: "reply", label: "Reply", act: () => startReply(msg) },
    { ico: "star", label: isStarred(msg.id) ? "Unstar" : "Star", act: () => {
      toggleStar(msg.id, convId);
      refreshMsgFlags(msg.id);
      if (chatFilter === "starred") renderConversations();
    } },
    { ico: "pin", label: isMessagePinned(convId, msg.id) ? "Unpin" : "Pin", act: () => {
      toggleMessagePin(convId, msg.id);
      refreshMsgFlags(msg.id);
      refreshPinnedBar(convId);
    } },
  ];
  if (isMine && msg.content) items.push({ ico: "edit", label: "Edit", act: () => openEditModal(msg) });
  if (isMine) items.push({ ico: "trash", label: "Delete", act: () => deleteMessage(msg.id), danger: true });

  msgActionsEl = el("div", { class: "msg-actions", role: "menu" });
  items.forEach(({ ico, label, act, danger }) => {
    const b = el("button", { class: "chat-menu-item", type: "button", role: "menuitem", onClick: (e) => {
      // Without this the click reaches the document handler, which would close
      // the reaction picker the moment "React" opens it.
      e.stopPropagation();
      closeMsgActions();
      act();
    } }, [icon(ico, 16), label]);
    if (danger) b.style.color = "var(--danger)";
    msgActionsEl.append(b);
  });
  document.body.append(msgActionsEl);
  placePopup(msgActionsEl, anchor.getBoundingClientRect(), "below");
}

// Place a floating popup against an anchor, clamped to the viewport.
// left/top are pinned before measuring: while they're `auto` the popup is laid
// out by the body's flex rules, which can report a misleading size and leave a
// non-finite result that silently drops the element off-screen.
function placePopup(node, anchorRect, side) {
  node.style.left = "0px";
  node.style.top = "0px";
  const w = node.offsetWidth || 260;
  const h = node.offsetHeight || 150;
  const anchorLeft = Number.isFinite(anchorRect?.left) ? anchorRect.left : 0;
  const anchorTop = Number.isFinite(anchorRect?.top) ? anchorRect.top : 0;
  const anchorW = Number.isFinite(anchorRect?.width) ? anchorRect.width : 0;
  const anchorH = Number.isFinite(anchorRect?.height) ? anchorRect.height : 0;

  const left = Math.min(Math.max(8, anchorLeft + anchorW / 2 - w / 2), Math.max(8, window.innerWidth - w - 8));
  const top =
    side === "above"
      ? Math.max(8, anchorTop - h - 8)
      : Math.min(anchorTop + anchorH + 6, Math.max(8, window.innerHeight - h - 8));

  node.style.left = `${Math.round(Number.isFinite(left) ? left : 8)}px`;
  node.style.top = `${Math.round(Number.isFinite(top) ? top : 8)}px`;
}

// ---- Edit message (encrypted like sending) ----
let editingMsg = null;

function openEditModal(msg) {
  editingMsg = msg;
  const input = document.getElementById("edit-message-input");
  input.value = msg._plain || "";
  document.getElementById("edit-modal").classList.remove("hidden");
  input.focus();
}

async function saveEdit() {
  const msg = editingMsg;
  const newText = document.getElementById("edit-message-input").value.trim();
  if (!msg || !newText || newText === msg._plain) {
    document.getElementById("edit-modal").classList.add("hidden");
    return;
  }

  let content = newText;
  let iv = null;
  const convKey = await getConversationKey(msg.conversation_id);
  if (convKey) {
    const enc = await window.PanaloCrypto.encryptMessage(newText, convKey);
    content = enc.ciphertext;
    iv = enc.iv;
  }

  // .select() so an RLS-filtered (silent) no-op is detectable as 0 rows.
  const { data, error } = await supabaseClient
    .from("messages")
    .update({ content, iv, edited_at: new Date().toISOString() })
    .eq("id", msg.id)
    .select("id");

  if (error || !data || !data.length) {
    showToast(error && !/column/i.test(error.message) ? "Could not edit the message." : "Run supabase-phase5.sql to enable editing.");
    return;
  }

  // Update in place (the realtime UPDATE echo is deduped by content).
  msg._plain = newText;
  msg.edited_at = new Date().toISOString();
  const rowEl = document.getElementById(`msg-${msg.id}`);
  if (rowEl) {
    const textEl = rowEl.querySelector(".message-text");
    if (textEl) textEl.textContent = newText;
    if (!rowEl.querySelector(".edited-tag")) {
      rowEl.querySelector(".message-footer")?.append(el("span", { class: "edited-tag", text: "edited" }));
    }
  }
  document.getElementById("edit-modal").classList.add("hidden");
  editingMsg = null;
}

// ---- Pinned messages bar + modal ----
function refreshPinnedBar(convId) {
  const bar = document.getElementById("pinned-bar");
  const count = getPinnedMessages(convId).length;
  document.getElementById("pinned-count").textContent = `${count} pinned message${count === 1 ? "" : "s"}`;
  bar.classList.toggle("hidden", count === 0);
}

async function openPinnedModal() {
  const convId = state.currentConversationId;
  const ids = getPinnedMessages(convId);
  if (!ids.length) return;
  const listEl = document.getElementById("pinned-list");
  listEl.innerHTML = "";

  const { data } = await supabaseClient.from("messages").select("*").in("id", ids).order("created_at");
  (data || []).forEach((msg) => {
    const textEl = el("div", { class: "star-item-text", text: msg.file_url ? "📎 Attachment" : "…" });
    if (msg.content) messagePlaintext(msg).then((t) => (textEl.textContent = t));
    listEl.append(
      el("div", { class: "star-item" }, [
        el("div", { class: "star-item-top" }, [
          el("span", { text: `${msg.username || "?"}` }),
          el("button", { class: "member-remove", type: "button", text: "Unpin", onClick: (e) => {
            e.stopPropagation();
            toggleMessagePin(convId, msg.id);
            refreshMsgFlags(msg.id);
            refreshPinnedBar(convId);
            e.target.closest(".star-item").remove();
          } }),
        ]),
        textEl,
      ])
    );
  });
  document.getElementById("pinned-modal").classList.remove("hidden");
}

// ---- Per-chat font + wallpaper (personal) ----
function applyChatFont(convId) {
  const font = FONT_PRESETS.find((f) => f.id === getChatFont(convId)) || FONT_PRESETS[0];
  chatMainEl.style.setProperty("--chat-font", font.stack);
}

// "app" means inherit whatever the app-wide wallpaper is.
export function applyChatWallpaper(convId) {
  const id = getChatWallpaper(convId);
  if (id === "app") delete chatMainEl.dataset.wp;
  else chatMainEl.dataset.wp = id;
}

async function deleteMessage(msgId) {
  const { error } = await supabaseClient.from("messages").delete().eq("id", msgId);
  if (error) showToast("Could not delete the message.");
}

// ---- Replying ----
async function startReply(msg) {
  replyTarget = msg;
  const bar = document.getElementById("reply-bar");
  document.getElementById("reply-bar-author").textContent =
    msg.user_id === state.currentUser.id ? "You" : msg.username || "Unknown";
  document.getElementById("reply-bar-text").textContent = msg.file_url
    ? "📎 Attachment"
    : await messagePlaintext(msg);
  bar.classList.remove("hidden");
  messageInput.focus();
}

function cancelReply() {
  replyTarget = null;
  document.getElementById("reply-bar").classList.add("hidden");
}

// ---- Sending (optimistic) ----
function handleSend() {
  const content = messageInput.value.trim();
  const file = fileInput.files[0];

  if (!content && !file) return;
  if (!state.currentConversationId) return;

  const convId = state.currentConversationId;
  const replyToId = replyTarget?.id || null;
  messageInput.value = "";
  fileInput.value = "";
  filePreview.classList.add("hidden");
  filePreview.innerHTML = "";
  cancelReply();

  sendMessage(content, file, convId, replyToId);
}

async function sendMessage(content, file, convId, replyToId = null) {
  const tempId = "temp-" + crypto.randomUUID();
  const isImage = file && file.type.startsWith("image/");
  const localPreview = isImage ? URL.createObjectURL(file) : null;
  const retry = () => sendMessage(content, file, convId, replyToId);

  renderMessage({
    id: tempId,
    user_id: state.currentUser.id,
    username: state.currentUsername,
    content,
    iv: null,
    file_url: null,
    _localPreview: localPreview,
    _localFileMeta: file && !isImage ? { url: null, name: file.name, size: file.size } : null,
    created_at: new Date().toISOString(),
    conversation_id: convId,
    reply_to: replyToId,
    _pending: true,
  });
  scrollToBottom();

  try {
    let fileUrl = null;
    if (file) {
      if (file.size > MAX_FILE_BYTES) return markSendFailed(tempId, "File too large (max 50 MB)", retry);
      let path;
      let toUpload;
      if (file.type.startsWith("image/")) {
        toUpload = await compressImage(file);
        const ext = (toUpload.name.split(".").pop() || "img").toLowerCase();
        path = `${Date.now()}_${crypto.randomUUID()}.${ext}`;
      } else {
        // Any other file type: raw upload with size + name encoded in the path.
        toUpload = file;
        const safeName = (file.name || "file").replace(/[^\w.\- ]+/g, "_").slice(-80);
        path = `files/${Date.now()}_${crypto.randomUUID()}_s${file.size}__${safeName}`;
      }
      const { error: uploadError } = await supabaseClient.storage
        .from("chat-files")
        .upload(path, toUpload, { contentType: toUpload.type || undefined });
      if (uploadError) return markSendFailed(tempId, "Upload failed", retry);
      fileUrl = supabaseClient.storage.from("chat-files").getPublicUrl(path).data.publicUrl;
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

    const row = {
      content: storedContent,
      iv: storedIv,
      username: state.currentUsername,
      user_id: state.currentUser.id,
      conversation_id: convId,
      file_url: fileUrl,
    };
    // Only send reply_to when there's a reply, so plain messages still work on
    // a database where supabase-phase6.sql hasn't been run yet.
    if (replyToId) row.reply_to = replyToId;

    let { data: inserted, error: insertError } = await supabaseClient.from("messages").insert([row]).select().single();

    // Replying before the column exists: send it as a normal message instead of
    // losing what was typed.
    if (insertError && replyToId && /reply_to|column/i.test(insertError.message)) {
      delete row.reply_to;
      ({ data: inserted, error: insertError } = await supabaseClient.from("messages").insert([row]).select().single());
      if (!insertError) showToast("Sent — run supabase-phase6.sql to enable replies.", "");
    }

    if (insertError || !inserted) return markSendFailed(tempId, "Message failed to send", retry);

    reconcileSend(tempId, inserted, localPreview);
  } catch (e) {
    console.error("Send failed:", e);
    markSendFailed(tempId, "Message failed to send", retry);
  }
}

function reconcileSend(tempId, realMsg, localPreview) {
  // Replace the optimistic row with the real one (renderMessage brings the
  // actions menu, flags, and file card along for free).
  const tempEl = document.getElementById(`msg-${tempId}`);
  msgCache.delete(tempId);
  if (tempEl) tempEl.remove();
  renderMessage(realMsg);
  scrollToBottom();
  if (localPreview) URL.revokeObjectURL(localPreview);

  // Our own message updates the chat list preview + ordering too.
  const conv = allConversations.find((c) => c.id === realMsg.conversation_id);
  if (conv) {
    conv.lastMessage = realMsg;
    conv.lastAt = realMsg.created_at;
    renderConversations();
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
          // We're looking at it, so tell the sender it's been read.
          if (!document.hidden) markConversationRead(payload.new.conversation_id);
        }
      }
    )
    // Edits: refresh the text + "edited" tag in place.
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${state.currentConversationId}` },
      (payload) => {
        const m = payload.new;
        const rowEl = document.getElementById(`msg-${m.id}`);
        if (!rowEl) return;
        msgCache.set(m.id, m);
        const textEl = rowEl.querySelector(".message-text");
        if (textEl && m.content) {
          messagePlaintext(m).then((t) => {
            textEl.textContent = t;
            m._plain = t;
          });
        }
        if (m.edited_at && !rowEl.querySelector(".edited-tag")) {
          rowEl.querySelector(".message-footer")?.append(el("span", { class: "edited-tag", text: "edited" }));
        }
      }
    )
    // DELETE payloads only carry the primary key, so we can't filter by
    // conversation here. The handler is a no-op unless the id is on screen.
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, (payload) => {
      const targetEl = document.getElementById(`msg-${payload.old.id}`);
      if (targetEl) targetEl.remove();
      msgCache.delete(payload.old.id);
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

// ---- Chat options menu (mute, theme, members) ----
async function viewMembers() {
  const conv = state.currentConversation;
  if (!conv) return;
  const listEl = document.getElementById("members-list");
  listEl.innerHTML = "";
  const { data } = await supabaseClient
    .from("conversation_participants")
    .select("user_id, profiles(username)")
    .eq("conversation_id", conv.id);
  (data || []).forEach((p) => {
    const name = (p.user_id === state.currentUser.id ? "You" : p.profiles?.username) || "Unknown";
    const avatar = el("div", { class: "avatar", text: name.trim().charAt(0).toUpperCase() });
    avatar.style.background = getAvatarColor(name);
    avatar.style.width = "34px";
    avatar.style.height = "34px";
    avatar.style.fontSize = "13px";
    listEl.append(el("div", { class: "member-row" }, [avatar, el("span", { text: name })]));
  });
  document.getElementById("members-modal").classList.remove("hidden");
}

function openChatMenu() {
  const conv = state.currentConversation;
  const menu = document.getElementById("chat-menu");
  // "View members" only makes sense for groups.
  document.getElementById("menu-members").style.display = conv && conv.type === "group" ? "block" : "none";
  // Reflect current mute + pin state.
  const muteLabel = menu.querySelector('[data-action="mute"] .menu-label');
  const pinLabel = menu.querySelector('[data-action="pin"] .menu-label');
  if (conv) {
    muteLabel.textContent = isMuted(conv.id) ? "Unmute notifications" : "Mute notifications";
    pinLabel.textContent = isPinned(conv.id) ? "Unpin chat" : "Pin chat";
  }
  menu.classList.remove("hidden");
}

// ---- Focus mode (distraction-free: no rail, no list, no ambient) ----
export function setFocusMode(on) {
  document.body.classList.toggle("focus-mode", on);
  if (!on) document.body.classList.remove("panel-out");
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

  // One "+" in the rail opens a chooser: direct chat or group.
  const newChatModal = document.getElementById("new-chat-modal");
  document.getElementById("new-chat-btn").addEventListener("click", () => {
    newChatModal.classList.remove("hidden");
  });
  document.getElementById("close-new-chat-modal").addEventListener("click", () => newChatModal.classList.add("hidden"));
  document.getElementById("choose-direct").addEventListener("click", () => {
    newChatModal.classList.add("hidden");
    directModal.classList.remove("hidden");
    document.getElementById("direct-username").focus();
  });
  document.getElementById("choose-group").addEventListener("click", () => {
    newChatModal.classList.add("hidden");
    groupModal.classList.remove("hidden");
    document.getElementById("group-name-input").focus();
  });
  document.getElementById("close-direct-modal").addEventListener("click", () => directModal.classList.add("hidden"));
  document.getElementById("close-group-modal").addEventListener("click", () => groupModal.classList.add("hidden"));

  // Focus mode: hide the rail + list + ambient, and give back a floating
  // control to pop the chat list out again.
  const focusBtn = document.getElementById("focus-btn");
  focusBtn.addEventListener("click", () => setFocusMode(!document.body.classList.contains("focus-mode")));
  document.getElementById("focus-exit-btn").addEventListener("click", () => setFocusMode(false));
  document.getElementById("focus-panel-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    document.body.classList.toggle("panel-out");
  });

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
    const isImage = file.type.startsWith("image/");
    if (file.size > MAX_FILE_BYTES) {
      showToast("That file is over the 50 MB limit.");
      fileInput.value = "";
      filePreview.classList.add("hidden");
      return;
    }
    const previewUrl = isImage ? URL.createObjectURL(file) : null;
    filePreview.append(
      isImage
        ? el("img", { src: previewUrl, class: "file-preview-thumb", alt: "Selected image" })
        : el("span", { class: "file-bubble-icon", text: fileIcon(file.name) }),
      el("span", { class: "file-preview-name", text: `${file.name} · ${prettyBytes(file.size)}` }),
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

  // Reply bar dismissal.
  document.getElementById("cancel-reply").addEventListener("click", cancelReply);

  // Reactions + receipts keep themselves in sync in the background.
  setReactionListener(renderReactions);
  setReceiptListener(refreshAllTicks);
  startReactions();

  // Refresh the header status whenever anyone's online state changes.
  setPresenceListener(refreshChatSubtitle);

  // Live inbox: every incoming message updates previews, ordering, and unread
  // counts — even for chats that aren't open.
  setInboxListener(async (msg) => {
    const conv = allConversations.find((c) => c.id === msg.conversation_id);
    if (!conv) {
      // A chat someone just added us to — pull the list fresh.
      await fetchConversations();
      return;
    }
    conv.lastMessage = msg;
    conv.lastAt = msg.created_at;

    const watching = msg.conversation_id === state.currentConversationId && !document.hidden;
    if (watching) {
      markRead(conv.id);
      conv.unread = 0;
    } else {
      conv.unread = (conv.unread || 0) + 1;
    }
    refreshUnreadBadges();
    renderConversations();
  });

  // Clicking an alert banner (or a desktop notification) jumps to that chat.
  setOpenChatListener((convId) => {
    const conv = allConversations.find((c) => c.id === convId);
    if (conv) openConversation(conv);
  });

  // Coming back to the tab marks the open chat as read.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !state.currentConversationId) return;
    const conv = allConversations.find((c) => c.id === state.currentConversationId);
    if (!conv) return;
    markRead(conv.id);
    markConversationRead(conv.id);
    conv.unread = 0;
    refreshUnreadBadges();
    renderConversations();
  });

  // Chat search + rail view switcher (All / Direct / Groups / Starred).
  const searchInput = document.getElementById("chat-search");
  searchInput.addEventListener("input", () => {
    chatSearch = searchInput.value;
    renderConversations();
  });
  document.querySelectorAll(".rail-btn[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      chatFilter = btn.dataset.view;
      document.querySelectorAll(".rail-btn[data-view]").forEach((b) => b.classList.toggle("active", b === btn));
      renderConversations();
    });
  });

  // Chat info drawer: click the header identity (or ⋮ → Chat info).
  const headerMain = document.getElementById("chat-header-main");
  headerMain.addEventListener("click", openChatInfo);
  headerMain.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openChatInfo();
    }
  });
  setChatInfoCallbacks({
    onListChanged: renderConversations,
    onTitleChanged: (conv) => {
      if (conv.id === state.currentConversationId) activeChatTitle.textContent = displayTitle(conv);
    },
    onOpenTheme: () => {
      updateSwatchSelection(state.currentConversation?.theme);
      document.getElementById("theme-modal").classList.remove("hidden");
    },
    onWallpaperChanged: (convId) => applyChatWallpaper(convId),
    onLeftChat: async (convId) => {
      if (state.currentConversationId === convId) {
        state.currentConversationId = null;
        state.currentConversation = null;
        activeChatWindow.classList.add("hidden");
        noChatSelected.classList.remove("hidden");
        chatApp.classList.remove("chat-open");
      }
      await fetchConversations();
    },
  });
  initChatInfo();

  // Pinned messages bar + modal.
  document.getElementById("pinned-bar").addEventListener("click", openPinnedModal);
  document.getElementById("close-pinned-modal").addEventListener("click", () => {
    document.getElementById("pinned-modal").classList.add("hidden");
  });

  // Edit-message modal.
  document.getElementById("save-edit-btn").addEventListener("click", saveEdit);
  document.getElementById("close-edit-modal").addEventListener("click", () => {
    document.getElementById("edit-modal").classList.add("hidden");
    editingMsg = null;
  });
  document.getElementById("edit-message-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveEdit();
  });

  // Chat options menu.
  const chatMenu = document.getElementById("chat-menu");
  document.getElementById("chat-menu-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    if (chatMenu.classList.contains("hidden")) openChatMenu();
    else chatMenu.classList.add("hidden");
  });
  chatMenu.addEventListener("click", (e) => {
    const item = e.target.closest(".chat-menu-item");
    if (!item) return;
    chatMenu.classList.add("hidden");
    const conv = state.currentConversation;
    if (item.dataset.action === "info") {
      openChatInfo();
    } else if (item.dataset.action === "mute" && conv) {
      const muted = toggleMute(conv.id);
      showToast(muted ? "Chat muted" : "Chat unmuted", "success");
    } else if (item.dataset.action === "pin" && conv) {
      const pinned = togglePin(conv.id);
      showToast(pinned ? "Chat pinned" : "Chat unpinned", "success");
      renderConversations();
    } else if (item.dataset.action === "theme") {
      updateSwatchSelection(conv?.theme);
      document.getElementById("theme-modal").classList.remove("hidden");
    } else if (item.dataset.action === "members") {
      viewMembers();
    }
  });
  // Close menus (and the popped-out focus panel) when clicking elsewhere.
  document.addEventListener("click", (e) => {
    chatMenu.classList.add("hidden");
    closeMsgActions();
    if (!e.target.closest(".reaction-picker")) closeReactionPicker();
    if (document.body.classList.contains("panel-out") && !e.target.closest(".sidebar, .focus-controls")) {
      document.body.classList.remove("panel-out");
    }
  });
  document.getElementById("close-members-modal").addEventListener("click", () => {
    document.getElementById("members-modal").classList.add("hidden");
  });
}
