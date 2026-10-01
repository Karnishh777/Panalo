// Drift: recover, discover, return.
//
// The opposite of a feed. Three things a day -- something true, something
// to make, something to play -- each revealed by choice rather than by
// scrolling. When you've seen them, Drift says so and offers the way back.
// Nothing here is personalised beyond the interests you picked, nothing is
// tracked, and there is no "more".
import { el, showToast, reportError } from "../ui.js";
import { store, api } from "../store.js";
import { pickDrift } from "../model/drift-pick.js";
import { LIBRARY, INTERESTS } from "../model/drift-library.js";
import { dayKey } from "../model/time.js";
import { reducedMotion } from "../motion.js";
import { playAmbient, setVolume, currentSound } from "../ambient.js";

const LIBRARY_TAG = Object.fromEntries(INTERESTS.map((i) => [i.id, i.label]));

let root;
let cleanup = [];

const SEEN_KEY = "panalo.students.drift";
function seen() {
  try {
    const s = JSON.parse(localStorage.getItem(SEEN_KEY) || "{}");
    return s.day === dayKey(new Date()) ? new Set(s.items || []) : new Set();
  } catch {
    return new Set();
  }
}
function markSeen(id) {
  const s = seen();
  s.add(id);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ day: dayKey(new Date()), items: [...s] }));
  } catch {}
}

function stopAll() {
  cleanup.forEach((f) => f());
  cleanup = [];
}

// ---- the plays -----------------------------------------------------------------

function breathe(slot, done) {
  const phases = [["Breathe in", 4000, 1], ["Hold", 4000, 1], ["Breathe out", 6000, 0]];
  const ring = el("div", { class: "breathe-ring", "aria-hidden": "true" });
  const label = el("p", { class: "breathe-label", "aria-live": "polite" });
  const left = el("p", { class: "faint num" });
  slot.replaceChildren(el("div", { class: "breathe" }, [ring, label, left]));
  const end = Date.now() + 60000;
  let i = 0;
  let timer;
  const stepFn = () => {
    if (Date.now() >= end) {
      label.textContent = "That's a minute. Welcome back.";
      ring.style.transform = "scale(0.6)";
      left.textContent = "";
      done();
      return;
    }
    const [text, ms, grow] = phases[i % phases.length];
    label.textContent = text;
    ring.style.transitionDuration = reducedMotion() ? "0ms" : `${ms}ms`;
    ring.style.transform = `scale(${grow ? 1 : 0.6})`;
    left.textContent = `${Math.ceil((end - Date.now()) / 1000)} s`;
    i++;
    timer = setTimeout(stepFn, ms);
  };
  ring.style.transform = "scale(0.6)";
  requestAnimationFrame(() => requestAnimationFrame(stepFn));
  cleanup.push(() => clearTimeout(timer));
}

// A small constellation to join, the same for everyone today.
const SHAPES = [
  { name: "The Kite", pts: [[50, 8], [80, 40], [50, 70], [20, 40], [50, 92]] },
  { name: "The Lantern", pts: [[30, 15], [70, 15], [82, 50], [70, 85], [30, 85], [18, 50]] },
  { name: "The Heron", pts: [[15, 80], [35, 60], [50, 30], [62, 12], [78, 20], [70, 45], [88, 70]] },
  { name: "The Paper Boat", pts: [[10, 60], [90, 60], [75, 85], [25, 85], [50, 20]] },
  { name: "The Comet", pts: [[85, 15], [65, 35], [48, 52], [32, 66], [18, 78], [26, 88], [12, 92]] },
];

function starlink(slot, done, dayNum) {
  const shape = SHAPES[dayNum % SHAPES.length];
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("class", "starlink");
  svg.setAttribute("role", "group");
  svg.setAttribute("aria-label", `Join the stars in order, 1 to ${shape.pts.length}`);
  const lines = document.createElementNS(NS, "g");
  svg.append(lines);
  const status = el("p", { class: "faint", "aria-live": "polite", text: "Tap star 1." });
  let next = 0;
  shape.pts.forEach(([x, y], i) => {
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "sl-star");
    g.setAttribute("tabindex", "0");
    g.setAttribute("role", "button");
    g.setAttribute("aria-label", `Star ${i + 1}`);
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", x);
    c.setAttribute("cy", y);
    c.setAttribute("r", "3.2");
    const hit = document.createElementNS(NS, "circle");
    hit.setAttribute("cx", x);
    hit.setAttribute("cy", y);
    hit.setAttribute("r", "8");
    hit.setAttribute("class", "sl-hit");
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", x + 4.5);
    t.setAttribute("y", y - 4);
    t.textContent = String(i + 1);
    g.append(hit, c, t);
    const press = () => {
      if (i !== next) {
        status.textContent = `That's star ${i + 1}. Look for ${next + 1}.`;
        return;
      }
      g.classList.add("lit");
      if (i > 0) {
        const [px, py] = shape.pts[i - 1];
        const l = document.createElementNS(NS, "line");
        l.setAttribute("x1", px);
        l.setAttribute("y1", py);
        l.setAttribute("x2", x);
        l.setAttribute("y2", y);
        lines.append(l);
      }
      next++;
      if (next === shape.pts.length) {
        status.textContent = `${shape.name}. Nobody else named it that — today, it's yours.`;
        svg.classList.add("complete");
        done();
      } else status.textContent = `Now star ${next + 1}.`;
    };
    g.addEventListener("click", press);
    g.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), press()));
    svg.append(g);
  });
  slot.replaceChildren(el("div", { class: "starlink-wrap" }, [svg, status]));
}

