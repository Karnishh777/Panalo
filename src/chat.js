// Conversations, messages, sending, and realtime.
import { supabaseClient } from "./client.js";
import { state } from "./state.js";
import { el, showToast, withBusy, getAvatarColor, safeImageUrl, scrollToBottom, compressImage, announce, setAvatar, formatTime, haptic, hueFor, attachRipples, mapLimited } from "./util.js";
import { getConversationKey, provisionConversationKey, ensureConversationKey, messagePlaintext } from "./encryption.js";
import { uploadEncrypted, loadEncrypted, isEncryptedAttachment, isImageEntry, primeAttachmentCache, clearAttachmentCache, deleteAttachment } from "./attachments.js";
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
  getFolders, addFolder, deleteFolder, folderChatIds,
  getDraft, setDraft, forgetDraft,
} from "./prefs.js";
import { icon } from "./icons.js";
import {
  isChatLocked, toggleChatLock, isChatUnlocked, markChatUnlocked,
  isChatHidden, toggleChatHidden, hiddenVisible, askPin, hasPin, setPin,
  initHiddenShortcut, hiddenCount,
} from "./lock.js";
import {
  REACTION_EMOJIS, groupedReactions, loadReactions, toggleReaction,
  setReactionListener, startReactions,
} from "./reactions.js";
import {
  markConversationRead, loadReadState, isReadByAll, subscribeReceipts,
  setReceiptListener, loadMyReadMarkers,
} from "./receipts.js";
import { searchMessages, invalidateSearchIndex } from "./search.js";
import { parseSticker, stickerSvg, stickerImg, describeText, initStickerPicker } from "./stickers.js";
import { getMemories, isDismissed as isMemoryDismissed, dismiss as dismissMemory } from "./memories.js";
import {
  snoozeMessage, cancelSnooze, isSnoozed, presetOptions, humanWhen,
  setSnoozeFireHandler, startSnoozes, pendingCount,
} from "./snooze.js";
import { initCalls, startCall, setCallLogger, parseCall, describeCall } from "./calls.js";
import { parseLocation, locationCard, locationMarker, getCurrentPosition, initLocation, describeLocation } from "./location.js";
import { openChatInfo, closeChatInfo, setChatInfoCallbacks, displayTitle, initChatInfo, deleteConversation } from "./chatinfo.js";
import { reportChannelStatus, forgetChannel, onResync, requestResync } from "./connection.js";

// Message rows currently on screen (id → row) — powers the actions menu.
const msgCache = new Map();
// Members of the open conversation, needed to decide when a message is read.
let currentMemberIds = [];
// Newest message from anyone else in the open chat (drives the 1:1 "Seen").
let lastOtherMessageAt = null;
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

// Sidebar metadata for every chat: the latest message (preview + ordering)
// and the unread count. RLS already limits every query here to the user's
// own chats.
//
// The cheap pass is one query for the newest messages across all chats. It
// cannot be the only pass, though: a global LIMIT says nothing about
// per-conversation coverage. One busy group could fill the entire window on
// its own, and every quieter chat would come back with no rows at all --
// showing no preview, no timestamp (so sorting to the bottom of the list)
// and no unread badge, as though nothing had ever been said in it. The
// quieter the chat, the more likely it vanished, which is exactly backwards.
//
// So anything the scan didn't reach gets asked for directly.
const META_SCAN_LIMIT = 500;
// Per gap-filled chat: enough for the preview and for an unread count that's
// accurate up to the badge's own "99+" cap.
const META_PER_CONVERSATION_LIMIT = 100;
// Gap queries run in parallel, but not unboundedly -- a user with many quiet
// chats shouldn't open a hundred sockets at once.
const META_GAP_CONCURRENCY = 8;

const META_FIELDS = "id, conversation_id, user_id, username, content, iv, file_url, created_at";

async function hydrateConversationMeta() {
  if (!allConversations.length) {
    refreshUnreadBadges();
    return;
  }

  const { data } = await supabaseClient
    .from("messages")
    .select(META_FIELDS)
    .order("created_at", { ascending: false })
    .limit(META_SCAN_LIMIT);

  const byConv = new Map();
  for (const m of data || []) {
    if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
    byConv.get(m.conversation_id).push(m);
  }

  // A chat missing from the scan is not necessarily empty -- it's just
  // older than the newest META_SCAN_LIMIT messages. Ask for its own page.
  // Genuinely empty chats cost one cheap indexed query and return nothing,
  // which is the correct answer for them anyway.
  const gaps = allConversations.filter((c) => !byConv.has(c.id));
  if (gaps.length) {
    const filled = await mapLimited(gaps, META_GAP_CONCURRENCY, async (conv) => {
      const { data: rows } = await supabaseClient
        .from("messages")
        .select(META_FIELDS)
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: false })
        .limit(META_PER_CONVERSATION_LIMIT);
      return { id: conv.id, rows: rows || [] };
    });
    filled.forEach(({ id, rows }) => byConv.set(id, rows));
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
  if (sameDay) return formatTime(d);
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
  if (q.length >= 2) renderMessageHits(q);
  const folderIds = chatFilter.startsWith("folder:") ? folderChatIds(chatFilter.slice(7)) : null;
  const items = allConversations
    // Hidden chats stay out of the list until revealed in Settings.
    .filter((c) => hiddenVisible() || !isChatHidden(c.id))
    .filter((c) => (folderIds ? folderIds.includes(c.id) : chatFilter === "all" || c.type === chatFilter))
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
  if (!items.length && q.length < 2) {
    if (q) {
      conversationsList.append(el("div", { class: "list-empty", text: "No chats match your search." }));
    } else {
      // No chats at all in this view — soft, encouraging empty state.
      const isFiltered = chatFilter !== "all";
      conversationsList.append(el("div", { class: "empty-list" }, [
        el("span", { class: "empty-emoji", text: isFiltered ? "🗂️" : "💬" }),
        el("div", { class: "empty-title", text: isFiltered ? "Nothing here yet." : "Start a chat" }),
        el("div", { class: "empty-sub", text: isFiltered
          ? "Chats you add to this view will appear here."
          : "Tap the pencil to message someone by username." }),
      ]));
    }
    return;
  }
  renderConversationsWithSections(items);
}

// Group the sidebar into readable time buckets — "Pinned", "Today",
// "Yesterday", "This week", "Earlier". Same data as a flat list, way easier
// on the eye. Pinned chats keep their existing top-of-list rule.
function renderConversationsWithSections(items) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;

  const buckets = { pinned: [], today: [], yesterday: [], week: [], earlier: [] };
  items.forEach((c) => {
    if (isPinned(c.id)) return buckets.pinned.push(c);
    const t = c.lastAt ? new Date(c.lastAt).getTime() : 0;
    if (t >= startOfToday) buckets.today.push(c);
    else if (t >= startOfYesterday) buckets.yesterday.push(c);
    else if (t >= startOfWeek) buckets.week.push(c);
    else buckets.earlier.push(c);
  });

  const emit = (label, chats) => {
    if (!chats.length) return;
    conversationsList.append(el("div", { class: "sidebar-section", text: label }));
    chats.forEach((c) => renderConversationItem(c));
  };
  emit("Pinned", buckets.pinned);
  emit("Today", buckets.today);
  emit("Yesterday", buckets.yesterday);
  emit("This week", buckets.week);
  emit("Earlier", buckets.earlier);
}

