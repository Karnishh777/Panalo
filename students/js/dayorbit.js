// The day orbit: a 24-hour ring, midnight at the top, with your day on it.
//
//   outer ring     the hours, with the part of the day already gone dimmed
//   middle track   classes, study blocks, events (arcs), deadlines (diamonds)
//   inner track    focus sessions you actually did today (ice)
//   dots           tasks you finished today, at the time you finished them
//   hand           now
//
// Built as SVG so it is crisp at any size, and every mark carries a <title>.
// The same information is always also available as a list next to it, so
// the ring is never the only way to read the day.
import { occurrencesOnDay, arcOnDay, EVENT_KINDS } from "./model/timeline.js";
import { startOfDay, addDays, dayFraction, clockTime, sameDay } from "./model/time.js";

const NS = "http://www.w3.org/2000/svg";
const C = 200;

function s(tag, attrs = {}, children = []) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const c of children) if (c) n.append(c);
  return n;
}

function polar(frac, r) {
  const a = frac * Math.PI * 2 - Math.PI / 2;
  return [C + Math.cos(a) * r, C + Math.sin(a) * r];
}

function arcPath(f0, f1, r) {
  const span = Math.max(0.0015, f1 - f0);
  const [x0, y0] = polar(f0, r);
  const [x1, y1] = polar(f0 + span, r);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${span > 0.5 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const TONE = { time: "var(--time)", focus: "var(--focus)", signal: "var(--signal)", world: "var(--world)", alert: "var(--alert)" };

/**
 * @param {{day: Date, events: object[], sessions: object[], tasks: object[], now?: number, onPick?: (occ) => void}} opts
 */
export function dayOrbit({ day, events, sessions = [], tasks = [], now = Date.now(), onPick }) {
  const isToday = sameDay(day, now);
  const occ = occurrencesOnDay(events, day);
  const dayStart = startOfDay(day).getTime();
  const dayEnd = addDays(new Date(dayStart), 1).getTime();
  const label = occ.length
    ? `${occ.length} thing${occ.length === 1 ? "" : "s"} on this day: ${occ.map((o) => `${o.event.title} at ${clockTime(o.start)}`).join(", ")}`
    : "Nothing scheduled on this day";

  const svg = s("svg", { viewBox: "0 0 400 400", class: "orbit-svg", role: "img", "aria-label": label });

  // Hour ring and ticks.
  svg.append(s("circle", { cx: C, cy: C, r: 178, class: "orbit-track" }));
  if (isToday) {
    const f = dayFraction(now);
    svg.append(s("path", { d: arcPath(0, f, 178), class: "orbit-past" }));
  }
  for (let h = 0; h < 24; h++) {
    const major = h % 6 === 0;
    const [x0, y0] = polar(h / 24, major ? 168 : 172);
    const [x1, y1] = polar(h / 24, 184);
    svg.append(s("line", { x1: x0, y1: y0, x2: x1, y2: y1, class: major ? "orbit-tick major" : "orbit-tick" }));
    if (major) {
      const [lx, ly] = polar(h / 24, 194);
      const t = s("text", { x: lx, y: ly + 3.5, class: "orbit-label", "text-anchor": "middle" });
      t.textContent = String(h).padStart(2, "0");
      svg.append(t);
    }
  }

  // Middle track: scheduled things.
  svg.append(s("circle", { cx: C, cy: C, r: 150, class: "orbit-lane" }));
  for (const o of occ) {
    const tone = TONE[EVENT_KINDS[o.event.kind]?.tone] || TONE.time;
    const title = s("title");
    title.textContent = `${o.event.title} · ${EVENT_KINDS[o.event.kind]?.label || ""} · ${clockTime(o.start)}${o.end > o.start ? `–${clockTime(o.end)}` : ""}`;
    const { a0, a1 } = arcOnDay(o, day);
    let mark;
    if (o.event.kind === "deadline" || a1 - a0 < 0.003) {
      const [x, y] = polar(a0, 150);
      mark = s("path", { d: `M${x} ${y - 8}L${x + 8} ${y}L${x} ${y + 8}L${x - 8} ${y}Z`, fill: tone, class: "orbit-mark" }, [title]);
    } else {
      mark = s("path", { d: arcPath(a0, a1, 150), stroke: tone, class: "orbit-arc orbit-mark" }, [title]);
    }
    const past = isToday && o.end.getTime() < now;
    if (past) mark.classList.add("done");
    if (onPick) {
      mark.setAttribute("tabindex", "0");
      mark.addEventListener("click", () => onPick(o));
      mark.addEventListener("keydown", (e) => e.key === "Enter" && onPick(o));
    }
    svg.append(mark);
  }

  // Inner track: focus that actually happened.
  svg.append(s("circle", { cx: C, cy: C, r: 126, class: "orbit-lane thin" }));
  for (const ss of sessions) {
    const a = Date.parse(ss.started_at);
    const b = Date.parse(ss.ended_at);
    if (!(b > dayStart && a < dayEnd)) continue;
    const t = s("title");
    t.textContent = `Focused ${ss.focused_minutes} min${ss.subject ? ` on ${ss.subject}` : ""}`;
    svg.append(s("path", { d: arcPath(dayFraction(Math.max(a, dayStart)), b >= dayEnd ? 1 : dayFraction(b), 126), class: "orbit-focus" }, [t]));
  }

  // Finished tasks.
  for (const tk of tasks) {
    if (!tk.done_at) continue;
    const d = Date.parse(tk.done_at);
    if (d < dayStart || d >= dayEnd) continue;
    const [x, y] = polar(dayFraction(d), 112);
    const t = s("title");
    t.textContent = `Finished: ${tk.title}`;
    svg.append(s("circle", { cx: x, cy: y, r: 3.2, class: "orbit-done" }, [t]));
  }

  // Now.
  if (isToday) {
    const f = dayFraction(now);
    const [x0, y0] = polar(f, 100);
    const [x1, y1] = polar(f, 186);
    svg.append(s("line", { x1: x0, y1: y0, x2: x1, y2: y1, class: "orbit-hand" }));
    svg.append(s("circle", { cx: x1, cy: y1, r: 4.5, class: "orbit-hand-dot" }));
  }
  return svg;
}
