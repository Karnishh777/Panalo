// WhatsApp-style chat info drawer: nickname, group name/bio editing, member
// management (add / remove / leave, with encryption-key wrapping for new
// members), pin/mute shortcuts, and the per-chat font picker.
// Cycle-free: chat.js registers callbacks instead of being imported.
import { supabaseClient } from "./client.js";
import { state } from "./state.js";
import { el, showToast, withBusy, setAvatar } from "./util.js";
import { FONT_PRESETS, WALLPAPER_PRESETS } from "./config.js";
import {
  getNickname, setNickname, isPinned, togglePin,
  getChatFont, setChatFont, getChatWallpaper, setChatWallpaper,
  getFolders, isChatInFolder, toggleChatInFolder,
  forgetChatPrefs,
} from "./prefs.js";
import { icon } from "./icons.js";
import { isMuted, toggleMute, forgetMute } from "./notifications.js";
import { getConversationKey } from "./encryption.js";
import { forgetChatLock } from "./lock.js";
import { forgetMemory } from "./memories.js";
import { forgetReadState } from "./unread.js";
import { pendingFor, cancelSnooze } from "./snooze.js";
import { conversationKeys } from "./state.js";

let cb = {}; // { onListChanged, onTitleChanged, onOpenTheme, onLeftChat, onWallpaperChanged }
export function setChatInfoCallbacks(callbacks) {
  cb = callbacks;
}

const drawer = () => document.getElementById("chat-info");

export function closeChatInfo() {
  drawer().classList.remove("open");
}

function needsPhase5(error) {
  return error && /column|bio/i.test(error.message);
}

// Displayed title: personal nickname wins, then the resolved chat title.
export function displayTitle(conv) {
  return getNickname(conv.id) || (conv.type === "group" ? conv.name : conv.displayTitle || conv.name) || "Chat";
}

function refreshChips(conv) {
  const muteChip = document.getElementById("info-mute");
  const pinChip = document.getElementById("info-pin");
  const muted = isMuted(conv.id);
  const pinned = isPinned(conv.id);
  muteChip.replaceChildren(icon(muted ? "bell" : "bellOff", 14), document.createTextNode(muted ? "Unmute" : "Mute"));
  muteChip.classList.toggle("on", muted);
  pinChip.replaceChildren(icon("pin", 14), document.createTextNode(pinned ? "Unpin chat" : "Pin chat"));
  pinChip.classList.toggle("on", pinned);
}

function renderFontChips(conv) {
  const box = document.getElementById("info-font-chips");
  box.innerHTML = "";
  const current = getChatFont(conv.id);
  FONT_PRESETS.forEach((f) => {
    const chip = el("button", {
      class: `info-chip${f.id === current ? " selected" : ""}`,
      type: "button",
      text: f.name,
      onClick: () => {
        setChatFont(conv.id, f.id);
        document.querySelector(".chat-main").style.setProperty("--chat-font", f.stack);
        box.querySelectorAll(".info-chip").forEach((c) => c.classList.toggle("selected", c === chip));
      },
    });
    chip.style.fontFamily = f.stack;
    box.append(chip);
  });
}

// Per-chat wallpaper — personal, so each conversation can look different
// without changing anything for the other person.
function renderWallpaperChips(conv) {
  const box = document.getElementById("info-wallpaper-chips");
  box.innerHTML = "";
  const current = getChatWallpaper(conv.id);
  const options = [{ id: "app", name: "Same as app" }, ...WALLPAPER_PRESETS.filter((w) => w.id !== "custom")];
  options.forEach((w) => {
    const chip = el("button", {
      class: `info-chip${w.id === current ? " selected" : ""}`,
      type: "button",
      text: w.name,
      onClick: () => {
        setChatWallpaper(conv.id, w.id);
        cb.onWallpaperChanged?.(conv.id);
        box.querySelectorAll(".info-chip").forEach((c) => c.classList.toggle("selected", c === chip));
      },
    });
    if (w.icon) chip.prepend(icon(w.icon, 13));
    box.append(chip);
  });
}

// Folder membership for this chat.
function renderFolderChips(conv) {
  const box = document.getElementById("info-folder-chips");
  box.innerHTML = "";
  const folders = getFolders();
  if (!folders.length) {
    box.append(el("span", { class: "info-bio-view", text: "No folders yet — make one from the + button." }));
    return;
  }
  folders.forEach((folder) => {
    const chip = el("button", {
      class: `info-chip${isChatInFolder(folder.id, conv.id) ? " selected" : ""}`,
      type: "button",
      text: folder.name,
      onClick: () => {
        const inFolder = toggleChatInFolder(folder.id, conv.id);
        chip.classList.toggle("selected", inFolder);
        cb.onListChanged?.();
      },
    });
    box.append(chip);
  });
}