// Message hits are appended under the matching chats, newest first. Searching
// happens on this device because the server only ever sees ciphertext.
let searchToken = 0;

async function renderMessageHits(q) {
  const token = ++searchToken;
  const section = el("div", { class: "search-section" }, [
    el("div", { class: "search-heading", text: "Messages" }),
    el("div", { class: "list-empty", text: "Searching…" }),
  ]);
  conversationsList.append(section);

  const hits = await searchMessages(q);
  if (token !== searchToken) return; // a newer keystroke won
  // The list may have been rebuilt while we were decrypting.
  if (!section.isConnected) return;

  section.innerHTML = "";
  section.append(el("div", { class: "search-heading", text: `Messages (${hits.length})` }));
  if (!hits.length) {
    section.append(el("div", { class: "list-empty", text: "No messages match." }));
    return;
  }

  for (const hit of hits) {
    const conv = allConversations.find((c) => c.id === hit.conversation_id);
    const when = new Date(hit.created_at).toLocaleDateString([], { day: "numeric", month: "short" });
    const who = hit.user_id === state.currentUser.id ? "You" : hit.username || "?";
    const item = el("div", { class: "star-item", role: "button", tabindex: "0" }, [
      el("div", { class: "star-item-top" }, [
        el("span", { text: `${conv ? displayTitle(conv) : "Chat"} · ${who}` }),
        el("span", { text: when }),
      ]),
      el("div", { class: "star-item-text", text: hit.text || "📎 Attachment" }),
    ]);
    item.addEventListener("click", async () => {
      if (!conv) return;
      await openConversation(conv);
      jumpToMessage(hit.id);
    });
    section.append(item);
  }
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

// Read the extension off an uploaded file's URL and turn it into a friendly
// pill label — "🖼️ Photo" reads better than "📎 Attachment" when the peer
// actually sent a photo.
function describeAttachment(url) {
  // Encrypted attachments carry no extension in their path -- the type is
  // inside the ciphertext, and the sidebar isn't worth a decrypt to find out.
  if (isEncryptedAttachment(url)) return { icon: "\u{1F4CE}", label: "Attachment" };
  const ext = String(url || "").toLowerCase().split("?")[0].split(".").pop();
  if (/^(jpg|jpeg|png|gif|webp|avif|heic|bmp)$/.test(ext)) return { icon: "🖼️", label: "Photo" };
  if (/^(mp4|mov|webm|m4v)$/.test(ext)) return { icon: "🎬", label: "Video" };
  if (/^(mp3|wav|ogg|m4a|opus|flac)$/.test(ext)) return { icon: "🎵", label: "Audio" };
  if (/^pdf$/.test(ext)) return { icon: "📕", label: "PDF" };
  return { icon: "📎", label: "File" };
}

function renderConversationItem(conv) {
  const isGroup = conv.type === "group";
  const baseTitle = isGroup ? conv.name : (conv.displayTitle || conv.name || "Direct Message");
  const title = getNickname(conv.id) || baseTitle;

  const peerOnline = !isGroup && conv.otherUserId && isOnline(conv.otherUserId);
  const item = el("div", {
    class: `conv-item${conv.id === state.currentConversationId ? " active" : ""}${peerOnline ? " online" : ""}`,
    role: "button",
    tabindex: "0",
    "aria-label": `Open ${isGroup ? "group chat" : "direct message"}: ${title}`,
  });
  item.dataset.convId = conv.id;

  const avatar = el("div", { class: "avatar" });
  setAvatar(avatar, baseTitle, isGroup ? null : conv.otherAvatar);

  // Preview line: a saved draft beats the last message (matches WhatsApp).
  // Otherwise: last message decrypted, with the sender's name in groups.
  const draft = getDraft(conv.id);
  const last = conv.lastMessage;
  const previewEl = el("div", { class: "conv-preview" });
  if (draft) {
    previewEl.append(
      el("span", { class: "conv-preview-tag", text: "Draft: " }),
      document.createTextNode(draft.length > 60 ? draft.slice(0, 60) + "…" : draft)
    );
  } else if (!last) {
    previewEl.textContent = isGroup ? "Group Chat" : "Direct Message";
  } else if (last.file_url) {
    // Type-aware attachment label — knowing at a glance whether the peer sent
    // you a photo or a PDF is worth the extra branch.
    const attachment = describeAttachment(last.file_url);
    const mine = last.user_id === state.currentUser.id;
    const who = mine ? "You: " : isGroup ? `${last.username || "?"}: ` : "";
    previewEl.append(
      el("span", { class: "conv-preview-icon", text: attachment.icon }),
      document.createTextNode(` ${who}${attachment.label}`)
    );
  } else {
    previewEl.textContent = "…";
    messagePlaintext(last).then((text) => {
      const mine = last.user_id === state.currentUser.id;
      const who = mine ? "You: " : isGroup ? `${last.username || "?"}: ` : "";
      const raw = describeCall(describeLocation(describeText(text)));
      previewEl.textContent = who + raw;
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
        isChatLocked(conv.id) ? el("span", { class: "conv-lock", "aria-label": "Locked" }, [icon("lock", 13)]) : null,
        isChatHidden(conv.id) ? el("span", { class: "conv-lock", "aria-label": "Hidden" }, [icon("eyeOff", 13)]) : null,
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
  wireConvContextMenu(item, conv);

  conversationsList.append(item);
}

// ---- Quick-action menu on a conversation item (right-click / long-press) ----
// Pin, Mute, Mark as read, Delete — the actions users hunt for and can't find.
// Anchors to the item that was clicked, reuses the same popup styling as the
// message action menu so it feels native.
let convMenuEl = null;
function closeConvMenu() {
  convMenuEl?.remove();
  convMenuEl = null;
}
document.addEventListener("click", (e) => {
  if (!convMenuEl) return;
  if (!e.target.closest(".msg-actions")) closeConvMenu();
});
document.addEventListener("scroll", closeConvMenu, true);

function openConvMenu(conv, anchor) {
  closeConvMenu();
  const items = [
    { ico: "pin", label: isPinned(conv.id) ? "Unpin chat" : "Pin chat", act: () => {
      togglePin(conv.id);
      renderConversations();
      haptic(6);
    } },
    { ico: isMuted(conv.id) ? "bell" : "bellOff", label: isMuted(conv.id) ? "Unmute" : "Mute", act: () => {
      toggleMute(conv.id);
      renderConversations();
      haptic(6);
    } },
    { ico: "checkDouble", label: "Mark as read", act: () => {
      markRead(conv.id);
      markConversationRead(conv.id);
      conv.unread = 0;
      refreshUnreadBadges();
      renderConversations();
    } },
    { ico: "trash", label: conv.type === "group" ? "Leave & delete" : "Delete chat", danger: true, act: () => {
      deleteConversation(conv);
    } },
  ];
  convMenuEl = el("div", { class: "msg-actions", role: "menu" });
  items.forEach(({ ico, label, act, danger }) => {
    const b = el("button", { class: "chat-menu-item", type: "button", role: "menuitem", onClick: (e) => {
      e.stopPropagation();
      closeConvMenu();
      act();
    } }, [icon(ico, 16), label]);
    if (danger) b.style.color = "var(--danger)";
    convMenuEl.append(b);
  });
  document.body.append(convMenuEl);
  placePopup(convMenuEl, anchor, "below");
}

function wireConvContextMenu(item, conv) {
  item.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openConvMenu(conv, item);
  });
  // Long-press for touch. 500ms feels intentional without frustrating.
  let pressTimer = null;
  let pressed = false;
  const clear = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };
  item.addEventListener("touchstart", (e) => {
    pressed = false;
    // Set the ripple centre to where the finger landed.
    const rect = item.getBoundingClientRect();
    const t = e.touches[0];
    if (t) {
      item.style.setProperty("--rx", `${t.clientX - rect.left}px`);
      item.style.setProperty("--ry", `${t.clientY - rect.top}px`);
    }
    pressTimer = setTimeout(() => {
      pressed = true;
      haptic(12);
      item.classList.add("pressed");
      setTimeout(() => item.classList.remove("pressed"), 620);
      openConvMenu(conv, item);
    }, 500);
  }, { passive: true });
  item.addEventListener("touchend", (e) => {
    clear();
    // If we opened the menu on long-press, swallow the tap that follows so the
    // chat doesn't open behind the menu.
    if (pressed) {
      e.preventDefault();
      pressed = false;
    }
  });
  item.addEventListener("touchmove", clear, { passive: true });
  item.addEventListener("touchcancel", clear);
}

async function openConversation(conv) {
  // A locked chat asks for the chat-lock PIN once per session before it opens.
  if (!isChatUnlocked(conv.id)) {
    const ok = await askPin({
      purpose: "chat",
      title: "This chat is locked",
      subtitle: "Enter your chat-lock PIN",
    });
    if (!ok) return;
    markChatUnlocked(conv.id);
  }

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

  // Calls are 1:1 only (group calls need an SFU — a separate initiative).
  const callable = conv.type === "direct" && !!conv.otherUserId;
  document.querySelectorAll(".direct-only").forEach((b) => b.classList.toggle("hidden", !callable));

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
  lastOtherMessageAt = null;

  // Restore any half-typed message you left here last time. Focus the composer
  // so you can keep going with the same key press.
  messageInput.value = getDraft(conv.id);
  refreshSendReady();

  // Composer placeholder learns from the chat: for empty chats we invite you
  // to say hi to the specific person; otherwise it's the neutral default.
  // "Say hi to Ada 👋" reads warmer than "Type a message..." for a first message.
  const convIsGroup = conv.type === "group";
  const peerName = convIsGroup ? conv.name : (conv.displayTitle || conv.name || "");
  const emptyChat = !conv.lastMessage;
  messageInput.placeholder = emptyChat && peerName
    ? `Say hi to ${peerName.split(" ")[0]} 👋`
    : "Type a message...";

  // Play the chat-switch motion (fade + soft slide-in). The class is removed
  // and re-added via a forced reflow so it restarts even when the previous
  // chat used the same class.
  activeChatWindow.classList.remove("chat-enter");
  void activeChatWindow.offsetWidth;
  activeChatWindow.classList.add("chat-enter");

  // Per-chat mood colour. Seed on the peer's user id for direct chats and on
  // the conversation id for groups — same peer always picks up the same
  // accent, so every friend feels visually distinct without needing anything
  // stored per-chat. The chat pane exposes it as --chat-accent; CSS uses it
  // for the header title color and (via a derived gradient) the outgoing
  // bubble fill. Dark, moderate saturation keeps it legible on a white card.
  const hue = hueFor(conv.type === "direct" && conv.otherUserId ? conv.otherUserId : conv.id);
  const accent = `hsl(${hue} 38% 32%)`;
  activeChatWindow.style.setProperty("--chat-accent-h", hue);
  activeChatWindow.style.setProperty("--chat-accent", accent);
  activeChatWindow.style.setProperty("--chat-accent-grad", `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 55%, white))`);

  // Skeleton messages while we wait for the real ones. Keeps the pane alive
  // instead of flashing empty.
  messagesList.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    messagesList.append(el("div", { class: `msg-skeleton ${i % 2 === 0 ? "left" : "right"}` }));
  }

  // Who's in this chat + where everyone has read up to (drives "Seen").
  const [{ data: parts }] = await Promise.all([
    supabaseClient.from("conversation_participants").select("user_id").eq("conversation_id", conv.id),
    loadReadState(conv.id),
  ]);
  currentMemberIds = (parts || []).map((p) => p.user_id);

  // A chat created while someone was still setting up encryption never got a
  // key, and nothing revisited that -- so it stayed plaintext forever, even
  // once everyone in it had keys. Opening it is the natural moment to check,
  // and the member list is already loaded, so this costs no extra query
  // unless a backfill is actually possible.
  ensureConversationKey(conv.id, currentMemberIds).then(({ backfilled }) => {
    if (!backfilled) return;
    // Say so. How a chat is protected shouldn't change silently underneath
    // the people using it, and the honest caveat is that this applies going
    // forward -- messages already sent in the clear stay that way.
    showToast("This chat is encrypted from now on. Earlier messages stay as they were.", "success");
    // The chat-info drawer reads the key when it opens, so its badge picks
    // this up on its own the next time it's shown.
  });

  await fetchMessages();
  // "On this day" — fired after messages render, before subscribing, so the
  // banner appears above the historical thread rather than jumping in later.
  renderMemoriesBanner(conv.id);

  // Everything on screen counts as read — locally and for the other side.
  markRead(conv.id);
  markConversationRead(conv.id);
  conv.unread = 0;
  refreshUnreadBadges();
  renderConversations();
  subscribeToMessages();
  subscribeReceipts(conv.id);
}

