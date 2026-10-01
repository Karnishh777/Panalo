// The Study Room timer's state, kept in localStorage so it survives a
// reload, a closed laptop and navigating around the app -- and so Now can
// show a running session. Other tabs hear about changes through the
// `storage` event; this tab through a DOM event.
import { revive, idle, isDone, sessionRow } from "./model/focus-timer.js";
import { api } from "./store.js";
import { state } from "../../src/state.js";

const KEY = "panalo.students.timer";
const EVENT = "panalo:timer";

// A timer belongs to the account that started it. On a shared device the
// next person to sign in must never inherit -- or be credited with -- it.
export function loadTimer() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!raw || raw.owner !== state.currentUser?.id) return idle();
    return revive(raw);
  } catch {
    return idle();
  }
}

export function clearTimer() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  document.dispatchEvent(new CustomEvent(EVENT));
}

export function saveTimer(timer) {
  try {
    if (!timer || timer.phase === "idle") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify({ ...timer, owner: state.currentUser?.id }));
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
// Store a finished focus block. If the task it was for has been deleted
// since, the session still counts -- just without the task. A refusal that
// is not about the network is final: retrying it forever helps nobody.
export async function recordSession(row) {
  let { error } = await api.addSession(row);
  if (error && row.task_id && !/fetch|network/i.test(error.message || "")) {
    ({ error } = await api.addSession({ ...row, task_id: null }));
  }
  if (!error) return {};
  const transient = /fetch|network|timeout/i.test(error.message || "");
  return { error, transient };
}

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
    const { error, transient } = await recordSession(row);
    if (error) {
      // Offline: try again later. Refused for good: let it go.
      saveTimer(transient ? { ...t, recorded: false } : idle());
      return { error };
    }
    if (clear) saveTimer(idle());
    return { minutes: row.focused_minutes };
  } finally {
    recording = false;
  }
}
