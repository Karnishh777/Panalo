// WhatsApp-style chat info drawer: nickname, group name/bio editing, member
// management (add / remove / leave, with encryption-key wrapping for new
// members), pin/mute shortcuts, and the per-chat font picker.
// Cycle-free: chat.js registers callbacks instead of being imported.
import { supabaseClient } from "./client.js";
import { state } from "./state.js";
import { el, showToast, withBusy, setAvatar } from "./util.js";
import { FONT_PRESETS } from "./config.js";
import { getNickname, setNickname, isPinned, togglePin, getChatFont, setChatFont } from "./prefs.js";
import { isMuted, toggleMute } from "./notifications.js";
import { getConversationKey } from "./encryption.js";

let cb = {}; // { onListChanged, onTitleChanged, onOpenTheme, onLeftChat }
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
  muteChip.textContent = muted ? "🔔 Unmute" : "🔕 Mute";
  muteChip.classList.toggle("on", muted);
  pinChip.textContent = pinned ? "📌 Unpin chat" : "📌 Pin chat";
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
  const { error } = await supabaseClient
    .from("conversation_participants")
    .delete()
    .eq("conversation_id", conv.id)
    .eq("user_id", state.currentUser.id);
  if (error) {
    showToast("Could not leave — run supabase-phase5.sql first.");
    return;
  }
  await supabaseClient.from("conversation_keys").delete().eq("conversation_id", conv.id).eq("user_id", state.currentUser.id);
  closeChatInfo();
  showToast("You left the group.", "success");
  cb.onLeftChat?.(conv.id);
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

  if (isGroup) {
    document.getElementById("info-group-name").value = conv.name || "";
    document.getElementById("info-group-bio").value = conv.bio || "";
    renderMembers(conv);
  } else {
    document.getElementById("info-bio-view").textContent = conv.otherBio || "No bio yet.";
  }

  refreshChips(conv);
  renderFontChips(conv);

  const encEl = document.getElementById("info-encryption");
  encEl.textContent = "…";
  getConversationKey(conv.id).then((k) => {
    encEl.textContent = k ? "🔒 Messages in this chat are encrypted" : "🔓 Older chat — messages not encrypted";
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
}
