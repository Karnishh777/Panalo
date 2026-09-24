// Disappearing messages: the choices, their names, and the notice left in
// the chat when someone changes them.
//
// Pure, so it is tested in Node (tests/disappear.test.mjs). The rule itself
// lives in the database (supabase-phase15.sql): the server stamps each new
// message's expiry from the chat's timer and hides it once that passes. The
// client only offers the setting and removes messages from screen on time.

// Must match the CHECK constraint in supabase-phase15.sql exactly; anything
// else is refused by the database.
export const TIMERS = Object.freeze([
  { value: null, label: "Off" },
  { value: "1 day", label: "24 hours" },
  { value: "7 days", label: "7 days" },
  { value: "90 days", label: "90 days" },
]);

// Postgres hands intervals back in its own spelling, which depends on the
// server's IntervalStyle: "1 day", "7 days", but also "24:00:00" or ISO
// "P7D". Map whatever arrives onto one of TIMERS, or null for off/unknown.
export function normalizeTimer(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().toLowerCase();
  const days =
    /^(\d+) days?$/.exec(s)?.[1] ??
    /^p(\d+)d$/.exec(s)?.[1] ??
    (/^24:00:00$/.test(s) ? "1" : null);
  if (days === "1") return "1 day";
  if (days === "7") return "7 days";
  if (days === "90") return "90 days";
  return null;
}

export function timerLabel(value) {
  return TIMERS.find((t) => t.value === normalizeTimer(value))?.label || "Off";
}

// The notice is a message like any other, so it is encrypted like any
// other and everyone in the chat sees who changed what.
const MARKER = /^\[\[timer:(off|1 day|7 days|90 days)\]\]$/;

export function timerMarker(value) {
  return `[[timer:${normalizeTimer(value) || "off"}]]`;
}

export function parseTimerMarker(text) {
  const m = typeof text === "string" ? MARKER.exec(text.trim()) : null;
  if (!m) return null;
  return { value: m[1] === "off" ? null : m[1] };
}

export function describeTimerChange(value, who) {
  const v = normalizeTimer(value);
  return v
    ? `${who} turned on disappearing messages. New messages will disappear ${timerLabel(v)} after they're sent.`
    : `${who} turned off disappearing messages.`;
}

// Short form for a chat-list preview.
export function describeTimerMarker(text) {
  const parsed = parseTimerMarker(text);
  if (!parsed) return text;
  return parsed.value ? `⏱ Disappearing messages: ${timerLabel(parsed.value)}` : "⏱ Disappearing messages off";
}

// setTimeout silently fires at once for delays over 2^31-1 ms (~24.8 days),
// which would make a 90-day message vanish the moment it rendered.
export const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

// How long until a message should leave the screen; null if it never
// should, or not within one setTimeout's reach.
export function msUntilExpiry(expiresAt, now = Date.now()) {
  if (!expiresAt) return null;
  const at = new Date(expiresAt).getTime();
  if (!Number.isFinite(at)) return null;
  const ms = Math.max(0, at - now);
  return ms > MAX_TIMER_DELAY_MS ? null : ms;
}

export function isExpired(expiresAt, now = Date.now()) {
  if (!expiresAt) return false;
  const at = new Date(expiresAt).getTime();
  return Number.isFinite(at) && at <= now;
}
