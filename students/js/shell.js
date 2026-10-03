// The inside of Panalo Students: routing between surfaces, the top bar,
// the phone dock, the account menu, and Warp (Ctrl/⌘K).
//
// Surfaces load on first visit (dynamic import), so opening the app costs
// the Now screen and nothing else.
import { el, openSheet, showToast } from "./ui.js";
import { store, on } from "./store.js";
import { clockTime } from "./model/time.js";
import { startPresence, stopPresence } from "../../src/presence.js";
import { state } from "../../src/state.js";
import { startInbox, stopInbox } from "./signals-data.js";
import { settleTimer } from "./timer-state.js";
import { reducedMotion } from "./motion.js";
import { drift, punch, burstOn, calm } from "./fx.js";
import { startModeration, stopModeration } from "./moderation-badge.js";
import { startSync, stopSync } from "./sync.js";

const $ = (id) => document.getElementById(id);

const SURFACES = {
  now: () => import("./surfaces/now.js"),
  study: () => import("./surfaces/study.js"),
  signals: () => import("./surfaces/signals.js"),
  world: () => import("./surfaces/world.js"),
  calendar: () => import("./surfaces/calendar.js"),
  archive: () => import("./surfaces/archive.js"),
  drift: () => import("./surfaces/drift.js"),
  safety: () => import("./surfaces/safety.js"),
  settings: () => import("./surfaces/settings.js"),
  moderate: () => import("./surfaces/moderate.js"),
};
const TITLES = { now: "Now", study: "Study Room", signals: "Signals", world: "World", calendar: "Calendar", archive: "Archive", drift: "Drift", safety: "Safety", settings: "Settings", moderate: "Moderation" };

// Each surface's colour, for the ink that wipes across when you arrive.
const TONES = { now: "#ffc47a", signals: "#b59cff", world: "#7ee2a8", calendar: "#ffc47a", archive: "#e7d19b", drift: "#ff9ec4", safety: "#b59cff", settings: "#9ad8ff" };
let ambient = null;

// Where effects belong. The expressive places -- your day, your world, and
// Drift, which is play -- get the ink and the drifting petals. Everywhere
// you read, file, plan or configure stays still: effects there were noise.
// The Study Room is the quietest of all (css/surfaces.css).
const EXPRESSIVE = new Set(["now", "world", "drift"]);

// Arriving somewhere expressive: an ink slash in that surface's colour, and
// its parts cut in one after another. Never with reduced motion.
function arrive(name, section) {
  ambient?.setPaused(!EXPRESSIVE.has(name));
  if (reducedMotion() || !EXPRESSIVE.has(name)) return;
  const wipe = el("div", { class: "fx-wipe", "aria-hidden": "true", style: `--wipe:${TONES[name] || "#9ad8ff"}` }, [el("i"), el("i")]);
  document.body.append(wipe);
  setTimeout(() => wipe.remove(), 800);
  section.classList.remove("fx-enter");
  void section.offsetWidth;
  section.classList.add("fx-enter");
  clearTimeout(section.fxTimer);
  section.fxTimer = setTimeout(() => section.classList.remove("fx-enter"), 1400);
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
    mod.mount(section, { navigate, signOut: hooks.signOut, replayBirth: hooks.replayBirth });
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

function tickClock() {
  $("bar-clock").textContent = clockTime(Date.now());
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
    { label: "Study Room", hint: "focus timer and tasks", run: go("study") },
    { label: "Start a 25-minute focus", hint: "Study Room", run: () => navigate("study/start-25") },
    { label: "Add a task", hint: "Study Room", run: () => navigate("study/add-task") },
    { label: "Signals", hint: "messages, circles, rooms", run: go("signals") },
    { label: "Join a room with a code", hint: "Signals", run: () => navigate("signals/join") },
    { label: "New conversation", hint: "Signals", run: () => navigate("signals/new") },
    { label: "World", hint: "your world, goals, discoveries", run: go("world") },
    { label: "Log an activity", hint: "World", run: () => navigate("world/log") },
    { label: "Calendar", hint: "timetable and deadlines", run: go("calendar") },
    { label: "Add to calendar", hint: "Calendar", run: () => navigate("calendar/add") },
    { label: "Archive", hint: "your files", run: go("archive") },
    { label: "Upload a file", hint: "Archive", run: () => navigate("archive/upload") },
    { label: "Drift", hint: "three things for today", run: go("drift") },
    { label: "Safety & privacy", hint: "blocking, reports, what's encrypted", run: go("safety") },
    { label: "Settings", hint: "motion, study defaults, account", run: go("settings") },
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
        link("calendar", "Calendar", "tone-time", "Timetable and deadlines"),
        link("archive", "Archive", "tone-archive", "Your files"),
        link("drift", "Drift", "tone-drift", "Three things for today"),
        link("safety", "Safety & privacy", "tone-signal", "Blocking, reports, encryption"),
        link("settings", "Settings", "tone-focus", "Motion, study, account"),
      ]),
    ],
  });
}

function schemaBanner() {
  if (!store.schemaMissing || document.querySelector(".schema-banner")) return;
  $("main").prepend(
    el("div", { class: "schema-banner", role: "status" }, [
      el("b", { text: "This Panalo hasn't been upgraded for Students yet." }),
      el("span", { text: " Study data, files and rooms can't be saved until whoever runs it applies supabase-phase16.sql. Messaging still works." }),
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
  on("unread", () => {
    const n = store.unreadTotal || 0;
    document.querySelectorAll("[data-unread]").forEach((b) => {
      b.hidden = !n;
      b.textContent = n > 99 ? "99+" : String(n);
    });
    document.title = `${n ? `(${n > 99 ? "99+" : n}) ` : ""}${TITLES[current] || "Panalo"} · Panalo Students`;
  });
}

export async function enterShell({ firstTime = false, pendingJoin = null } = {}) {
  const wasActive = active;
  active = true;
  $("app").hidden = false;
  $("landing").hidden = true;
  $("auth").hidden = true;
  renderMe();
  schemaBanner();
  if (!wasActive) {
    // Petals and embers drifting behind everything (paused in the Study Room).
    if (!reducedMotion() && !ambient) {
      const c = el("canvas", { class: "fx-ambient", "aria-hidden": "true" });
      $("app").prepend(c);
      ambient = drift(c, { count: 12, wind: 0.5 });
    }
    tickClock();
    clockTimer = setInterval(tickClock, 15000);
    startPresence(state.currentUser);
    // Signals keeps the unread count live everywhere, so start it now.
    startInbox().catch((e) => console.error(e));
    startModeration();
    startSync();
    // A focus block that ended while the app was elsewhere still counts.
    const settle = () => document.body.dataset.view !== "study" && settleTimer(Date.now(), { clear: true }).then((r) => r?.minutes && showToast(`Focus session finished — ${r.minutes} min recorded.`, "success"));
    settle();
    settleTimerId = setInterval(settle, 20000);
  }
  // Changing the hash routes (hashchange); only route by hand when it
  // doesn't change, or the surface would be shown twice.
  const target = pendingJoin ? `#/signals/join=${encodeURIComponent(pendingJoin)}` : location.hash.startsWith("#/") ? location.hash : "#/now";
  if (location.hash !== target) location.hash = target;
  else await route();
  if (firstTime) showToast("Welcome to your universe. Press Warp (Ctrl K) to go anywhere.", "success");
}

export function leaveShell() {
  active = false;
  clearInterval(clockTimer);
  clearInterval(settleTimerId);
  stopPresence();
  stopInbox();
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
