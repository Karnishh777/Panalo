// The Study Room timer's state, kept in localStorage so it survives a
// reload, a closed laptop and navigating around the app -- and so Now can
// show a running session. Other tabs hear about changes through the
// `storage` event; this tab through a DOM event.
import { revive, idle, isDone, sessionRow } from "./model/focus-timer.js";
import { api } from "./store.js";

const KEY = "panalo.students.timer";
const EVENT = "panalo:timer";

export function loadTimer() {
  try {
    return revive(JSON.parse(localStorage.getItem(KEY) || "null"));
  } catch {
    return idle();
  }
}

export function saveTimer(state) {
  try {
    if (!state || state.phase === "idle") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: the timer still runs, it just won't survive a reload */
  }
  document.dispatchEvent(new CustomEvent(EVENT));
}

export function onTimer(fn) {
  const storage = (e) => e.key === KEY && fn();
  document.addEventListener(EVENT, fn);
  window.addEventListener("storage", storage);
  return () => {
    document.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", storage);
  };
}

// If a focus block finished while nobody was looking (the tab was closed,
// the laptop asleep), record it once, wherever the app happens to be.
// `recorded` in the saved state stops two tabs recording the same block.
let recording = false;
export async function settleTimer(now = Date.now(), { clear = false } = {}) {
  const t = loadTimer();
  if (clear && t.phase === "rest" && isDone(t, now)) {
    saveTimer(idle());
    return null;
  }
  if (recording || t.phase !== "focus" || !isDone(t, now) || t.recorded) return null;
  recording = true;
  try {
    const row = sessionRow(t, now);
    saveTimer({ ...t, recorded: true });
    if (!row) return null;
    const { error } = await api.addSession(row);
    if (error) {
      saveTimer({ ...t, recorded: false });
      return { error };
    }
    if (clear) saveTimer(idle());
    return { minutes: row.focused_minutes };
  } finally {
    recording = false;
  }
}