async function renderMembers(conv) {
  const listEl = document.getElementById("info-members-list");
  listEl.innerHTML = "";
  let { data, error } = await supabaseClient
    .from("conversation_participants")
    .select("user_id, profiles(username, avatar_url)")
    .eq("conversation_id", conv.id);
  // Graceful fallback until supabase-phase5.sql adds avatar_url.
  if (error && /column/i.test(error.message)) {
    ({ data } = await supabaseClient
      .from("conversation_participants")
      .select("user_id, profiles(username)")
      .eq("conversation_id", conv.id));
  }

  const members = data || [];
  const iAmCreator = conv.created_by === state.currentUser.id;
  document.getElementById("info-sub").textContent =
    conv.type === "group" ? `Group · ${members.length} member${members.length === 1 ? "" : "s"}` : document.getElementById("info-sub").textContent;

  members.forEach((p) => {
    const isMe = p.user_id === state.currentUser.id;
    const name = isMe ? "You" : p.profiles?.username || "Unknown";
    const avatar = el("div", { class: "avatar" });
    avatar.style.width = "34px";
    avatar.style.height = "34px";
    avatar.style.fontSize = "13px";
    setAvatar(avatar, p.profiles?.username || name, p.profiles?.avatar_url);

    const row = el("div", { class: "member-row" }, [
      el("div", { class: "member-id" }, [avatar, el("span", { text: name + (p.user_id === conv.created_by ? " 👑" : "") })]),
    ]);
    // The creator can remove anyone else.
    if (iAmCreator && !isMe) {
      row.append(
        el("button", {
          class: "member-remove",
          type: "button",
          text: "Remove",
          onClick: () => removeMember(conv, p.user_id, name),
        })
      );
    }
    listEl.append(row);
  });
}

async function removeMember(conv, userId, name) {
  const { error } = await supabaseClient
    .from("conversation_participants")
    .delete()
    .eq("conversation_id", conv.id)
    .eq("user_id", userId);
  if (error) {
    showToast("Could not remove — run supabase-phase5.sql first.");
    return;
  }
  // Drop their wrapped conversation key too (best-effort).
  await supabaseClient.from("conversation_keys").delete().eq("conversation_id", conv.id).eq("user_id", userId);
  showToast(`${name} removed`, "success");
  renderMembers(conv);
}

async function addMember(conv) {
  const input = document.getElementById("add-member-input");
  const username = input.value.trim();
  if (!username) return;

  const { data: profs, error } = await supabaseClient
    .from("profiles")
    .select("id, username, public_key")
    .ilike("username", username);
  if (error || !profs || !profs.length) {
    showToast(`"${username}" not found.`);
    return;
  }
  const target = profs[0];

  const { error: insErr } = await supabaseClient
    .from("conversation_participants")
    .insert([{ conversation_id: conv.id, user_id: target.id }]);
  if (insErr) {
    if (/duplicate/i.test(insErr.message)) showToast(`${target.username} is already in the group.`);
    else showToast("Could not add — run supabase-phase5.sql first.");
    return;
  }

  // Wrap the existing conversation key for the new member so they can read
  // the chat. Skipped silently for plaintext (pre-encryption) chats.
  try {
    const key = await getConversationKey(conv.id);
    if (key && target.public_key && window.PanaloCrypto) {
      const pub = await window.PanaloCrypto.importPublicKey(target.public_key);
      const wrapped = await window.PanaloCrypto.wrapConversationKey(key, pub);
      await supabaseClient.from("conversation_keys").insert([
        { conversation_id: conv.id, user_id: target.id, wrapped_key: wrapped },
      ]);
    }
  } catch {
    /* chat stays readable for existing members either way */
  }

  input.value = "";
  showToast(`${target.username} added 🎉`, "success");
  renderMembers(conv);
}

async function leaveGroup(conv) {
  const confirmed = await confirmDelete({
    title: "Leave and delete group?",
    body: `You'll be removed from ${conv.name || "this group"}. Your copy of the messages goes with you; other members keep theirs.`,
    danger: "Leave & delete",
  });
  if (!confirmed) return;
  await removeMeAndForget(conv, "You left the group.");
}

