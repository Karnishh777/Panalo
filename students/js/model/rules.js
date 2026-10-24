// Your own changes to the plan (phase 32). The planner makes the week; the
// student can still say "Sundays off", "only an hour on Saturday", "not
// before 5", "more maths", "skip this one", "do it today". Whether they set
// it by hand or tell Pan, it ends up as the same small set of rules, which
// buildPlan() (plan.js) follows. Pure (tested in Node).
//
//   off:     [weekday]                  no study on these days (0 = Sunday)
//   minutes: { weekday: minutes }       at most this much on that day
//   start:   "HH:MM" | null             nothing before this time
//   weight:  { subject: 0 | 0.5 | 1.5 | 2 }   less, more; 0 pauses it
//   dates:   { "YYYY-MM-DD": { off } | { minutes } }   one-off days
//   skips:   ["YYYY-MM-DD|subject|topic"]  not this block on that day
//   pins:    [{ date, subject, topic, kind }]  this block first that day

export const WEIGHTS = [0, 0.5, 1, 1.5, 2];
export const OPS = ["day_off", "day_on", "day_minutes", "date_off", "date_minutes", "date_clear", "start_after", "subject_weight", "reset"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ITEMS = 60;

export const empty = () => ({ off: [], minutes: {}, start: null, weight: {}, dates: {}, skips: [], pins: [] });

/** "YYYY-MM-DD" for a moment, in local time. */
export function dateKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const minutes = (n) => Math.min(600, Math.max(0, Math.round(Number(n) / 5) * 5 || 0));
const weekday = (n) => (Number.isInteger(Number(n)) && Number(n) >= 0 && Number(n) <= 6 ? Number(n) : null);
const nearestWeight = (w) => WEIGHTS.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a), 1);

/**
 * Rules as stored, cleaned: unknown keys and subjects dropped, numbers
 * clamped, and anything about a day already past forgotten.
 */
export function normalize(raw, { subjects = null, now = Date.now() } = {}) {
  const r = empty();
  if (!raw || typeof raw !== "object") return r;
  const known = subjects ? new Set(subjects) : null;
  const today = dateKey(now);
  r.off = [...new Set((raw.off || []).map(weekday).filter((d) => d != null))].sort();
  for (const [d, m] of Object.entries(raw.minutes || {})) if (weekday(d) != null && !r.off.includes(Number(d))) r.minutes[Number(d)] = minutes(m);
  r.start = TIME.test(raw.start || "") ? raw.start : null;
  for (const [s, w] of Object.entries(raw.weight || {})) {
    const v = nearestWeight(Number(w));
    if (v !== 1 && (!known || known.has(s))) r.weight[s] = v;
  }
  for (const [k, v] of Object.entries(raw.dates || {}).slice(0, MAX_ITEMS)) {
    if (!DATE.test(k) || k < today || !v) continue;
    if (v.off) r.dates[k] = { off: true };
    else if (v.minutes != null) r.dates[k] = { minutes: minutes(v.minutes) };
  }
  r.skips = [...new Set((raw.skips || []).filter((s) => typeof s === "string" && DATE.test(s.slice(0, 10)) && s.slice(0, 10) >= today))].slice(-MAX_ITEMS);
  r.pins = (raw.pins || [])
    .filter((p) => p && DATE.test(p.date) && p.date >= today && typeof p.subject === "string" && typeof p.topic === "string" && (!known || known.has(p.subject)))
    .map((p) => ({ date: p.date, subject: p.subject, topic: p.topic, kind: ["check", "learn", "practice", "review"].includes(p.kind) ? p.kind : "learn" }))
    .slice(-MAX_ITEMS);
  return r;
}

/** Whether rules change anything at all. */
export function isEmpty(r) {
  return !r.off.length && !Object.keys(r.minutes).length && !r.start && !Object.keys(r.weight).length && !Object.keys(r.dates).length && !r.skips.length && !r.pins.length;
}

