// "This changed on this device" -- for settings that follow the account
// (sync.js). Kept free of imports so any module can call it.
export const SYNC_META = "panalo.students.synced"; // section -> when it last changed here (ms)
export const SYNC_CHANGE = "panalo:local-change";
let muted = 0;

/** Something in `section` (prefs, light, drift, timer) changed here. */
export function localChange(section) {
  if (muted) return;
  try {
    const m = JSON.parse(localStorage.getItem(SYNC_META) || "{}") || {};
    m[section] = Date.now();
    localStorage.setItem(SYNC_META, JSON.stringify(m));
  } catch {}
  window.dispatchEvent(new CustomEvent(SYNC_CHANGE, { detail: section }));
}

/** Run `fn` without announcing what it changes (applying the account's copy). */
export function quietly(fn) {
  muted++;
  try {
    return fn();
  } finally {
    muted--;
  }
}