// Delete a chat for me only. Server-side that's just leaving the conversation
// (dropping my participant row + my wrapped conversation key). Everyone else in
// the conversation still has their full copy — this matches WhatsApp's
// "delete chat" semantics, which is what users expect.
async function deleteChat(conv) {
  const isGroup = conv.type === "group";
  const label = isGroup ? (conv.name || "this group") : (conv.displayTitle || conv.name || "this chat");
  const confirmed = await confirmDelete({
    title: isGroup ? "Leave and delete group?" : "Delete chat?",
    body: isGroup
      ? `You'll be removed from ${label}. Your copy of the messages disappears; other members keep theirs.`
      : `Delete your copy of the chat with ${label}. Messages stay with them, and they can still write to you — a new message will start the chat again.`,
    danger: isGroup ? "Leave & delete" : "Delete for me",
  });
  if (!confirmed) return;
  await removeMeAndForget(conv, isGroup ? "You left the group." : "Chat deleted.");
}

// Common tail: drop the server rows I control, wipe every scrap of local state
// that referred to this chat, and hand off to chat.js to close and re-render.
async function removeMeAndForget(conv, toast) {
  const { error } = await supabaseClient
    .from("conversation_participants")
    .delete()
    .eq("conversation_id", conv.id)
    .eq("user_id", state.currentUser.id);
  if (error) {
    showToast("Could not delete — please try again.");
    return;
  }
  // Best-effort key row cleanup. Kept even if it fails: my public_key changing
  // makes an old wrapped key unopenable anyway.
  await supabaseClient.from("conversation_keys").delete().eq("conversation_id", conv.id).eq("user_id", state.currentUser.id);

  // Everything local — nicknames, pins, mute, lock/hidden, memories dismissal,
  // read pointer, snoozes, in-memory AES key. A chat with the same id that
  // came back later should feel like a fresh start.
  forgetChatPrefs(conv.id);
  forgetMute(conv.id);
  forgetChatLock(conv.id);
  forgetMemory(conv.id);
  forgetReadState(conv.id);
  pendingFor(conv.id).forEach((s) => cancelSnooze(s.msgId));
  conversationKeys.delete(conv.id);

  closeChatInfo();
  showToast(toast, "success");
  cb.onLeftChat?.(conv.id);
}

// Bespoke confirmation modal — the browser confirm() is jarring and mobile
// keyboards cover it. Returns a Promise<boolean>. Traps focus lightly and
// closes on Escape / backdrop click. The button copy is caller-supplied so
// "Delete for me" reads correctly against "Leave & delete" for groups.
function confirmDelete({ title, body, danger }) {
  return new Promise((resolve) => {
    const backdrop = el("div", { class: "modal confirm-modal", role: "dialog", "aria-modal": "true" });
    const card = el("div", { class: "modal-content confirm-content" });
    const heading = el("h3", { text: title });
    const para = el("p", { class: "confirm-body", text: body });
    const cancelBtn = el("button", {
      class: "modal-btn",
      type: "button",
      text: "Cancel",
      onClick: () => close(false),
    });
    const okBtn = el("button", {
      class: "modal-btn danger",
      type: "button",
      text: danger,
      onClick: () => close(true),
    });
    const row = el("div", { class: "modal-buttons" }, [cancelBtn, okBtn]);
    card.append(heading, para, row);
    backdrop.append(card);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(false);
    });
    const keyHandler = (e) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter" && document.activeElement !== cancelBtn) close(true);
    };
    document.addEventListener("keydown", keyHandler);
    document.body.append(backdrop);
    requestAnimationFrame(() => okBtn.focus());

    function close(result) {
      document.removeEventListener("keydown", keyHandler);
      backdrop.classList.add("closing");
      setTimeout(() => backdrop.remove(), 160);
      resolve(result);
    }
  });
}

async function saveGroupField(conv, field, value, label) {
  // .select() so an RLS-filtered (silent) no-op is detectable as 0 rows.
  const { data, error } = await supabaseClient
    .from("conversations")
    .update({ [field]: value })
    .eq("id", conv.id)
    .select("id");
  if (error || !data || !data.length) {
    showToast(error && !needsPhase5(error) ? `Could not save the ${label}.` : "Run supabase-phase5.sql to enable this.");
    return false;
  }
  conv[field] = value;
  showToast(`${label[0].toUpperCase() + label.slice(1)} saved`, "success");
  return true;
}

