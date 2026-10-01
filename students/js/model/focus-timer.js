// The Study Room timer as a state machine over timestamps.
//
// The timer never counts ticks: it stores when the current run started and
// how much had elapsed before it, so a sleeping laptop, a background tab or
// a reload cannot make it drift or lose time. Pure (tested in Node).
import { MINUTE } from "./time.js";

export const PRESETS = [
  { id: "25", focus: 25, rest: 5, label: "25 / 5" },
  { id: "50", focus: 50, rest: 10, label: "50 / 10" },
  { id: "90", focus: 90, rest: 15, label: "90 / 15" },
];

export function idle() {
  return { phase: "idle" };
}

/**
 * @param {"focus"|"rest"} phase
 * @param {number} minutes
 * @param {number} now
 * @param {{subject?: string|null, taskId?: string|null}} meta
 */
export function start(phase, minutes, now, meta = {}) {
  return {
    phase,
    status: "running",
    plannedMs: Math.max(1, Math.round(minutes)) * MINUTE,
    startedAt: now,
    segmentStart: now,
    elapsedBefore: 0,
    subject: meta.subject || null,
    taskId: meta.taskId || null,
  };
}

export function elapsed(state, now) {
  if (!state || state.phase === "idle") return 0;
  const running = state.status === "running" ? Math.max(0, now - state.segmentStart) : 0;
  return Math.min(state.plannedMs, state.elapsedBefore + running);
}

export function remaining(state, now) {
  if (!state || state.phase === "idle") return 0;
  return Math.max(0, state.plannedMs - elapsed(state, now));
}

export function progress(state, now) {
  if (!state || state.phase === "idle") return 0;
  return elapsed(state, now) / state.plannedMs;
}

export function isDone(state, now) {
  return !!state && state.phase !== "idle" && remaining(state, now) === 0;
}

export function pause(state, now) {
  if (!state || state.status !== "running") return state;
  return { ...state, status: "paused", elapsedBefore: elapsed(state, now), segmentStart: null };
}

export function resume(state, now) {
  if (!state || state.status !== "paused") return state;
  return { ...state, status: "running", segmentStart: now };
}

// Whole minutes actually spent focusing. Paused time never counts.
export function focusedMinutes(state, now) {
  if (!state || state.phase !== "focus") return 0;
  return Math.floor(elapsed(state, now) / MINUTE);
}

// The row to store when a focus block ends (completed or not). Null when
// there is nothing worth recording.
export function sessionRow(state, now) {
  if (!state || state.phase !== "focus") return null;
  const minutes = focusedMinutes(state, now);
  if (minutes < 1) return null;
  return {
    started_at: new Date(state.startedAt).toISOString(),
    ended_at: new Date(Math.max(now, state.startedAt + minutes * MINUTE)).toISOString(),
    planned_minutes: Math.round(state.plannedMs / MINUTE),
    focused_minutes: minutes,
    completed: isDone(state, now),
    subject: state.subject,
    task_id: state.taskId,
  };
}

// "24:59" style readout.
export function readout(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Restore a saved state, refusing anything malformed.
export function revive(raw) {
  if (!raw || typeof raw !== "object") return idle();
  if (!["focus", "rest"].includes(raw.phase)) return idle();
  if (!["running", "paused"].includes(raw.status)) return idle();
  if (!Number.isFinite(raw.plannedMs) || !Number.isFinite(raw.startedAt) || !Number.isFinite(raw.elapsedBefore)) return idle();
  if (raw.status === "running" && !Number.isFinite(raw.segmentStart)) return idle();
  return { ...raw, recorded: !!raw.recorded };
}
