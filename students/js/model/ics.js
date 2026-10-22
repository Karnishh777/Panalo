// Your calendar as an .ics file (RFC 5545), for Google Calendar, Apple
// Calendar or Outlook. Weekly classes stay weekly (RRULE); open tasks with
// a due date come along as deadlines, at the moment they're due.
//
// Pure (tests/students-model.test.mjs).

const pad = (n) => String(n).padStart(2, "0");

/** A UTC timestamp in iCalendar form: 20261021T093000Z. */
export function icsStamp(d) {
  const x = new Date(d);
  return `${x.getUTCFullYear()}${pad(x.getUTCMonth() + 1)}${pad(x.getUTCDate())}T${pad(x.getUTCHours())}${pad(x.getUTCMinutes())}${pad(x.getUTCSeconds())}Z`;
}

/** Text with the characters iCalendar reserves escaped. */
export function icsText(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/[,;]/g, (c) => `\\${c}`);
}

// Lines longer than 75 octets are folded (continued with a leading space).
function fold(line) {
  const out = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 75) {
    let cut = 75;
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

const LABEL = { class: "Class", exam: "Exam", deadline: "Deadline", study: "Study", event: "Event", personal: "Personal" };

/**
 * @param {Array} events student_events rows
 * @param {Array} tasks  student_tasks rows (open ones with a due date become deadlines)
 * @param {number} now   for DTSTAMP
 */
export function toIcs(events = [], tasks = [], now = Date.now()) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Panalo//Students//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Panalo"];
  const stamp = icsStamp(now);
  for (const ev of events) {
    const start = new Date(ev.starts_at);
    if (Number.isNaN(start.getTime())) continue;
    const end = ev.ends_at ? new Date(ev.ends_at) : new Date(start.getTime() + (ev.kind === "deadline" ? 0 : 3600000));
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.id}@panalo-students`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsStamp(start)}`,
      `DTEND:${icsStamp(end > start ? end : start)}`,
      `SUMMARY:${icsText(ev.title)}`,
      `CATEGORIES:${LABEL[ev.kind] || "Event"}`
    );
    if (ev.location) lines.push(`LOCATION:${icsText(ev.location)}`);
    if (ev.repeat_weekly) lines.push("RRULE:FREQ=WEEKLY");
    lines.push("END:VEVENT");
  }
  for (const t of tasks) {
    if (t.done_at || !t.due_at) continue;
    const due = new Date(t.due_at);
    if (Number.isNaN(due.getTime())) continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:task-${t.id}@panalo-students`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsStamp(due)}`,
      `DTEND:${icsStamp(due)}`,
      `SUMMARY:${icsText(`Due: ${t.title}`)}`,
      "CATEGORIES:Deadline",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