// Open + populate the drawer for the current conversation.
export async function openChatInfo() {
  const conv = state.currentConversation;
  if (!conv) return;
  const isGroup = conv.type === "group";

  const title = displayTitle(conv);
  document.getElementById("info-title").textContent = title;
  document.getElementById("info-sub").textContent = isGroup ? "Group chat" : `@${conv.displayTitle || conv.name || "user"}`;
  setAvatar(document.getElementById("info-avatar"), conv.type === "group" ? conv.name : conv.displayTitle || conv.name, isGroup ? null : conv.otherAvatar);

  document.getElementById("info-nickname").value = getNickname(conv.id);

  document.getElementById("info-group-section").style.display = isGroup ? "block" : "none";
  document.getElementById("info-members-section").style.display = isGroup ? "block" : "none";
  document.getElementById("info-bio-section").style.display = isGroup ? "none" : "block";

  // The unified Delete chat button says the right thing for the current chat.
  const deleteBtn = document.getElementById("delete-chat-btn");
  deleteBtn.replaceChildren(icon("trash", 15), document.createTextNode(isGroup ? "Leave and delete group" : "Delete chat"));
  // Hide the older group-only leave button now that Delete handles both cases.
  const legacyLeave = document.getElementById("leave-group-btn");
  if (legacyLeave) legacyLeave.style.display = "none";

  if (isGroup) {
    document.getElementById("info-group-name").value = conv.name || "";
    document.getElementById("info-group-bio").value = conv.bio || "";
    renderMembers(conv);
  } else {
    document.getElementById("info-bio-view").textContent = conv.otherBio || "No bio yet.";
  }

  refreshChips(conv);
  renderFontChips(conv);
  renderWallpaperChips(conv);
  renderFolderChips(conv);
  renderWallpaperChips(conv);

  const encEl = document.getElementById("info-encryption");
  encEl.textContent = "…";
  getConversationKey(conv.id).then((k) => {
    encEl.textContent = k
      ? "Messages in this chat are encrypted"
      : "Older chat — messages not encrypted";
  });

  drawer().classList.add("open");
}

export function initChatInfo() {
  document.getElementById("close-chat-info").addEventListener("click", closeChatInfo);

  document.getElementById("save-nickname").addEventListener("click", () => {
    const conv = state.currentConversation;
    if (!conv) return;
    setNickname(conv.id, document.getElementById("info-nickname").value);
    document.getElementById("info-title").textContent = displayTitle(conv);
    showToast("Nickname saved", "success");
    cb.onTitleChanged?.(conv);
    cb.onListChanged?.();
  });

  const saveNameBtn = document.getElementById("save-group-name");
  saveNameBtn.addEventListener("click", () =>
    withBusy(saveNameBtn, "…", async () => {
      const conv = state.currentConversation;
      const name = document.getElementById("info-group-name").value.trim();
      if (!conv || !name) return;
      if (await saveGroupField(conv, "name", name, "group name")) {
        document.getElementById("info-title").textContent = displayTitle(conv);
        cb.onTitleChanged?.(conv);
        cb.onListChanged?.();
      }
    })
  );

  const saveBioBtn = document.getElementById("save-group-bio");
  saveBioBtn.addEventListener("click", () =>
    withBusy(saveBioBtn, "…", async () => {
      const conv = state.currentConversation;
      if (!conv) return;
      await saveGroupField(conv, "bio", document.getElementById("info-group-bio").value.trim(), "group bio");
    })
  );

  document.getElementById("info-mute").addEventListener("click", () => {
    const conv = state.currentConversation;
    if (!conv) return;
    toggleMute(conv.id);
    refreshChips(conv);
  });

  document.getElementById("info-pin").addEventListener("click", () => {
    const conv = state.currentConversation;
    if (!conv) return;
    togglePin(conv.id);
    refreshChips(conv);
    cb.onListChanged?.();
  });

  document.getElementById("info-theme").addEventListener("click", () => cb.onOpenTheme?.());

  const addBtn = document.getElementById("add-member-btn");
  addBtn.addEventListener("click", () =>
    withBusy(addBtn, "…", () => addMember(state.currentConversation))
  );
  document.getElementById("add-member-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addBtn.click();
  });

  document.getElementById("leave-group-btn").addEventListener("click", () => leaveGroup(state.currentConversation));
  document.getElementById("delete-chat-btn").addEventListener("click", () => {
    const conv = state.currentConversation;
    if (conv) deleteChat(conv);
  });
}

// Also expose deleteChat so chat.js can call it from the conversation-list
// context menu, without re-doing all the cleanup logic there.
export function deleteConversation(conv) {
  return deleteChat(conv);
}
