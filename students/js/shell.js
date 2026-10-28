// The inside of Panalo Students: routing between surfaces, the top bar,
// the phone dock, the account menu, and Warp (Ctrl/⌘K).
//
// Surfaces load on first visit (dynamic import), so opening the app costs
// the Now screen and nothing else.
import { el, openSheet, showToast, getPrefs } from "./ui.js";
import { store, on, emit } from "./store.js";
import { clockTime, setClock12 } from "./model/time.js";
import { state } from "../../src/state.js";
import { settleTimer } from "./timer-state.js";
import { startFocusShield, stopFocusShield, focusing } from "./focus-shield.js";
import { reducedMotion, lively } from "./motion.js";
import { drift, punch, burstOn, calm, comic } from "./fx.js";
import { enter, LOOKS, setLook } from "./looks.js";
import { startDetails, stopDetails } from "./details.js";
import { startModeration, stopModeration } from "./moderation-badge.js";
import { startSync, stopSync } from "./sync.js";
import { rulesReminder } from "./rules-reminder.js";
import { maybeDawn, dawnDue } from "./dawn.js";
import { openCheckin, openIntention } from "./checkin.js";
import { checkMomentsSoon } from "./moment.js";
import { VERSION } from "./version.js";
import { art, onArt } from "./art.js";
import { createEmbers } from "./motion-art.js";

const $ = (id) => document.getElementById(id);

const SURFACES = {
  now: () => import("./surfaces/now.js"),
  plan: () => import("./surfaces/plan.js"),
  study: () => import("./surfaces/study.js"),
  world: () => import("./surfaces/world.js"),
  calendar: () => import("./surfaces/calendar.js"),
  archive: () => import("./surfaces/archive.js"),
  safety: () => import("./surfaces/safety.js"),
  settings: () => import("./surfaces/settings.js"),
  moderate: () => import("./surfaces/moderate.js"),
};
const TITLES = { now: "Now", plan: "Plan", study: "Study Room", world: "World", calendar: "Calendar", archive: "Archive", safety: "Privacy & data", settings: "Settings", moderate: "Moderation" };

// Each surface's colour, for the ink that wipes across when you arrive.
const TONES = { now: "#ffc47a", plan: "#9ad8ff", world: "#7ee2a8", calendar: "#ffc47a", archive: "#e7d19b", safety: "#b59cff", settings: "#9ad8ff" };
let ambient = null;

// Where effects belong. The expressive places -- your day and your world --
// get the ink and the drifting petals. Everywhere
// you read, file, plan or configure stays still: effects there were noise.
// The Study Room is the quietest of all (css/surfaces.css).
const EXPRESSIVE = new Set(["now", "world"]);

// Arriving somewhere expressive: an ink slash in that surface's colour, and
// its parts cut in one after another. Never with reduced motion.
//
// Every surface arrives in the look's own way (js/looks.js): Glass out of a
// soft focus, Signal dot by dot, Verse in a glitch with its panels slammed
// down. The Study Room just appears. In Verse, the expressive places also
// get the ink slash in their colour.
function arrive(name, section) {
  // Anything that follows the page you're on (js/details.js) hears it here.
  window.dispatchEvent(new CustomEvent("panalo:arrive", { detail: { name } }));
  ambient?.setPaused(!EXPRESSIVE.has(name) || !lively());
  embersFollow(name);
  if (reducedMotion() || name === "study") return;
  enter(section);
  if (!EXPRESSIVE.has(name) || !comic()) return;
  const wipe = el("div", { class: "fx-wipe", "aria-hidden": "true", style: `--wipe:${TONES[name] || "#9ad8ff"}` }, [el("i"), el("i")]);
  document.body.append(wipe);
  setTimeout(() => wipe.remove(), 800);
}

const mounted = new Map(); // name -> module
const loading = new Map(); // name -> pending import
let current = null;
let hooks = {};
let clockTimer = null;
let settleTimerId = null;
let active = false;