// Fire and forget: the banner appears if there's any anniversary data, stays
// silent otherwise. Never blocks the chat from opening.
async function renderMemoriesBanner(convId) {
  if (isMemoryDismissed(convId)) return;
  let groups = [];
  try {
    groups = await getMemories(convId, state.currentUser.id);
  } catch {
    return; // never let a memories query break a chat open
  }
  if (!groups.length) return;
  // Guard against a race: the user opened another chat while we were querying.
  if (convId !== state.currentConversationId) return;

  const banner = el("div", { class: "memories-banner" }, [
    el("button", {
      class: "memories-close",
      type: "button",
      "aria-label": "Hide these memories for today",
      onClick: () => {
        dismissMemory(convId);
        banner.remove();
      },
    }, [icon("close", 14)]),
    el("div", { class: "memories-head" }, [
      icon("sparkle", 15),
      el("span", { class: "memories-title", text: "On this day" }),
    ]),
    ...groups.map((g) =>
      el("div", { class: "memory-group" }, [
        el("div", { class: "memory-when", text: g.label + (g.count > g.samples.length ? ` · ${g.count} messages` : "") }),
        ...g.samples.map((s) =>
          el("div", { class: `memory-line${s.mine ? " mine" : ""}` }, [
            el("span", { class: "memory-who", text: s.mine ? "You" : (s.username || "?") + ":" }),
            el("span", { class: "memory-text", text: " " + (s.text || "…") }),
          ])
        ),
      ])
    ),
  ]);
  messagesList.insertBefore(banner, messagesList.firstChild);
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
    .ilike("username", username)
    .limit(2);

  if (lookupError) {
    showToast("Could not look up that user.");
    return;
  }
  if (!targetProfiles || targetProfiles.length === 0) {
    showToast(`Username "${username}" not found.`);
    return;
  }
  // Usernames are meant to be unique (see supabase-phase7.sql); more than one
  // match means that migration hasn't run yet on a database with existing
  // duplicates. Refuse to guess which account is meant rather than silently
  // messaging the wrong person.
  if (targetProfiles.length > 1) {
    showToast(`Multiple accounts match "${username}" — ask them for their exact username, or run supabase-phase7.sql.`);
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
    const byUsername = new Map();
    (data || []).forEach((p) => byUsername.set(p.username, [...(byUsername.get(p.username) || []), p]));

    // Usernames are meant to be unique (see supabase-phase7.sql); a username
    // resolving to more than one account means that migration hasn't run yet
    // on a database with existing duplicates. Skip it rather than guessing
    // which account should be added to the group.
    const ambiguous = [...byUsername.entries()].filter(([, ps]) => ps.length > 1).map(([u]) => u);
    ambiguous.forEach((u) => byUsername.delete(u));
    foundProfiles = [...byUsername.values()].map((ps) => ps[0]);

    const missing = usernames.filter((u) => !byUsername.has(u));
    if (missing.length) showToast(`Not found: ${missing.join(", ")}`, "");
    if (ambiguous.length) showToast(`Skipped (multiple accounts match): ${ambiguous.join(", ")}`, "");
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

  // iMessage-style grouping: consecutive messages from the same sender within
  // GROUP_GAP_MS collapse into a run — only the first shows author/timestamp,
  // and the last gets the bubble tail (via CSS). Appended messages compare
  // against the current tail; prepended ones we leave alone (older history
  // loading in bulk).
  const GROUP_GAP_MS = 5 * 60 * 1000;
  let grouped = false;
  if (!prepend) {
    const prev = messagesList.querySelector(".message:last-child");
    if (prev) {
      const prevId = prev.id.replace(/^msg-/, "");
      const prevMsg = msgCache.get(prevId);
      if (
        prevMsg &&
        prevMsg.user_id === msg.user_id &&
        Math.abs(new Date(msg.created_at) - new Date(prevMsg.created_at)) < GROUP_GAP_MS
      ) {
        grouped = true;
        // The previous message was the tail of a run — it stops being the tail
        // now that another message joins the run. CSS uses .grouped-end for the
        // tail; drop it here and re-add below on the new message.
        prev.classList.remove("grouped-end");
        prev.classList.add("grouped-mid");
      }
    }
  }

  const messageEl = el("div", {
    class: `message${isMine ? " my-message" : ""}${msg._pending ? " pending" : ""}${grouped ? " grouped-mid grouped-end" : " grouped-end"}`,
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
    // A sticker arrives as a marker in the text; swap it for the artwork.
    const showText = (plaintext) => {
      msg._plain = plaintext;
      const found = parseSticker(plaintext);
      const place = found ? null : parseLocation(plaintext);
      const callLog = found || place ? null : parseCall(plaintext);
      if (callLog) {
        textEl.innerHTML = "";
        const failed = callLog.status !== "completed";
        textEl.append(
          el("div", { class: `call-log${failed ? " missed" : ""}` }, [
            el("span", { class: "call-log-icon" }, [icon(callLog.kind === "video" ? "video" : "phone", 18)]),
            el("span", { text: describeCall(plaintext) }),
          ])
        );
      } else if (found) {
        textEl.innerHTML = "";
        textEl.append(found.kind === "vector" ? stickerSvg(found.sticker, 132) : stickerImg(found.path, 132));
        messageEl.classList.add("sticker-message");
      } else if (place) {
        textEl.innerHTML = "";
        textEl.append(locationCard(place));
      } else {
        textEl.textContent = plaintext;
      }
    };
    if (msg.iv) messagePlaintext(msg).then(showText);
    else showText(msg.content);
  }

  // An encrypted attachment can't be handed straight to <img src>: the bytes
  // have to come back, be decrypted, and become a blob URL first. Which kind
  // of thing it is (photo or document) is itself inside the ciphertext, so
  // even the choice of how to render it has to wait for the decrypt.
  if (!msg._localPreview && !msg._localFileMeta && isEncryptedAttachment(msg.file_url)) {
    const frame = el("div", { class: "image-frame loading" });
    messageEl.append(frame);
    getConversationKey(msg.conversation_id)
      .then((key) => loadEncrypted(msg.file_url, key))
      .then((entry) => {
        frame.classList.remove("loading");
        if (!entry) {
          // A locked chat, a tampered blob, or a failed fetch. Say so rather
          // than leaving a broken image icon with no explanation.
          frame.replaceWith(
            el("div", { class: "file-bubble" }, [
              el("span", { class: "file-bubble-icon" }, [icon("lock", 22)]),
              el("div", { class: "file-bubble-meta" }, [
                el("div", { class: "file-bubble-name", text: "Attachment locked" }),
                el("div", { class: "file-bubble-size", text: "Unlock this chat to open it" }),
              ]),
            ])
          );
          return;
        }
        if (isImageEntry(entry)) {
          frame.append(el("img", { class: "chat-image", src: entry.objectUrl, alt: "Shared image", decoding: "async" }));
        } else {
          frame.replaceWith(renderFileBubble({ url: entry.objectUrl, name: entry.name, size: entry.size }));
        }
      });
  } else {

  const fileMeta = msg._localFileMeta || parseFileMeta(msg.file_url);
  if (fileMeta) {
    messageEl.append(renderFileBubble(fileMeta));
  } else {
    const imageUrl = msg._localPreview || safeImageUrl(msg.file_url);
    if (imageUrl) {
      // Shimmering frame holds the space until the bytes land, so a slow
      // connection can't shove the rest of the conversation around.
      const frame = el("div", { class: "image-frame loading" });
      const img = el("img", {
        class: "chat-image",
        src: imageUrl,
        alt: "Shared image",
        loading: "lazy",
        decoding: "async",
      });
      const reveal = () => frame.classList.remove("loading");
      img.addEventListener("load", reveal);
      img.addEventListener("error", reveal);
      if (img.complete) reveal();
      // Never let a placeholder outlive the thing it stands in for.
      setTimeout(reveal, 10000);
      frame.append(img);
      messageEl.append(frame);
    }
  }
  }

  const time = formatTime(msg.created_at);
  const footer = el("div", { class: "message-footer" }, [
    el("span", { class: "msg-flags", "aria-hidden": "true" }),
    el("span", { class: "message-time", text: msg._pending ? "Sending…" : time }),
  ]);
  if (msg.edited_at) footer.append(el("span", { class: "edited-tag", text: "edited" }));
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
  if (isSnoozed(msg.id)) messageEl.classList.add("snoozed");

  // Track the other side's latest message — it's what proves a 1:1 "Seen".
  if (!isMine && msg.created_at && (!lastOtherMessageAt || msg.created_at > lastOtherMessageAt)) {
    lastOtherMessageAt = msg.created_at;
  }
  if (isMine) refreshMessageStates();
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

function openReactionPicker(msgId, anchorEl) {
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
  placePopup(pickerEl, anchorEl, "above");
}

// ---- Delivery state, shown by the bubble itself ----
// Instead of tick glyphs the bubble is dimmed while a message is in flight,
// stays slightly muted once it's on the server, and lifts to full brightness
// with a soft glow when the other side has seen it.
const STATE_LABEL = { sending: "Sending…", failed: "Not sent", sent: "Sent", seen: "Seen" };

function messageState(msg) {
  if (msg._pending) return "sending";
  if (msg._failed) return "failed";
  if (isReadByAll(msg.conversation_id, msg, currentMemberIds)) return "seen";
  // In a 1:1 chat, a reply that arrived after our message proves it was seen —
  // this keeps "Seen" working even if the other device never wrote a marker.
  // Not applied to groups, where one person replying says nothing about the rest.
  if (
    state.currentConversation?.type === "direct" &&
    lastOtherMessageAt &&
    Date.parse(lastOtherMessageAt) > Date.parse(msg.created_at)
  ) {
    return "seen";
  }
  return "sent";
}

function applyMessageState(msg) {
  const row = document.getElementById(`msg-${msg.id}`);
  if (!row) return;
  const st = messageState(msg);
  row.dataset.state = st;
  row.setAttribute("aria-label", STATE_LABEL[st]);
}

// Recompute every own message, and label only the newest one (like the
// "Delivered / Read" line under the last message in other messengers).
function refreshMessageStates() {
  const mine = [...msgCache.values()].filter((m) => m.user_id === state.currentUser?.id);
  mine.forEach(applyMessageState);
  document.querySelectorAll(".msg-status").forEach((n) => n.remove());

  const newest = mine
    .filter((m) => !m._pending)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .pop();
  if (!newest) return;
  const row = document.getElementById(`msg-${newest.id}`);
  const footer = row?.querySelector(".message-footer");
  if (footer) footer.append(el("span", { class: "msg-status", text: STATE_LABEL[messageState(newest)] }));
}

// ---- Per-message actions (star / pin / edit / delete) ----
let msgActionsEl = null;

// ---- Snooze picker ----
// Reuses the same visual language as the message-actions menu, so it feels
// like a natural second step from tapping "Snooze".
let snoozePickerEl = null;

function closeSnoozePicker() {
  snoozePickerEl?.remove();
  snoozePickerEl = null;
}

async function openSnoozePicker(msg, anchor) {
  closeSnoozePicker();
  const sample = msg._plain || (msg.file_url ? "📎 Attachment" : "");
  snoozePickerEl = el("div", { class: "msg-actions", role: "menu" });
  presetOptions().forEach(({ label, at }) => {
    snoozePickerEl.append(
      el("button", {
        class: "chat-menu-item",
        type: "button",
        role: "menuitem",
        onClick: (e) => {
          e.stopPropagation();
          closeSnoozePicker();
          snoozeMessage({
            msgId: msg.id,
            convId: msg.conversation_id,
            msgCreatedAt: msg.created_at,
            wakeAt: at,
            sample,
            from: msg.username || "someone",
          });
          // The .snoozed style is only added at render time, so an already-
          // rendered row needs to be updated in place — otherwise the clock
          // badge doesn't appear until you scroll away and back.
          document.getElementById(`msg-${msg.id}`)?.classList.add("snoozed");
          showToast(`Snoozed — I'll nudge you ${humanWhen(at)}.`, "success");
          renderConversations();
        },
      }, [icon("clock", 16), label])
    );
  });
  document.body.append(snoozePickerEl);
  placePopup(snoozePickerEl, anchor.closest(".message") || anchor, "below");
}

function closeMsgActions() {
  msgActionsEl?.remove();
  msgActionsEl = null;
}

function openMsgActions(msg, anchor) {
  closeMsgActions();
  const isMine = msg.user_id === state.currentUser.id;
  const convId = state.currentConversationId;

  const items = [
    { ico: "smile", label: "React", act: () => openReactionPicker(msg.id, anchor.closest(".message") || anchor) },
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
  items.push({ ico: "send", label: "Forward", act: () => openForwardModal(msg) });
  items.push({
    ico: "clock",
    label: isSnoozed(msg.id) ? "Cancel snooze" : "Snooze",
    act: () => (isSnoozed(msg.id) ? (cancelSnooze(msg.id), showToast("Snooze cancelled.", "success"), renderConversations()) : openSnoozePicker(msg, anchor)),
  });
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
  placePopup(msgActionsEl, anchor.closest(".message") || anchor, "below");
}

// Place a floating popup against a message bubble.
//
// It aligns to the bubble's edge (right for your messages, left for theirs) so
// popups always appear in the same place relative to what you clicked, and
// flips above/below depending on the room available. left/top are pinned before
// measuring: while they're `auto` the popup is laid out by the body's flex
// rules, which reports a misleading size.
const POPUP_PAD = 8;

function placePopup(node, anchorEl, prefer = "below") {
  node.style.left = "0px";
  node.style.top = "0px";

  const r = anchorEl.getBoundingClientRect();
  const w = node.offsetWidth || 240;
  const h = node.offsetHeight || 150;
  const vw = window.innerWidth || document.documentElement.clientWidth || 0;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  const maxLeft = Math.max(POPUP_PAD, vw - w - POPUP_PAD);
  const maxTop = Math.max(POPUP_PAD, vh - h - POPUP_PAD);

  // Hug the side of the bubble the message is aligned to.
  const mine = anchorEl.classList.contains("my-message");
  let left = mine ? r.right - w : r.left;
  left = Math.min(Math.max(POPUP_PAD, left), maxLeft);

  // Flip to whichever side actually has room.
  const above = r.top - h - 6;
  const below = r.bottom + 6;
  let top = prefer === "above" ? above : below;
  if (prefer === "above" && above < POPUP_PAD) top = below;
  if (prefer !== "above" && below > maxTop) top = above;
  top = Math.min(Math.max(POPUP_PAD, top), maxTop);

  node.style.left = `${Math.round(Number.isFinite(left) ? left : POPUP_PAD)}px`;
  node.style.top = `${Math.round(Number.isFinite(top) ? top : POPUP_PAD)}px`;
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

// ---- Forwarding ----
// The text is re-encrypted with the destination chat's own key — a message can
// never be readable in a conversation it wasn't encrypted for.
async function forwardMessage(msg, targetConvId) {
  const plain = msg.file_url && !msg.content ? "" : await messagePlaintext(msg);

  let content = plain;
  let iv = null;
  if (plain) {
    const key = await getConversationKey(targetConvId);
    if (key) {
      const enc = await window.PanaloCrypto.encryptMessage(plain, key);
      content = enc.ciphertext;
      iv = enc.iv;
    }
  }

  const { error } = await supabaseClient.from("messages").insert([
    {
      content: content || null,
      iv,
      username: state.currentUsername,
      user_id: state.currentUser.id,
      conversation_id: targetConvId,
      file_url: msg.file_url || null,
    },
  ]);
  if (error) {
    showToast("Could not forward that message.");
    return false;
  }
  return true;
}

function openForwardModal(msg) {
  const modal = document.getElementById("forward-modal");
  const list = document.getElementById("forward-list");
  list.innerHTML = "";

  const targets = allConversations.filter((c) => c.id !== msg.conversation_id);
  if (!targets.length) {
    list.append(el("div", { class: "list-empty", text: "No other chats to forward to yet." }));
  }

  targets.forEach((conv) => {
    const title = displayTitle(conv);
    const avatar = el("div", { class: "avatar" });
    avatar.style.width = "34px";
    avatar.style.height = "34px";
    avatar.style.fontSize = "13px";
    setAvatar(avatar, conv.type === "group" ? conv.name : conv.displayTitle || conv.name, conv.type === "group" ? null : conv.otherAvatar);

    const row = el("div", { class: "member-row", role: "button", tabindex: "0" }, [
      el("div", { class: "member-id" }, [avatar, el("span", { text: title })]),
      el("button", { class: "mini-btn", type: "button", text: "Send" }),
    ]);
    const doForward = async () => {
      row.style.opacity = "0.5";
      const ok = await forwardMessage(msg, conv.id);
      modal.classList.add("hidden");
      if (ok) showToast(`Forwarded to ${title}`, "success");
      row.style.opacity = "";
    };
    row.addEventListener("click", doForward);
    list.append(row);
  });

  modal.classList.remove("hidden");
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
  // Grab the attachment URL before the row goes, or there is nothing left to
  // find the file by.
  const fileUrl = msgCache.get(msgId)?.file_url || null;

  const { error } = await supabaseClient.from("messages").delete().eq("id", msgId);
  if (error) {
    showToast("Could not delete the message.");
    return;
  }

  // Free the file too. Deleting a message used to leave its photo in the
  // bucket forever, still served to anyone holding the URL -- so "delete"
  // removed the message without deleting the thing people most wanted gone.
  // Best-effort and deliberately not awaited into the result: the message IS
  // deleted, and an orphaned file is a smaller problem than a message that
  // appears to survive deletion.
  if (fileUrl) deleteAttachment(fileUrl);
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
  forgetDraft(convId); // the message is on its way; don't restore the same text next open
  refreshSendReady();
  fileInput.value = "";
  filePreview.classList.add("hidden");
  filePreview.innerHTML = "";
  cancelReply();

  sendMessage(content, file, convId, replyToId);
}

// A tiny "the input has content" hint on the composer — the send button
// wakes up (rotates + brightens) and the sidebar entry gets a "draft: …"
// preview even before the send actually happens.
function refreshSendReady() {
  const hasText = messageInput.value.trim().length > 0;
  document.getElementById("send-btn")?.classList.toggle("ready", hasText);
  messageForm.classList.toggle("has-text", hasText);
}

async function sendMessage(content, file, convId, replyToId = null, clientId = null) {
  // Stable across retries of the same logical send (see retry() below), so a
  // response lost to a network error — even though the insert actually
  // committed — can be recognized as "already sent" instead of duplicated.
  const cid = clientId || crypto.randomUUID();
  const tempId = "temp-" + cid;
  const isImage = file && file.type.startsWith("image/");
  const localPreview = isImage ? URL.createObjectURL(file) : null;
  const retry = () => sendMessage(content, file, convId, replyToId, cid);

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
      // Photos still get downscaled first: compressing after encryption is
      // impossible, and shipping a 12 MP original costs the recipient just as
      // much whether or not it's encrypted.
      const toUpload = file.type.startsWith("image/") ? await compressImage(file) : file;
      const attachmentKey = await getConversationKey(convId);

      if (attachmentKey) {
        try {
          fileUrl = await uploadEncrypted(toUpload, attachmentKey);
          primeAttachmentCache(fileUrl, toUpload);
        } catch {
          return markSendFailed(tempId, "Upload failed", retry);
        }
      } else {
        // No conversation key, so the message text beside this file is going
        // out in the clear too. Encrypting only the attachment would look
        // like protection without being any.
        let path;
        if (toUpload.type.startsWith("image/")) {
          const ext = (toUpload.name.split(".").pop() || "img").toLowerCase();
          path = `${Date.now()}_${crypto.randomUUID()}.${ext}`;
        } else {
          const safeName = (file.name || "file").replace(/[^\w.\- ]+/g, "_").slice(-80);
          path = `files/${Date.now()}_${crypto.randomUUID()}_s${file.size}__${safeName}`;
        }
        const { error: uploadError } = await supabaseClient.storage
          .from("chat-files")
          .upload(path, toUpload, { contentType: toUpload.type || undefined });
        if (uploadError) return markSendFailed(tempId, "Upload failed", retry);
        fileUrl = supabaseClient.storage.from("chat-files").getPublicUrl(path).data.publicUrl;
      }
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
      client_id: cid,
    };
    // Only send reply_to when there's a reply, so plain messages still work on
    // a database where supabase-phase6.sql hasn't been run yet.
    if (replyToId) row.reply_to = replyToId;

    let { data: inserted, error: insertError } = await supabaseClient.from("messages").insert([row]).select().single();

    // Replying before the column exists: send it as a normal message instead of
    // losing what was typed.
    if (insertError && replyToId && /reply_to/i.test(insertError.message)) {
      delete row.reply_to;
      ({ data: inserted, error: insertError } = await supabaseClient.from("messages").insert([row]).select().single());
      if (!insertError) showToast("Sent — run supabase-phase6.sql to enable replies.", "");
    }

    if (insertError && /client_id/i.test(insertError.message)) {
      if (/duplicate|unique/i.test(insertError.message)) {
        // This exact send already went through on an earlier attempt whose
        // response we never saw — fetch the real row instead of resending.
        const { data: existing } = await supabaseClient.from("messages").select("*").eq("client_id", cid).maybeSingle();
        if (existing) {
          inserted = existing;
          insertError = null;
        }
      } else {
        // Column doesn't exist yet — send without duplicate-retry protection
        // rather than losing what was typed.
        delete row.client_id;
        ({ data: inserted, error: insertError } = await supabaseClient.from("messages").insert([row]).select().single());
      }
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
  tempEl.dataset.state = "failed";
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
  if (state.realtimeChannel) {
    forgetChannel(state.realtimeChannel.topic);
    supabaseClient.removeChannel(state.realtimeChannel);
  }
  otherTyping = false;

  const channelName = `room:${state.currentConversationId}`;
  state.realtimeChannel = supabaseClient
    .channel(channelName, { config: { broadcast: { self: false } } })
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
        // Decide BEFORE rendering: appending the row changes scrollHeight, so
        // measuring afterwards always reports "not at the bottom".
        const wasAtBottom = isNearBottom();
        renderMessage(payload.new);
        // Only follow the conversation down if the reader was already at the
        // live end. Someone scrolled up reading history should stay there.
        if (wasAtBottom || payload.new.user_id === state.currentUser.id) scrollToBottom();
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
    .subscribe((status) => reportChannelStatus(channelName, status));
}

// Reconcile the open conversation with the server.
//
// Realtime events that arrived while the socket was down are gone for good —
// they are not replayed. The only way back to a correct view is to ask for
// anything newer than what we already have. renderMessage() is idempotent on
// message id, so re-rendering something already on screen is a no-op and
// there's no need to diff.
async function resyncOpenConversation() {
  const convId = state.currentConversationId;
  if (!convId) return;

  // Newest message we actually hold for this chat. Optimistic rows are
  // excluded: their created_at is a local clock reading, which can run ahead
  // of the server and would make us skip real messages.
  // Compare parsed instants, not raw strings: Postgres renders "+00:00"
  // while other paths produce "Z", and those two don't sort together.
  let since = null;
  let sinceMs = -Infinity;
  for (const m of msgCache.values()) {
    if (m.conversation_id !== convId || m._pending || !m.created_at) continue;
    const ms = Date.parse(m.created_at);
    if (Number.isFinite(ms) && ms > sinceMs) {
      sinceMs = ms;
      since = m.created_at;
    }
  }

  let query = supabaseClient.from("messages").select("*").eq("conversation_id", convId);
  // An empty chat has no floor to page from, so bound it by page size
  // instead of pulling the whole history.
  query = since
    ? query.gt("created_at", since).order("created_at", { ascending: true })
    : query.order("created_at", { ascending: false }).limit(MESSAGES_PAGE_SIZE);

  const { data, error } = await query;
  if (error || !data || !data.length) return;

  const ordered = since ? data : data.slice().reverse();
  const missing = ordered.filter((m) => !document.getElementById(`msg-${m.id}`));
  if (!missing.length) return;

  const wasAtBottom = isNearBottom();
  await loadReactions(missing.map((m) => m.id), { replace: false });
  missing.forEach((msg) => renderMessage(msg));
  if (wasAtBottom) scrollToBottom();

  // Recovered messages count as delivered to us; keep the ticks honest.
  if (!document.hidden) markConversationRead(convId);
}

// Whether the reader is parked at the live end of the thread. Anything else
// means they scrolled up deliberately, and yanking them back down is the
// rudest thing a chat app can do.
const NEAR_BOTTOM_PX = 120;
function isNearBottom() {
  const c = document.getElementById("messages-container");
  if (!c) return true;
  return c.scrollHeight - c.scrollTop - c.clientHeight < NEAR_BOTTOM_PX;
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
  const grad = `linear-gradient(135deg, ${preset.primary}, color-mix(in srgb, ${preset.primary} 55%, white))`;
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
  if (!state.currentConversation) return;

  state.currentConversation.theme = themeId;
  // Persist for both members. .select() so an RLS-filtered (silent) no-op is
  // detectable instead of the theme quietly staying local-only.
  const { data, error } = await supabaseClient
    .from("conversations")
    .update({ theme: themeId })
    .eq("id", state.currentConversation.id)
    .select("id");
  if (error || !data || !data.length) {
    showToast("Couldn't sync the theme — the other person won't see it yet.");
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
  const lockLabel = menu.querySelector('[data-action="lock"] .menu-label');
  const hideLabel = menu.querySelector('[data-action="hide"] .menu-label');
  if (conv) {
    muteLabel.textContent = isMuted(conv.id) ? "Unmute notifications" : "Mute notifications";
    pinLabel.textContent = isPinned(conv.id) ? "Unpin chat" : "Pin chat";
    lockLabel.textContent = isChatLocked(conv.id) ? "Unlock chat" : "Lock chat";
    hideLabel.textContent = isChatHidden(conv.id) ? "Unhide chat" : "Hide chat";
  }
  menu.classList.remove("hidden");
}

// ---- Custom sidebar folders ----
const FOLDER_ICON_CHOICES = ["star", "users", "user", "chat", "sparkle", "pin", "smile", "image", "sound", "file", "palette", "check"];
let pendingFolderIcon = "star";

// Render a folder's icon: either one of our vectors or an uploaded picture.
function folderIconNode(iconValue, size = 20) {
  if (typeof iconValue === "string" && iconValue.startsWith("img:")) {
    const img = el("img", { src: iconValue.slice(4), alt: "", class: "folder-img" });
    img.style.width = `${size}px`;
    img.style.height = `${size}px`;
    return img;
  }
  return icon(iconValue || "star", size);
}

// Folder buttons sit in the rail under the built-in views.
function renderRailFolders() {
  const rail = document.querySelector(".nav-rail");
  const spacer = rail.querySelector(".rail-spacer");
  rail.querySelectorAll(".rail-folder").forEach((n) => n.remove());

  getFolders().forEach((folder) => {
    const btn = el("button", {
      class: `rail-btn rail-folder${chatFilter === `folder:${folder.id}` ? " active" : ""}`,
      type: "button",
      title: folder.name,
      "aria-label": `${folder.name} folder`,
      onClick: () => selectView(`folder:${folder.id}`, btn),
    });
    btn.dataset.view = `folder:${folder.id}`;
    btn.append(folderIconNode(folder.icon, 20));
    rail.insertBefore(btn, spacer);
  });
}

function selectView(view, btn) {
  chatFilter = view;
  document.querySelectorAll(".rail-btn[data-view]").forEach((b) => b.classList.toggle("active", b === btn));
  renderConversations();
}

// Shrink an uploaded picture right down — a rail icon is only ~20px.
async function iconDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const side = Math.min(bitmap.width, bitmap.height);
  canvas
    .getContext("2d")
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close?.();
  return canvas.toDataURL("image/png");
}

function renderFolderModal() {
  const list = document.getElementById("folder-list");
  list.innerHTML = "";
  const folders = getFolders();
  if (!folders.length) {
    list.append(el("div", { class: "list-empty", text: "No folders yet — make one below." }));
  }
  folders.forEach((folder) => {
    list.append(
      el("div", { class: "member-row" }, [
        el("div", { class: "member-id" }, [
          el("span", { class: "folder-chip-icon" }, [folderIconNode(folder.icon, 18)]),
          el("span", { text: `${folder.name} · ${folder.convIds.length} chat${folder.convIds.length === 1 ? "" : "s"}` }),
        ]),
        el("button", {
          class: "member-remove",
          type: "button",
          text: "Delete",
          onClick: () => {
            deleteFolder(folder.id);
            if (chatFilter === `folder:${folder.id}`) {
              chatFilter = "all";
              document.querySelectorAll(".rail-btn[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === "all"));
            }
            renderFolderModal();
            renderRailFolders();
            renderConversations();
          },
        }),
      ])
    );
  });

  // Icon choices
  const grid = document.getElementById("folder-icon-grid");
  grid.innerHTML = "";
  FOLDER_ICON_CHOICES.forEach((name) => {
    const b = el("button", {
      class: `folder-icon-choice${pendingFolderIcon === name ? " selected" : ""}`,
      type: "button",
      "aria-label": name,
      onClick: () => {
        pendingFolderIcon = name;
        renderFolderModal();
      },
    }, [icon(name, 18)]);
    grid.append(b);
  });
  if (typeof pendingFolderIcon === "string" && pendingFolderIcon.startsWith("img:")) {
    grid.append(el("span", { class: "folder-icon-choice selected" }, [folderIconNode(pendingFolderIcon, 18)]));
  }
}

function openFolderModal() {
  renderFolderModal();
  document.getElementById("folder-modal").classList.remove("hidden");
}

// ---- Focus mode (distraction-free: no rail, no list, no ambient) ----
export function setFocusMode(on) {
  document.body.classList.toggle("focus-mode", on);
  if (!on) document.body.classList.remove("panel-out");
}

// ---- Wire up all chat-related event listeners ----
export function initChatUI() {
  // Single delegated listener for all click ripples across the app.
  attachRipples();

  // Whenever the connection layer decides we may have fallen behind (socket
  // resubscribed, network returned, tab came back to the foreground), pull
  // whatever we missed. Both halves matter: the open thread so the reader
  // sees new messages, and the sidebar so previews, ordering and unread
  // counts stop showing a stale world.
  onResync(async () => {
    if (!state.currentUser) return;
    await resyncOpenConversation();
    await fetchConversations();
  });

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

  // Compose "+" — one entry point for attach / sticker / location so the
  // composer row has room for the actual text input on narrow screens.
  const composeAdd = document.getElementById("compose-add");
  const composeMenu = document.getElementById("compose-menu");
  composeAdd.addEventListener("click", (e) => {
    e.stopPropagation();
    composeMenu.classList.toggle("hidden");
  });
  composeMenu.addEventListener("click", (e) => {
    // Any menu-item click closes the menu; the item's own handler still runs.
    if (e.target.closest(".compose-menu-item")) composeMenu.classList.add("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#compose-add, #compose-menu")) composeMenu.classList.add("hidden");
  });

  // Paste a screenshot straight into the chat. The clipboard hands us a File
  // with no useful name, so it gets one, then it goes through the very same
  // attach → preview → send path as a picked file.
  document.addEventListener("paste", (e) => {
    if (!state.currentConversationId) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (!item) return;
    const blob = item.getAsFile();
    if (!blob) return;
    e.preventDefault();

    const ext = (blob.type.split("/")[1] || "png").split("+")[0];
    const named = new File([blob], `pasted-${Date.now()}.${ext}`, { type: blob.type });
    const dt = new DataTransfer();
    dt.items.add(named);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event("change"));
    showToast("Image pasted — press Send.", "success");
  });
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
    haptic(6);
    handleSend();
  });

  // Calls (direct chats only).
  initCalls();
  // A finished call writes itself into the conversation as a normal message.
  setCallLogger((convId, marker) => sendMessage(marker, null, convId));
  const callPeer = () => ({
    id: state.currentConversation?.otherUserId,
    name: displayTitle(state.currentConversation || {}),
    avatar: state.currentConversation?.otherAvatar,
    conversationId: state.currentConversation?.id,
  });
  document.getElementById("voice-call-btn").addEventListener("click", () => startCall(callPeer(), false));
  document.getElementById("video-call-btn").addEventListener("click", () => startCall(callPeer(), true));

  // Location sharing (coordinates are encrypted like any other message).
  initLocation();
  const locationBtn = document.getElementById("location-btn");
  locationBtn.addEventListener("click", () =>
    withBusy(locationBtn, "…", async () => {
      if (!state.currentConversationId) {
        showToast("Open a chat first.");
        return;
      }
      const pos = await getCurrentPosition();
      if (!pos) return;
      sendMessage(locationMarker(pos.lat, pos.lng), null, state.currentConversationId);
      scrollToBottom();
    })
  );

  // Stickers: one tap sends the card as an (encrypted) marker message.
  initStickerPicker((marker) => {
    if (!state.currentConversationId) {
      showToast("Open a chat first.");
      return;
    }
    sendMessage(marker, null, state.currentConversationId);
    scrollToBottom();
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
    swatch.style.background = `linear-gradient(135deg, ${preset.primary}, color-mix(in srgb, ${preset.primary} 55%, white))`;
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
  // Also: persist the draft per-chat so switching chats doesn't lose it, and
  // flip the "send button ready" state as the input goes empty ↔ non-empty.
  messageInput.addEventListener("input", () => {
    refreshSendReady();
    if (state.currentConversationId) setDraft(state.currentConversationId, messageInput.value);
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
  setReceiptListener(refreshMessageStates);
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

    // Tiny bell jiggle on incoming messages from someone else — makes the
    // header react so you notice, without stealing focus. Class removes
    // itself so the animation can play again next time.
    if (msg.user_id !== state.currentUser?.id) {
      const bells = document.querySelectorAll('[data-icon="bell"], [data-icon="bellOff"]');
      bells.forEach((b) => {
        b.classList.remove("bell-jiggle");
        void b.offsetWidth;
        b.classList.add("bell-jiggle");
        setTimeout(() => b.classList.remove("bell-jiggle"), 700);
      });
    }
  });

  // Clicking an alert banner (or a desktop notification) jumps to that chat.
  const jumpToChat = (convId) => {
    const conv = allConversations.find((c) => c.id === convId);
    if (conv) openConversation(conv);
  };
  setOpenChatListener(jumpToChat);
  // Same journey, but arriving from a service-worker notification click.
  document.addEventListener("panalo:open-chat", (e) => jumpToChat(e.detail.conversationId));
  // Revealing or re-hiding chats redraws the list.
  document.addEventListener("panalo:refresh-chats", renderConversations);

  // Snooze: when a scheduled reminder fires, refresh the badges + list so the
  // now-unread chat bumps to the top. The banner + sound come from snooze.js.
  setSnoozeFireHandler(async (entry) => {
    const conv = allConversations.find((c) => c.id === entry.convId);
    if (conv) {
      // Re-hydrate this chat's meta so unread count reflects the rollback.
      const { data } = await supabaseClient
        .from("messages")
        .select("id, conversation_id, user_id, username, content, iv, file_url, created_at")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: false })
        .limit(META_SCAN_LIMIT);
      conv.lastMessage = (data || [])[0] || null;
      conv.lastAt = conv.lastMessage?.created_at || conv.lastAt;
      conv.unread = countUnread(conv.id, data || []);
      refreshUnreadBadges();
      renderConversations();
    }
  });
  startSnoozes(); // catch up on anything already overdue and schedule the rest

  // The hidden-chats gesture: ⌘/Ctrl+Shift+H, or a two-finger tap on a phone.
  initHiddenShortcut((visible) => {
    renderConversations();
    if (visible) showToast(`${hiddenCount()} hidden chat(s) shown.`, "success");
    else showToast("Hidden chats tucked away.", "");
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
    btn.addEventListener("click", () => selectView(btn.dataset.view, btn));
  });
  renderRailFolders();

  // Folder management (create with a preset vector icon or your own picture).
  document.getElementById("choose-folder").addEventListener("click", () => {
    newChatModal.classList.add("hidden");
    openFolderModal();
  });
  document.getElementById("close-folder-modal").addEventListener("click", () => {
    document.getElementById("folder-modal").classList.add("hidden");
  });
  const folderIconInput = document.getElementById("folder-icon-input");
  document.getElementById("folder-upload-btn").addEventListener("click", () => folderIconInput.click());
  folderIconInput.addEventListener("change", async () => {
    const file = folderIconInput.files[0];
    folderIconInput.value = "";
    if (!file) return;
    try {
      pendingFolderIcon = `img:${await iconDataUrl(file)}`;
      renderFolderModal();
    } catch {
      showToast("Could not use that image.");
    }
  });
  document.getElementById("create-folder-btn").addEventListener("click", () => {
    const input = document.getElementById("folder-name-input");
    const name = input.value.trim();
    if (!name) {
      showToast("Give the folder a name first.");
      return;
    }
    addFolder(name, pendingFolderIcon);
    input.value = "";
    pendingFolderIcon = "star";
    renderFolderModal();
    renderRailFolders();
    showToast(`Folder "${name}" created`, "success");
  });

  // Forwarding.
  document.getElementById("close-forward-modal").addEventListener("click", () => {
    document.getElementById("forward-modal").classList.add("hidden");
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
    onWallpaperChanged: (convId) => {
      if (convId === state.currentConversationId) applyChatWallpaper(convId);
    },
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
    } else if (item.dataset.action === "lock" && conv) {
      // A lock is only a lock if there's a PIN behind it.
      (async () => {
        if (!hasPin("chat")) {
          const pin = window.prompt("Choose a 4–8 digit PIN for locking chats:");
          if (!pin || !(await setPin("chat", pin))) return;
        }
        const locked = toggleChatLock(conv.id);
        if (!locked) markChatUnlocked(conv.id);
        showToast(locked ? "Chat locked" : "Chat unlocked", "success");
        renderConversations();
      })();
    } else if (item.dataset.action === "hide" && conv) {
      const hidden = toggleChatHidden(conv.id);
      showToast(hidden ? "Chat hidden — reveal it in Settings" : "Chat is visible again", "success");
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
    if (!e.target.closest(".msg-actions")) closeSnoozePicker();
    if (document.body.classList.contains("panel-out") && !e.target.closest(".sidebar, .focus-controls")) {
      document.body.classList.remove("panel-out");
    }
  });
  document.getElementById("close-members-modal").addEventListener("click", () => {
    document.getElementById("members-modal").classList.add("hidden");
  });
}
