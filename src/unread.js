// Unread tracking. A per-device "last read" timestamp per conversation is all
// the state we need — unread counts are then derived from message timestamps,
// so this works without any extra backend table.
import { state } from "./state.js";

const LAST_READ_KEY = "panalo.lastRead";
const BASE_TITLE = "Panalo";

function readMap() {
  try {
    return JSON.parse(localStorage.getItem(LAST_READ_KEY) || "{}");
  } catch {
    return {};
  }
}
function writeMap(map) {
  try {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify(map));
  } catch {
    /* quota — ignore */
  }
}

export function getLastRead(convId) {
  return readMap()[convId] || null;
}

// Merge the server's read markers in (written from your other devices), always
// keeping whichever position is further along.
export function mergeServerMarkers(markers) {
  const map = readMap();
  let changed = false;
  for (const [convId, at] of Object.entries(markers || {})) {
    if (!map[convId] || at > map[convId]) {
      map[convId] = at;
      changed = true;
    }
  }
  if (changed) writeMap(map);
}

// Mark everything up to now as read. Returns true if the count actually changed.
export function markRead(convId) {
  const map = readMap();
  map[convId] = new Date().toISOString();
  writeMap(map);
}

// Drop the read pointer for a deleted chat — otherwise a re-created chat with
// the same id would silently pick up the old "already read up to" marker.
export function forgetReadState(convId) {
  const map = readMap();
  if (map[convId] === undefined) return;
  delete map[convId];
  writeMap(map);
}

// Roll the read pointer back to just before a specific message, so it (and
// anything after it) shows up as unread again. Used by snooze — the whole
// point is to *un*-read a message and let the normal unread machinery notice.
export function rollbackReadTo(convId, iso) {
  const map = readMap();
  const before = new Date(new Date(iso).getTime() - 1).toISOString();
  // Only move backwards; never accidentally advance the pointer.
  if (!map[convId] || before < map[convId]) {
    map[convId] = before;
    writeMap(map);
  }
}

// Count messages in `messages` that arrived after the last read and weren't ours.
export function countUnread(convId, messages) {
  const since = getLastRead(convId);
  return messages.filter(
    (m) => m.user_id !== state.currentUser?.id && (!since || m.created_at > since)
  ).length;
}

// Is this message unread? (used for the "unread messages" divider)
export function isUnreadMessage(convId, msg) {
  const since = getLastRead(convId);
  return msg.user_id !== state.currentUser?.id && (!since || msg.created_at > since);
}

export function formatCount(n) {
  return n > 99 ? "99+" : String(n);
}

// Tab title reflects the total, like every other messenger: "(3) Panalo".
export function updateTitleBadge(total) {
  document.title = total > 0 ? `(${formatCount(total)}) ${BASE_TITLE}` : BASE_TITLE;
}