/**
 * Apply a list of changes (from the editor or from Pan) to rules; returns
 * new rules. A change: { op, weekday?, date?, minutes?, time?, subject?, weight? }.
 */
export function applyChanges(rules, changes, opts = {}) {
  let r = normalize(rules, opts);
  for (const c of changes || []) {
    const d = weekday(c.weekday);
    switch (c.op) {
      case "day_off":
        if (d != null && !r.off.includes(d)) r.off.push(d);
        if (d != null) delete r.minutes[d];
        break;
      case "day_on":
        if (d != null) r.off = r.off.filter((x) => x !== d);
        if (d != null && c.minutes != null) r.minutes[d] = minutes(c.minutes);
        break;
      case "day_minutes":
        if (d == null) break;
        if (c.minutes == null) delete r.minutes[d];
        else {
          r.off = r.off.filter((x) => x !== d);
          r.minutes[d] = minutes(c.minutes);
        }
        break;
      case "date_off":
        if (DATE.test(c.date || "")) r.dates[c.date] = { off: true };
        break;
      case "date_minutes":
        if (DATE.test(c.date || "") && c.minutes != null) r.dates[c.date] = { minutes: minutes(c.minutes) };
        break;
      case "date_clear":
        if (DATE.test(c.date || "")) delete r.dates[c.date];
        break;
      case "start_after":
        r.start = TIME.test(c.time || "") ? c.time : null;
        break;
      case "subject_weight":
        if (typeof c.subject === "string") {
          const w = nearestWeight(Number(c.weight ?? 1));
          if (w === 1) delete r.weight[c.subject];
          else r.weight[c.subject] = w;
        }
        break;
      case "skip":
        if (DATE.test(c.date || "") && c.subject && c.topic) r.skips.push(`${c.date}|${c.subject}|${c.topic}`);
        break;
      case "pin":
        if (DATE.test(c.date || "") && c.subject && c.topic) {
          r.pins = r.pins.filter((p) => !(p.subject === c.subject && p.topic === c.topic));
          r.pins.push({ date: c.date, subject: c.subject, topic: c.topic, kind: c.kind || "learn" });
        }
        break;
      case "reset":
        r = empty();
        break;
    }
  }
  r.off.sort();
  return normalize(r, opts);
}

/** For one day of the plan: whether it's off, its cap, and its earliest start (minutes). */
export function dayRule(r, ms) {
  const key = dateKey(ms);
  const wd = new Date(ms).getDay();
  const one = r.dates[key];
  const [h, m] = (r.start || "00:00").split(":").map(Number);
  return {
    off: !!one?.off || (!one && r.off.includes(wd)),
    cap: one?.minutes ?? r.minutes[wd] ?? null,
    from: r.start ? h * 60 + m : 0,
    key,
  };
}

