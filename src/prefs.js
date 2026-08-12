// Personal, per-device preferences (localStorage): nicknames, pinned chats,
// starred messages, pinned messages, and per-chat fonts. These are private to
// this device by design (like WhatsApp contact names) — no backend needed.

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
    /* quota — ignore */
  }
}

// ---- Nicknames: { convId: "nickname" } ----
const NICK_KEY = "panalo.nicknames";
export function getNickname(convId) {
  return read(NICK_KEY, {})[convId] || "";
}
export function setNickname(convId, nickname) {
  const map = read(NICK_KEY, {});
  const trimmed = (nickname || "").trim();
  if (trimmed) map[convId] = trimmed;
  else delete map[convId];
  write(NICK_KEY, map);
}

// ---- Pinned chats: [convId] ----
const PINS_KEY = "panalo.pins";
export function isPinned(convId) {
  return read(PINS_KEY, []).includes(convId);
}
export function togglePin(convId) {
  const list = read(PINS_KEY, []);
  const i = list.indexOf(convId);
  if (i >= 0) list.splice(i, 1);
  else list.unshift(convId);
  write(PINS_KEY, list);
  return list.includes(convId);
}

// ---- Starred messages: [{ id, convId }] (content is fetched + decrypted live) ----
const STARS_KEY = "panalo.stars";
export function getStars() {
  return read(STARS_KEY, []);
}
export function isStarred(msgId) {
  return getStars().some((s) => s.id === msgId);
}
export function toggleStar(msgId, convId) {
  const list = getStars();
  const i = list.findIndex((s) => s.id === msgId);
  if (i >= 0) list.splice(i, 1);
  else list.unshift({ id: msgId, convId });
  write(STARS_KEY, list);
  return list.some((s) => s.id === msgId);
}

// ---- Pinned messages: { convId: [msgId] } ----
const PINMSG_KEY = "panalo.pinnedMsgs";
export function getPinnedMessages(convId) {
  return read(PINMSG_KEY, {})[convId] || [];
}
export function isMessagePinned(convId, msgId) {
  return getPinnedMessages(convId).includes(msgId);
}
export function toggleMessagePin(convId, msgId) {
  const map = read(PINMSG_KEY, {});
  const list = map[convId] || [];
  const i = list.indexOf(msgId);
  if (i >= 0) list.splice(i, 1);
  else list.unshift(msgId);
  if (list.length) map[convId] = list;
  else delete map[convId];
  write(PINMSG_KEY, map);
  return list.includes(msgId);
}

// ---- Custom sidebar folders ----
// [{ id, name, icon }] where icon is either a preset icon name ("star") or a
// "img:<data-url>" for an uploaded picture. Membership is a list of chat ids.
const FOLDERS_KEY = "panalo.folders";

export function getFolders() {
  return read(FOLDERS_KEY, []);
}

export function addFolder(name, icon) {
  const folders = getFolders();
  const folder = { id: `f_${Date.now().toString(36)}`, name: name.trim() || "Folder", icon: icon || "star", convIds: [] };
  folders.push(folder);
  write(FOLDERS_KEY, folders);
  return folder;
}

export function deleteFolder(id) {
  write(FOLDERS_KEY, getFolders().filter((f) => f.id !== id));
}

export function renameFolder(id, name) {
  const folders = getFolders();
  const f = folders.find((x) => x.id === id);
  if (!f) return;
  f.name = name.trim() || f.name;
  write(FOLDERS_KEY, folders);
}

export function isChatInFolder(folderId, convId) {
  return (getFolders().find((f) => f.id === folderId)?.convIds || []).includes(convId);
}

export function toggleChatInFolder(folderId, convId) {
  const folders = getFolders();
  const f = folders.find((x) => x.id === folderId);
  if (!f) return false;
  const i = f.convIds.indexOf(convId);
  if (i >= 0) f.convIds.splice(i, 1);
  else f.convIds.push(convId);
  write(FOLDERS_KEY, folders);
  return f.convIds.includes(convId);
}

export function folderChatIds(folderId) {
  return getFolders().find((f) => f.id === folderId)?.convIds || [];
}

// ---- Per-chat wallpaper: { convId: wallpaperId } ("app" = follow the app) ----
const CHAT_WP_KEY = "panalo.chatWallpapers";
export function getChatWallpaper(convId) {
  return read(CHAT_WP_KEY, {})[convId] || "app";
}
export function setChatWallpaper(convId, id) {
  const map = read(CHAT_WP_KEY, {});
  if (id && id !== "app") map[convId] = id;
  else delete map[convId];
  write(CHAT_WP_KEY, map);
}

// ---- Per-chat font: { convId: fontId } ----
const FONT_KEY = "panalo.chatFonts";
export function getChatFont(convId) {
  return read(FONT_KEY, {})[convId] || "default";
}
export function setChatFont(convId, fontId) {
  const map = read(FONT_KEY, {});
  if (fontId && fontId !== "default") map[convId] = fontId;
  else delete map[convId];
  write(FONT_KEY, map);
}