function parseRoute() {
  const m = location.hash.match(/^#\/([a-z]+)(?:\/(.*))?$/);
  const name = m && SURFACES[m[1]] ? m[1] : "now";
  return { name, param: m && m[2] ? decodeURIComponent(m[2]) : null };
}

async function route() {
  if (!active) return;
  const { name, param } = parseRoute();
  const section = document.querySelector(`section[data-surface="${name}"]`);
  document.querySelectorAll("[data-route]").forEach((a) => {
    if (a.dataset.route === name) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  document.body.dataset.view = name;
  document.title = `${TITLES[name]} · Panalo Students`;

  if (current && current !== name) {
    const prev = mounted.get(current);
    prev?.hide?.();
    document.querySelector(`section[data-surface="${current}"]`).hidden = true;
  }
  const arriving = current !== name;
  current = name;
  section.hidden = false;
  if (arriving) arrive(name, section);

  let mod = mounted.get(name);
  if (!mod) {
    // Two routes racing for the same surface share one load and one mount.
    if (loading.has(name)) return; // the route already loading it will show it
    section.replaceChildren(el("div", { class: "surface-loading" }, [el("div", { class: "loading-line" })]));
    const load = SURFACES[name]();
    loading.set(name, load.catch(() => null));
    try {
      mod = await load;
    } catch (e) {
      loading.delete(name);
      console.error(e);
      section.replaceChildren(el("div", { class: "empty" }, [el("h3", { text: "This part didn't load." }), el("p", { text: "Check your connection and try again." }), el("button", { class: "btn btn-ghost", type: "button", text: "Retry", onClick: () => route() })]));
      return;
    }
    loading.delete(name);
    section.replaceChildren();
    mod.mount(section, { navigate, signOut: hooks.signOut, editSetup: hooks.editSetup });
    mounted.set(name, mod);
    if (current !== name) return; // navigated away while loading
    // Show what the address says NOW: another route may have arrived while
    // this one was loading the surface.
    mod.show?.(parseRoute().param);
    return;
  }
  mod.show?.(param);
}

export function navigate(path) {
  if (location.hash === `#/${path}`) route();
  else location.hash = `#/${path}`;
}

// Display preferences that apply everywhere: the clock's format and the
// size of text. Applied on entry, and again whenever preferences change
// (Settings here, or another device).
let lastClock12 = null;
// The painted wallpaper (art.js) behind Now and Plan, when it exists.
// Embers rise over it (motion-art.js): moving only with Lively effects,
// on Now and Plan; a still frame otherwise.
let embers = null;
const WALL_VIEWS = new Set(["now", "plan"]);
function wallpaper() {
  let w = document.getElementById("wall");
  if (!w) {
    w = el("div", { id: "wall", class: "wall", "aria-hidden": "true" });
    document.body.prepend(w);
  }
  if (!embers) {
    embers = createEmbers({ animate: false });
    w.append(embers.canvas);
  }
  onArt(() => {
    const wide = art("wall-wide");
    const tall = art("wall-tall") || wide;
    if (!wide && !tall) return;
    // Absolute: a url() inside a custom property resolves against the
    // stylesheet that uses it (css/), not this page.
    const abs = (u) => new URL(u, location.href).href;
    w.classList.add("painted");
    w.style.setProperty("--wall-wide", `url("${abs(wide || tall)}")`);
    w.style.setProperty("--wall-tall", `url("${abs(tall)}")`);
  });
}
function embersFollow(name) {
  embers?.setAnimate(lively() && WALL_VIEWS.has(name || document.body.dataset.view));
}

export function applyDisplayPrefs() {
  const p = getPrefs();
  setClock12(p.clock12);
  // Every time on screen follows the clock format: redraw what's open.
  if (lastClock12 !== null && lastClock12 !== !!p.clock12) emit("display");
  lastClock12 = !!p.clock12;
  document.documentElement.setAttribute("data-effects", p.effects === "lively" ? "lively" : "calm");
  ambient?.setPaused(!lively() || !EXPRESSIVE.has(document.body.dataset.view));
  embersFollow();
  const size = ["small", "large", "larger"].includes(p.textSize) ? p.textSize : null;
  if (size) document.documentElement.setAttribute("data-text", size);
  else document.documentElement.removeAttribute("data-text");
  const box = $("bar-clock");
  if (box) delete box.dataset.text;
  if (active) tickClock();
}
document.addEventListener("panalo:prefs", () => applyDisplayPrefs());

// Keyboard: g then a letter goes to a page; ? lists every shortcut.
const GO_KEYS = { n: "now", p: "plan", s: "study", w: "world", c: "calendar", a: "archive", y: "safety", ",": "settings" };
let goArmed = 0;
export function openShortcuts() {
  const row = (keys, what) => el("li", {}, [el("span", { class: "keys" }, keys.map((k) => el("kbd", { text: k }))), el("span", { text: what })]);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || "");
  openSheet({
    title: "Keyboard shortcuts",
    form: false,
    body: [
      el("ul", { class: "shortcuts" }, [
        row([mac ? "⌘" : "Ctrl", "K"], "Warp: jump anywhere, do anything"),
        row(["g", "n"], "Now"),
        row(["g", "p"], "Plan"),
        row(["g", "s"], "Study Room"),
        row(["g", "w"], "World"),
        row(["g", "c"], "Calendar"),
        row(["g", "a"], "Archive"),
        row(["g", "y"], "Privacy & data"),
        row(["g", ","], "Settings"),
        row(["/"], "Search (Archive)"),
        row(["Space"], "Start or pause a focus block (Study Room)"),
        row(["?"], "This list"),
      ]),
    ],
    actions: [{ label: "Done", kind: "btn-primary" }],
  });
}
const typing = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

// The clock in the bar: hours and minutes, with a colon a look can blink.
function tickClock() {
  const text = clockTime(Date.now());
  const i = text.indexOf(":");
  const box = $("bar-clock");
  if (box.dataset.text === text) return;
  box.dataset.text = text;
  if (i < 0) box.textContent = text;
  else box.replaceChildren(text.slice(0, i), el("span", { class: "clock-colon", text: ":" }), text.slice(i + 1));
}

function renderMe() {
  const name = state.currentUsername || "you";
  $("me-initial").textContent = name.slice(0, 1).toUpperCase();
  $("me-name").textContent = `@${name}`;
  $("me-world").textContent = store.student?.world_name ? ` · ${store.student.world_name}` : "";
}

function toggleMeMenu(open) {
  const menu = $("me-menu");
  const btn = $("me-open");
  const show = open ?? menu.hidden;
  menu.hidden = !show;
  btn.setAttribute("aria-expanded", String(show));
  if (show) menu.querySelector("a, button")?.focus();
}

// ---- Warp: jump anywhere, do common things, by typing --------------------

function warpItems() {
  const go = (p) => () => navigate(p);
  return [
    { label: "Now", hint: "your day at a glance", run: go("now") },
    { label: "Plan", hint: "your week, subjects and results", run: go("plan") },
    { label: "Study Room", hint: "focus timer and tasks", run: go("study") },
    { label: "Start a 25-minute focus", hint: "Study Room", run: () => navigate("study/start-25") },
    ...(store.entriesMissing ? [] : [
      { label: "Close the day", hint: "mood, what you did, what you learned", run: () => openCheckin() },
      { label: "Set today's intention", hint: "the one thing for today", run: () => openIntention() },
      { label: "Journal", hint: "World · the days you've kept", run: () => navigate("world/journal") },
    ]),
    ...LOOKS.map((l) => ({ label: `Look: ${l.name}`, hint: l.line, run: () => setLook(l.id) })),
    { label: "Add a task", hint: "Study Room", run: () => navigate("study/add-task") },
    { label: "World", hint: "your world, goals, discoveries", run: go("world") },
    { label: "Calendar", hint: "timetable and deadlines", run: go("calendar") },
    { label: "Add to calendar", hint: "Calendar", run: () => navigate("calendar/add") },
    { label: "Archive", hint: "your files", run: go("archive") },
    { label: "Upload a file", hint: "Archive", run: () => navigate("archive/upload") },
    { label: "Privacy & data", hint: "what's stored, export, delete", run: go("safety") },
    { label: "Settings", hint: "motion, study defaults, account", run: go("settings") },
    { label: "Keyboard shortcuts", hint: "press ? anywhere", run: () => openShortcuts() },
  ];
}

function openWarp() {
  if (document.querySelector("dialog.warp")) return;
  const input = el("input", { type: "text", class: "input warp-input", placeholder: "Where to?", "aria-label": "Warp to", autocomplete: "off", role: "combobox", "aria-expanded": "true", "aria-controls": "warp-list" });
  const list = el("ul", { class: "warp-list", id: "warp-list", role: "listbox" });
  let items = warpItems();
  let sel = 0;
  const sheet = openSheet({ title: "Warp", body: [input, list], form: false });
  sheet.dialog.classList.add("warp");
  const render = () => {
    const q = input.value.trim().toLowerCase();
    items = warpItems().filter((it) => !q || it.label.toLowerCase().includes(q) || it.hint.toLowerCase().includes(q));
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.replaceChildren(
      ...items.map((it, i) =>
        el(
          "li",
          { role: "option", id: `warp-${i}`, "aria-selected": String(i === sel), onClick: () => run(i) },
          [el("span", { text: it.label }), el("small", { text: it.hint })]
        )
      )
    );
    input.setAttribute("aria-activedescendant", items.length ? `warp-${sel}` : "");
  };
  const run = (i) => {
    const it = items[i];
    if (!it) return;
    sheet.close();
    it.run();
  };
  input.addEventListener("input", () => {
    sel = 0;
    render();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { sel = Math.min(items.length - 1, sel + 1); render(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    else if (e.key === "Enter") { run(sel); e.preventDefault(); }
  });
  render();
  input.focus();
}

function openMore() {
  const link = (path, label, tone, sub) =>
    el("a", { href: `#/${path}`, class: `more-link ${tone}`, onClick: () => sheet.close() }, [el("b", { text: label }), el("small", { text: sub })]);
  const sheet = openSheet({
    title: "Everything else",
    form: false,
    body: [
      el("nav", { class: "more-grid", "aria-label": "More destinations" }, [
        link("archive", "Archive", "tone-archive", "Your files"),
        link("safety", "Privacy & data", "tone-signal", "What's stored, export, delete"),
        link("settings", "Settings", "tone-focus", "Motion, study, account"),
      ]),
      el("p", { class: "more-version", text: `Panalo Students v${VERSION}` }),
    ],
  });
}

function schemaBanner() {
  if (!store.schemaMissing || document.querySelector(".schema-banner")) return;
  $("main").prepend(
    el("div", { class: "schema-banner", role: "status" }, [
      el("b", { text: "This Panalo hasn't been upgraded for Students yet." }),
      el("span", { text: " Study data and files can't be saved until whoever runs it applies supabase-phase16.sql." }),
    ])
  );
}

export function initShell(h) {
  hooks = h;
  window.addEventListener("hashchange", () => {
    if (active && location.hash.startsWith("#/")) route();
  });
  $("warp-open").addEventListener("click", openWarp);
  $("dock-more").addEventListener("click", openMore);
  $("me-open").addEventListener("click", () => toggleMeMenu());
  $("signout-btn").addEventListener("click", () => {
    toggleMeMenu(false);
    hooks.signOut();
  });
  $("me-menu").addEventListener("click", (e) => {
    if (e.target.closest("a")) toggleMeMenu(false);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!$("me-menu").hidden && !e.target.closest("#me-menu, #me-open")) toggleMeMenu(false);
  });
  document.addEventListener("keydown", (e) => {
    if (!active) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openWarp();
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target) && !document.querySelector("dialog[open]")) {
      if (e.key === "?") {
        e.preventDefault();
        openShortcuts();
      } else if (goArmed && Date.now() - goArmed < 1500 && GO_KEYS[e.key.toLowerCase()]) {
        e.preventDefault();
        goArmed = 0;
        navigate(GO_KEYS[e.key.toLowerCase()]);
      } else goArmed = e.key.toLowerCase() === "g" ? Date.now() : 0;
    } else if (e.key === "Escape" && !$("me-menu").hidden) {
      toggleMeMenu(false);
      $("me-open").focus();
    }
  });
  if (!/Mac|iPhone|iPad/.test(navigator.platform || "")) document.querySelector(".warp-btn kbd").textContent = "Ctrl K";
  // Primary actions land with a small hit -- only where effects belong, and
  // never on plain navigation.
  document.addEventListener("pointerdown", (e) => {
    if (!active || calm() || !EXPRESSIVE.has(current)) return;
    const b = e.target.closest?.("#app .stage .btn-primary");
    if (!b) return;
    punch(b);
    burstOn(b, { count: 14, dur: 300 });
  });
  on("student", renderMe);
}

export async function enterShell({ firstTime = false } = {}) {
  const wasActive = active;
  active = true;
  $("app").hidden = false;
  $("landing").hidden = true;
  $("auth").hidden = true;
  renderMe();
  wallpaper();
  schemaBanner();
  if (!wasActive) {
    // Petals and embers drifting behind everything (paused in the Study Room).
    if (!reducedMotion() && !ambient) {
      // Made even when calm (paused), so choosing Lively starts it at once.
      const c = el("canvas", { class: "fx-ambient", "aria-hidden": "true" });
      $("app").prepend(c);
      ambient = drift(c, { count: 12, wind: 0.5 });
    }
    applyDisplayPrefs();
    tickClock();
    clockTimer = setInterval(tickClock, 15000);
    startDetails();
    startFocusShield();
    startModeration();
    startSync();
    // A focus block that ended while the app was elsewhere still counts.
    const settle = () => document.body.dataset.view !== "study" && settleTimer(Date.now(), { clear: true }).then((r) => r?.minutes && showToast(`Focus session finished — ${r.minutes} min recorded.`, "success"));
    settle();
    settleTimerId = setInterval(settle, 20000);
  }
  // Changing the hash routes (hashchange); only route by hand when it
  // doesn't change, or the surface would be shown twice.
  // Straight after the setup, the plan: its check-ins come next.
  const target = location.hash.startsWith("#/") ? location.hash : firstTime ? "#/plan" : "#/now";
  if (location.hash !== target) location.hash = target;
  else await route();
  if (firstTime) showToast("Welcome to your universe. Press Warp (Ctrl K) to go anywhere.", "success");
  // The first open of each day: the dawn (not on the day of the setup;
  // the open is still recorded). A focus block running
  // (started on another device, say) comes first: they wait for the next
  // time the app comes into view after it.
  if (!focusing()) {
    await maybeDawn({ quiet: firstTime }).catch((e) => console.error(e));
  }
  rulesReminder({ firstTime });
  // Discoveries reached since last time, then whenever something changes.
  checkMomentsSoon(firstTime ? 6000 : 900);
  if (!wasActive) on("any", () => checkMomentsSoon());
}

// Left open overnight: the next morning still gets its dawn.
document.addEventListener("visibilitychange", () => {
  if (active && !document.hidden && !focusing() && dawnDue()) maybeDawn().catch((e) => console.error(e));
});

export function leaveShell() {
  active = false;
  stopDetails();
  stopFocusShield();
  clearInterval(clockTimer);
  clearInterval(settleTimerId);
  stopModeration();
  stopSync();
  for (const [, mod] of mounted) mod.destroy?.();
  mounted.clear();
  document.querySelectorAll("[data-surface]").forEach((s) => {
    s.hidden = true;
    s.replaceChildren();
  });
  document.querySelector(".schema-banner")?.remove();
  current = null;
  ambient?.destroy();
  ambient = null;
  document.querySelector(".fx-ambient")?.remove();
  $("app").hidden = true;
}