const WD_LABEL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const hours = (m) => (m % 60 ? (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`) : `${m / 60} h`);
const dayOf = (key, now) => {
  const [y, mo, d] = key.split("-").map(Number);
  const ms = new Date(y, mo - 1, d).getTime();
  const diff = Math.round((ms - new Date(now).setHours(0, 0, 0, 0)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return new Date(ms).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
};

/**
 * The rules in plain words, one line each, with the change that undoes
 * each line (so the editor can offer to remove it).
 */
export function describe(r, { nameOf = (s) => s, clock = (t) => t, now = Date.now() } = {}) {
  const out = [];
  for (const d of r.off) out.push({ text: `${WD_LABEL[d]} off`, undo: { op: "day_on", weekday: d } });
  for (const [d, m] of Object.entries(r.minutes)) out.push({ text: m ? `${WD_LABEL[d]}: at most ${hours(m)}` : `${WD_LABEL[d]} off`, undo: { op: "day_minutes", weekday: Number(d), minutes: null } });
  if (r.start) out.push({ text: `Nothing before ${clock(r.start)}`, undo: { op: "start_after", time: null } });
  for (const [s, w] of Object.entries(r.weight)) {
    const how = w === 0 ? "paused" : w < 1 ? "less" : w >= 2 ? "a lot more" : "more";
    out.push({ text: `${nameOf(s)}: ${how}`, undo: { op: "subject_weight", subject: s, weight: 1 } });
  }
  for (const [k, v] of Object.entries(r.dates).sort()) out.push({ text: `${dayOf(k, now)}: ${v.off ? "off" : `at most ${hours(v.minutes)}`}`, undo: { op: "date_clear", date: k } });
  if (r.skips.length) out.push({ text: `${r.skips.length} block${r.skips.length > 1 ? "s" : ""} skipped`, undo: { op: "clear_skips" } });
  for (const p of r.pins) out.push({ text: `${dayOf(p.date, now)}: ${nameOf(p.subject)} first`, undo: { op: "unpin", subject: p.subject, topic: p.topic } });
  return out;
}

/** One change (from Pan or the editor) in plain words, for a preview. */
export function describeChange(c, { nameOf = (s) => s, clock = (t) => t, now = Date.now() } = {}) {
  const days = WD_LABEL[c.weekday] || "That day";
  switch (c.op) {
    case "day_off":
      return `${days} off`;
    case "day_on":
      return `${days} back on${c.minutes != null ? `, at most ${hours(minutes(c.minutes))}` : ""}`;
    case "day_minutes":
      return c.minutes == null ? `${days}: as planned` : `${days}: at most ${hours(minutes(c.minutes))}`;
    case "date_off":
      return `${dayOf(c.date, now)}: off`;
    case "date_minutes":
      return `${dayOf(c.date, now)}: at most ${hours(minutes(c.minutes))}`;
    case "date_clear":
      return `${dayOf(c.date, now)}: as planned`;
    case "start_after":
      return c.time ? `Nothing before ${clock(c.time)}` : "Any start time";
    case "subject_weight": {
      const w = nearestWeight(Number(c.weight ?? 1));
      return `${nameOf(c.subject)}: ${w === 0 ? "paused" : w === 1 ? "as normal" : w < 1 ? "less" : w >= 2 ? "a lot more" : "more"}`;
    }
    case "reset":
      return "Back to the plan as the planner made it";
    default:
      return "";
  }
}

/** Undo one line from describe() (the two that aren't plain changes). */
export function undo(r, change, opts = {}) {
  if (change.op === "clear_skips") return normalize({ ...r, skips: [] }, opts);
  if (change.op === "unpin") return normalize({ ...r, pins: r.pins.filter((p) => !(p.subject === change.subject && p.topic === change.topic)) }, opts);
  return applyChanges(r, [change], opts);
}

// ---- understanding a sentence without Pan ---------------------------------------------

const NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, half: 0.5 };

function amount(text) {
  const m = text.match(/(\d+(?:\.\d+)?|an?|one|two|three|four|five|half)\s*(?:an?\s*)?(hours?|hrs?|h\b|minutes?|mins?|m\b)/);
  if (!m) return null;
  const n = NUM_WORDS[m[1]] ?? Number(m[1]);
  return /^h/.test(m[2]) ? Math.round(n * 60) : Math.round(n);
}

function clockTime(text) {
  const m = text.match(/(?:after|from|not before|no earlier than|start(?:ing)? at|start after)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (!m[3] && h >= 1 && h <= 9) h += 12; // "after 5" means the evening
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function daysIn(text, now) {
  const out = [];
  const today = new Date(now);
  if (/\btoday\b|\btonight\b/.test(text)) out.push({ date: dateKey(now) });
  if (/\btomorrow\b/.test(text)) out.push({ date: dateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime()) });
  const every = /\b(every|each|all)\b/.test(text);
  WEEKDAYS.forEach((w, i) => {
    const re = new RegExp(`\\b${w}s?\\b|\\b${w.slice(0, 3)}\\b`);
    const m = text.match(re);
    if (!m) return;
    // "Saturdays", "on Saturday": every week. "this / next / coming
    // Saturday": that one day.
    const once = new RegExp(`\\b(this|next|coming)\\s+${m[0]}`).test(text) && !every;
    if (!once) out.push({ weekday: i });
    else {
      const ahead = (i - today.getDay() + 7) % 7;
      out.push({ date: dateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + ahead).getTime()), weekday: i, once: true });
    }
  });
  if (/\bweekends?\b/.test(text)) out.push({ weekday: 0 }, { weekday: 6 });
  if (/\bweekdays\b/.test(text)) [1, 2, 3, 4, 5].forEach((d) => out.push({ weekday: d }));
  return out;
}

/**
 * Understand a sentence like "no study on Sundays", "only 1 hour on
 * saturday", "more maths, less chemistry", "start after 5pm", "skip
 * tomorrow", "back to normal". Returns { changes, summary } -- the same
 * shape Pan answers with -- or changes: [] when nothing was understood.
 * `subjects` is [{ id, name }].
 */
export function understand(sentence, { subjects = [], now = Date.now() } = {}) {
  const changes = [];
  const parts = String(sentence || "").toLowerCase().slice(0, 500).split(/[.;\n]|,|\band\b|\bbut\b/);
  for (const raw of parts) {
    const text = raw.trim();
    if (!text) continue;
    if (/\b(reset|back to normal|undo everything|clear (all|everything)|start over)\b/.test(text)) {
      changes.push({ op: "reset" });
      continue;
    }
    const t = clockTime(text);
    if (t) {
      changes.push({ op: "start_after", time: t });
    }
    // subjects: more / less / pause
    for (const s of subjects) {
      const names = [s.name.toLowerCase(), s.id.toLowerCase(), ...(s.aliases || [])];
      if (!names.some((n) => n && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text))) continue;
      let w = null;
      if (/\b(pause|stop|drop|no more|skip|leave out|without)\b/.test(text)) w = 0;
      else if (/\b(a lot more|much more|lots more|way more|double)\b/.test(text)) w = 2;
      else if (/\b(more|focus|extra|priorit|harder|weak)\w*/.test(text)) w = 1.5;
      else if (/\b(less|fewer|lighter|reduce|cut)\b/.test(text)) w = 0.5;
      else if (/\b(normal|usual|resume|unpause|back)\b/.test(text)) w = 1;
      if (w != null) {
        changes.push({ op: "subject_weight", subject: s.id, weight: w });
      }
    }
    if (changes.some((c) => c.op === "subject_weight") && !/\b(day|days|today|tomorrow|week|hour|min|off)\b/.test(text) && !daysIn(text, now).length) continue;
    const days = daysIn(text, now);
    if (!days.length) continue;
    const m = amount(text);
    const off = /\b(off|free|no (study|studying|work|plan)|rest|holiday|skip|break|busy|can't|cannot|nothing)\b/.test(text);
    const on = /\b(back on|study again|resume|on again)\b/.test(text);
    for (const d of days) {
      if (m != null && !off) {
        if (d.date && (d.once || d.weekday == null)) changes.push({ op: "date_minutes", date: d.date, minutes: m });
        else changes.push({ op: "day_minutes", weekday: d.weekday, minutes: m });
      } else if (on) {
        changes.push(d.date && d.weekday == null ? { op: "date_clear", date: d.date } : { op: "day_on", weekday: d.weekday });
      } else if (off) {
        if (d.date && (d.once || d.weekday == null)) changes.push({ op: "date_off", date: d.date });
        else changes.push({ op: "day_off", weekday: d.weekday });
      }
    }
  }
  const summary = changes.length ? "Here's what I understood:" : "";
  return { changes, summary };
}
