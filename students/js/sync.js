// Settings and the running focus timer follow the account across devices
// (supabase-phase21.sql: student_profiles.device_state).
//
// Each section still lives in this browser's storage, so everything works
// offline and instantly; this module copies it to the account when it
// changes here, and copies the account's copy back when it's newer --
// on sign-in, when the tab comes back into view, and every two minutes.
// The newest change wins, per section.
//
// Modules announce a change with `localChange(section)` (local-change.js);
// nothing here knows what the sections mean.
import { supabaseClient } from "../../src/client.js";
import { store } from "./store.js";
import { SYNC_META as META, SYNC_CHANGE as CHANGE, quietly } from "./local-change.js";

export const SECTIONS = {
  prefs: { key: "panalo.students.prefs", event: null },
  light: { key: "panalo.students.light", event: "panalo:light" },
  drift: { key: "panalo.students.drift", event: null },
  timer: { key: "panalo.students.timer", event: "panalo:timer" },
};
let active = false;
let timer = null;
const dirty = new Set();
let pushTimer = null;

function readMeta() {
  try {
    return JSON.parse(localStorage.getItem(META) || "{}") || {};
  } catch {
    return {};
  }
}
function writeMeta(m) {
  try {
    localStorage.setItem(META, JSON.stringify(m));
  } catch {}
}
function readLocal(section) {
  try {
    const raw = localStorage.getItem(SECTIONS[section].key);
    const v = raw === null ? null : JSON.parse(raw);
    // A timer left by someone else who used this browser is not ours to share.
    if (section === "timer" && v && v.owner && v.owner !== store.me?.id) return null;
    return v;
  } catch {
    return null;
  }
}

function onChange(e) {
  if (!active) return;
  dirty.add(e.detail);
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 1200);
}

async function push() {
  if (!active || !store.student) return;
  const m = readMeta();
  for (const section of [...dirty]) {
    dirty.delete(section);
    const value = readLocal(section);
    const { data, error } = await supabaseClient.rpc("merge_device_state", { p_section: section, p_value: value, p_at: m[section] || Date.now() });
    if (error) {
      // Offline or not set up yet: try again with the next change or pull.
      if (!/function|schema/i.test(error.message || "")) dirty.add(section);
      continue;
    }
    if (data) store.student.device_state = data;
  }
}

// Take whatever the account has that's newer than this device's copy.
export function apply(state) {
  if (!state || typeof state !== "object") return;
  const m = readMeta();
  let changed = false;
  quietly(() => {
    for (const [section, { key, event }] of Object.entries(SECTIONS)) {
      const remote = state[section];
      if (!remote || typeof remote.at !== "number" && typeof remote.at !== "string") continue;
      const at = Number(remote.at);
      if (!(at > (m[section] || 0))) continue;
      try {
        if (remote.v === null || remote.v === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(remote.v));
      } catch {}
      m[section] = at;
      changed = true;
      if (event === "panalo:light") window.dispatchEvent(new CustomEvent(event, { detail: remote.v }));
      else if (event) document.dispatchEvent(new CustomEvent(event));
    }
  });
  if (changed) writeMeta(m);
  return changed;
}

async function pull() {
  if (!active || !store.me?.id) return;
  const { data, error } = await supabaseClient.from("student_profiles").select("device_state").eq("user_id", store.me.id).maybeSingle();
  if (error || !data) return;
  if (store.student) store.student.device_state = data.device_state;
  apply(data.device_state);
  // Anything changed here while signed out or offline goes up now.
  const m = readMeta();
  for (const section of Object.keys(SECTIONS)) {
    const remote = data.device_state?.[section];
    const remoteAt = Number(remote?.at || 0);
    if ((m[section] || 0) > remoteAt) dirty.add(section);
    // First time on the account: what this device already had goes up.
    else if (!remote && readLocal(section) !== null) {
      m[section] = Date.now();
      writeMeta(m);
      dirty.add(section);
    }
  }
  if (dirty.size) push();
}

const onVisible = () => document.visibilityState === "visible" && pull();

export function startSync() {
  if (active) return;
  active = true;
  window.addEventListener(CHANGE, onChange);
  document.addEventListener("visibilitychange", onVisible);
  apply(store.student?.device_state);
  pull();
  timer = setInterval(() => document.visibilityState === "visible" && pull(), 120_000);
}

export function stopSync() {
  active = false;
  clearInterval(timer);
  clearTimeout(pushTimer);
  dirty.clear();
  window.removeEventListener(CHANGE, onChange);
  document.removeEventListener("visibilitychange", onVisible);
}
