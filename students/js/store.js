// Panalo Students' data: one in-memory copy of your study life, loaded once
// on entry and updated by every write, with a tiny pub/sub so each surface
// redraws what changed. Every row here is protected by RLS (phase 16): the
// queries ask for "mine" only for clarity, the database enforces it.
import { supabaseClient } from "../../src/client.js";
import { state } from "../../src/state.js";
import { DAY, dayKey } from "./model/time.js";

export const store = {
  me: null, // { id, username }
  student: null, // student_profiles row, or null before the universe is born
  tasks: [],
  sessions: [],
  events: [],
  logs: [],
  goals: [],
  sent: [], // my messages in the last 7 days (for the atmosphere)
  entries: [], // daily_entries (phase 24): one per day, newest first
  entriesMissing: false, // phase 24 not run yet: no dawn or check-in
  // True when the database hasn't run supabase-phase16.sql yet.
  schemaMissing: false,
  loaded: false,
};

const listeners = new Map();
export function on(topic, fn) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(fn);
  return () => listeners.get(topic)?.delete(fn);
}
export function emit(topic) {
  listeners.get(topic)?.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  });
  if (topic !== "any") listeners.get("any")?.forEach((fn) => fn(topic));
}

function missingTable(error) {
  return !!error && (error.code === "42P01" || error.code === "PGRST205" || /relation .* does not exist|could not find the table/i.test(error.message || ""));
}

export async function loadStudentProfile() {
  const { data, error } = await supabaseClient.from("student_profiles").select("*").eq("user_id", state.currentUser.id).maybeSingle();
  if (missingTable(error)) {
    store.schemaMissing = true;
    return null;
  }
  if (error) throw error;
  store.student = data || null;
  return store.student;
}

export async function loadAll() {
  const uid = state.currentUser.id;
  const since7 = new Date(Date.now() - 7 * DAY).toISOString();
  const queries = await Promise.all([
    supabaseClient.from("student_tasks").select("*").order("created_at", { ascending: false }).limit(2000),
    supabaseClient.from("focus_sessions").select("id, started_at, ended_at, focused_minutes, planned_minutes, completed, subject, task_id, quality").order("started_at", { ascending: false }).limit(5000),
    supabaseClient.from("student_events").select("*").order("starts_at").limit(3000),
    supabaseClient.from("activity_log").select("*").order("occurred_on", { ascending: false }).limit(3000),
    supabaseClient.from("student_goals").select("*").order("created_at"),
    supabaseClient.from("messages").select("id, created_at").eq("user_id", uid).gt("created_at", since7).limit(1000),
    supabaseClient.from("daily_entries").select("*").order("day", { ascending: false }).limit(800),
  ]);
  const [tasks, sessions, events, logs, goals, sent, entries] = queries;
  if (queries.slice(0, 5).some((q) => missingTable(q.error))) {
    store.schemaMissing = true;
  }
  store.tasks = tasks.data || [];
  store.sessions = sessions.data || [];
  store.events = events.data || [];
  store.logs = logs.data || [];
  store.goals = goals.data || [];
  store.sent = sent.data || [];
  store.entries = entries.data || [];
  store.entriesMissing = missingTable(entries.error);
  store.loaded = true;
  emit("any");
  return queries.slice(0, 6).find((q) => q.error && !missingTable(q.error))?.error || null;
}

// ---- writes -----------------------------------------------------------------

async function insert(table, row, list, topic, { prepend = true } = {}) {
  const { data, error } = await supabaseClient.from(table).insert([row]).select().single();
  if (error) return { error };
  if (prepend) store[list].unshift(data);
  else store[list].push(data);
  emit(topic);
  return { data };
}

async function update(table, id, patch, list, topic) {
  const { data, error } = await supabaseClient.from(table).update(patch).eq("id", id).select().single();
  if (error) return { error };
  const i = store[list].findIndex((r) => r.id === id);
  if (i >= 0) store[list][i] = data;
  emit(topic);
  return { data };
}

async function remove(table, id, list, topic) {
  const { error } = await supabaseClient.from(table).delete().eq("id", id);
  if (error) return { error };
  store[list] = store[list].filter((r) => r.id !== id);
  emit(topic);
  return {};
}

export const api = {
  addTask: (t) => insert("student_tasks", t, "tasks", "tasks"),
  updateTask: (id, patch) => update("student_tasks", id, patch, "tasks", "tasks"),
  toggleTask: (t) => update("student_tasks", t.id, { done_at: t.done_at ? null : new Date().toISOString() }, "tasks", "tasks"),
  deleteTask: (id) => remove("student_tasks", id, "tasks", "tasks"),

  addSession: (s) => insert("focus_sessions", s, "sessions", "sessions"),
  updateSession: (id, patch) => update("focus_sessions", id, patch, "sessions", "sessions"),

  addEvent: (e) => insert("student_events", e, "events", "events", { prepend: false }),
  updateEvent: (id, patch) => update("student_events", id, patch, "events", "events"),
  deleteEvent: (id) => remove("student_events", id, "events", "events"),

  addLog: (l) => insert("activity_log", l, "logs", "logs"),
  deleteLog: (id) => remove("activity_log", id, "logs", "logs"),

  addGoal: (g) => insert("student_goals", g, "goals", "goals", { prepend: false }),
  toggleGoal: (g) => update("student_goals", g.id, { done_at: g.done_at ? null : new Date().toISOString() }, "goals", "goals"),
  deleteGoal: (id) => remove("student_goals", id, "goals", "goals"),

  async saveStudent(patch) {
    const row = { user_id: state.currentUser.id, ...patch };
    const { data, error } = await supabaseClient.from("student_profiles").upsert(row, { onConflict: "user_id" }).select().single();
    if (error) return { error };
    store.student = data;
    emit("student");
    return { data };
  },

  /** Write today's (or `day`'s) entry: only the fields given change. */
  async saveEntry(patch, day = null) {
    const row = { user_id: state.currentUser.id, day: day || dayKey(new Date()), ...patch };
    const { data, error } = await supabaseClient.from("daily_entries").upsert(row, { onConflict: "user_id,day" }).select().single();
    if (error) return { error };
    const i = store.entries.findIndex((e) => e.day === data.day);
    if (i >= 0) store.entries[i] = data;
    else store.entries.unshift(data);
    store.entries.sort((a, b) => (a.day < b.day ? 1 : -1));
    emit("entries");
    return { data };
  },

  noteSent(msg) {
    store.sent.push({ id: msg.id, created_at: msg.created_at });
    emit("sent");
  },
};

export function resetStore() {
  Object.assign(store, {
    me: null, student: null, tasks: [], sessions: [], events: [], logs: [], goals: [], sent: [], entries: [], entriesMissing: false,
    conversations: [], unreadTotal: 0, requests: [], myRequests: [], resources: null,
    schemaMissing: false, loaded: false,
  });
}