function listen(slot, done) {
  const before = currentSound();
  playAmbient("orbit");
  setVolume(0.45);
  const left = el("p", { class: "listen-left num" });
  const stop = el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "Stop" });
  slot.replaceChildren(el("div", { class: "listen" }, [el("div", { class: "listen-orbit", "aria-hidden": "true" }, [el("i")]), left, stop]));
  const end = Date.now() + 5 * 60000;
  const timer = setInterval(() => {
    const s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    left.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    if (!s) finish();
  }, 500);
  left.textContent = "5:00";
  const finish = () => {
    clearInterval(timer);
    playAmbient(before === "orbit" ? "off" : before);
    left.textContent = "Done. Five quiet minutes.";
    stop.remove();
    done();
  };
  stop.addEventListener("click", finish);
  cleanup.push(() => {
    clearInterval(timer);
    if (currentSound() === "orbit") playAmbient("off");
  });
}

// ---- the page --------------------------------------------------------------------

function card({ id, label, tone, title, hint, reveal }) {
  const opened = seen().has(id);
  const body = el("div", { class: "drift-body" });
  const btn = el("button", { type: "button", class: "btn btn-toned btn-sm", text: opened ? "Again" : "Open", "aria-expanded": "false" });
  const node = el("section", { class: `drift-card ${tone}${opened ? " opened" : ""}`, "aria-label": label }, [el("p", { class: "kicker toned", text: label }), el("h2", { text: title }), hint ? el("p", { class: "faint drift-hint", text: hint }) : null, body, btn]);
  btn.addEventListener("click", () => {
    stopAll();
    root.querySelectorAll(".drift-card").forEach((c) => c !== node && c.classList.remove("open"));
    node.classList.add("open", "opened");
    btn.setAttribute("aria-expanded", "true");
    btn.hidden = true;
    reveal(body, () => {
      markSeen(id);
      renderClosing();
    });
  });
  return node;
}

function renderClosing() {
  const s = seen();
  const closing = root.querySelector(".drift-closing");
  if (s.size < 3) {
    closing.hidden = true;
    return;
  }
  closing.hidden = false;
}

export function mount(section) {
  root = el("div", { class: "drift" });
  section.append(root);
}

export function show() {
  stopAll();
  const today = pickDrift(new Date(), store.student?.interests || [], LIBRARY);
  const plays = { breathe, starlink, listen };
  const logRest = el("button", {
    type: "button",
    class: "btn btn-toned tone-world btn-sm",
    text: "Log 10 minutes of rest",
    onClick: async (e) => {
      e.currentTarget.disabled = true;
      const { error } = await api.addLog({ kind: "rest", minutes: 10, occurred_on: dayKey(new Date()), note: "Drift" });
      if (error) {
        e.currentTarget.disabled = false;
        return reportError(error);
      }
      showToast("Logged. A little more green on your world.", "success");
    },
  });
  root.replaceChildren(
    el("div", { class: "s-head" }, [
      el("div", {}, [
        el("p", { class: "kicker toned tone-drift", text: "Drift" }),
        el("h1", { text: "Recover, discover, return." }),
        el("p", { class: "s-sub", text: "Three small things for today. No feed, nothing to scroll — when they're done, the door closes until midnight." }),
      ]),
    ]),
    el("div", { class: "drift-row" }, [
      card({ id: "fact", label: "Something true", tone: "tone-focus", title: "A thing to know", hint: `About ${today.fact.tags.map((t) => LIBRARY_TAG[t] || t).slice(0, 2).join(" and ").toLowerCase()}. Ten seconds to read.`, reveal: (b, done) => (b.replaceChildren(el("p", { class: "drift-fact serif", text: today.fact.text })), done()) }),
      card({ id: "prompt", label: "Something to make", tone: "tone-drift", title: "A thing to make", hint: "A two-minute prompt. Any scrap of paper will do.", reveal: (b, done) => (b.replaceChildren(el("p", { class: "drift-prompt", text: today.prompt.text }), el("p", { class: "faint", text: "Made it? Log it from World as “Making something” — it lights your aurora." })), done()) }),
      card({ id: "play", label: "Something to play", tone: "tone-world", title: today.play.title, hint: today.play.text, reveal: (b, done) => { const slot = el("div", { class: "play-slot" }); b.replaceChildren(slot); plays[today.play.id](slot, done, today.day); } }),
    ]),
    el("section", { class: "drift-closing", hidden: "" }, [
      el("p", { class: "serif drift-end", text: "That's today's drift." }),
      el("p", { class: "muted", text: "New things arrive at midnight. Until then, the rest of your universe is waiting." }),
      el("div", { class: "chips" }, [logRest, el("a", { class: "btn btn-primary btn-sm", href: "#/now", text: "Return to Now" })]),
    ])
  );
  renderClosing();
}

export function hide() {
  stopAll();
}

export function destroy() {
  stopAll();
}
