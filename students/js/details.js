// Details: the small motions that make the app feel made, each in the
// language of the look you chose (js/looks.js, css/details.css).
//
//   - The nav's marker glides to where you're going instead of jumping
//     (a glass pill, a red dot, a line of light; Verse keeps its torn
//     paper tab, which slams into place).
//   - A press answers where your finger landed: a bloom of light, a ring
//     of LEDs, a comic burst, a lens ring.
//   - Ticking a task off plays a moment at the box: motes of light,
//     scattering pixels, a lettered DONE!, a streak towards the stars.
//     (In the Study Room, only a quiet ring.)
//   - Numbers count up when a page arrives and roll when they change.
//   - Cards lean towards the pointer (where there is one).
//
// None of it runs with reduced motion; nothing is a reward loop -- it is
// only the app answering what you did.
import { reducedMotion } from "./motion.js";
import { el } from "./ui.js";

const look = () => document.documentElement.dataset.look || "glass";
const still = () => reducedMotion();
const quiet = () => document.body.dataset.view === "study";

let stops = [];

export function startDetails() {
  if (stops.length) return;
  stops = [navInk(), presses(), taskDone(), counters(), lean(), below(), readLine()];
}

export function stopDetails() {
  stops.forEach((f) => f?.());
  stops = [];
}

// ---- The nav's marker ------------------------------------------------------------------

function navInk() {
  const pairs = [...document.querySelectorAll(".bar-nav, .dock")].map((nav) => {
    const ink = el("i", { class: "nav-ink", "aria-hidden": "true" });
    nav.append(ink);
    return [nav, ink];
  });
  const root = document.documentElement;
  root.classList.add("has-ink");
  let raf = 0;
  const place = (instant = false) => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      for (const [nav, ink] of pairs) {
        const a = nav.querySelector('[aria-current="page"]');
        if (!a || !nav.getClientRects().length) {
          ink.classList.remove("on");
          continue;
        }
        const n = nav.getBoundingClientRect();
        const b = a.getBoundingClientRect();
        const was = ink.classList.contains("on");
        ink.classList.toggle("instant", instant || still() || !was);
        ink.style.width = `${b.width.toFixed(1)}px`;
        ink.style.transform = `translate3d(${(b.left - n.left).toFixed(1)}px, 0, 0)`;
        ink.classList.add("on");
        // On its way: each look's marker travels in its own manner (a
        // sheen across the glass, a dot stretching into a dash...).
        if (was && !instant && !still()) {
          ink.classList.remove("go");
          void ink.offsetWidth;
          ink.classList.add("go");
        }
      }
    });
  };
  const onRoute = () => place(false);
  const onLayout = () => place(true);
  window.addEventListener("panalo:arrive", onRoute);
  window.addEventListener("hashchange", onRoute);
  window.addEventListener("resize", onLayout);
  window.addEventListener("panalo:look", onLayout);
  // Widths change when a look's fonts arrive.
  const fontTimer = setTimeout(onLayout, 900);
  document.fonts?.ready.then(onLayout).catch(() => {});
  document.fonts?.addEventListener?.("loadingdone", onLayout);
  const ro = "ResizeObserver" in window ? new ResizeObserver(onLayout) : null;
  pairs.forEach(([nav]) => ro?.observe(nav));
  place(true);
  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(fontTimer);
    window.removeEventListener("panalo:arrive", onRoute);
    window.removeEventListener("hashchange", onRoute);
    window.removeEventListener("resize", onLayout);
    window.removeEventListener("panalo:look", onLayout);
    document.fonts?.removeEventListener?.("loadingdone", onLayout);
    ro?.disconnect();
    pairs.forEach(([, ink]) => ink.remove());
    root.classList.remove("has-ink");
  };
}

// ---- A press -------------------------------------------------------------------------

const PRESSABLE = ".btn, .chip, .icon-btn, .bar-nav a, .dock a, .dock button, .look-opt, .now-list a, .warp-btn, .look-btn, .me-btn, .link-btn, .sig-item, .look-menu button";

function presses() {
  const onDown = (e) => {
    if (still() || (e.button ?? 0) > 0) return;
    const t = e.target.closest?.(PRESSABLE);
    if (!t || t.disabled || t.getAttribute("aria-disabled") === "true") return;
    const fx = el("i", { class: `press-fx press-${look()}`, "aria-hidden": "true" });
    fx.style.left = `${e.clientX}px`;
    fx.style.top = `${e.clientY}px`;
    const tone = getComputedStyle(t).getPropertyValue("--tone").trim();
    if (tone) fx.style.setProperty("--fx", tone);
    document.body.append(fx);
    setTimeout(() => fx.remove(), 800);
  };
  document.addEventListener("pointerdown", onDown, { passive: true, capture: true });
  return () => document.removeEventListener("pointerdown", onDown, { capture: true });
}

// ---- A task, done ---------------------------------------------------------------------

function taskDone() {
  const onChange = (e) => {
    const box = e.target;
    if (!(box instanceof HTMLInputElement) || box.type !== "checkbox" || !box.checked || !box.closest(".task")) return;
    if (still()) return;
    const r = box.getBoundingClientRect();
    const kind = quiet() ? "quiet" : look();
    const fx = el("div", { class: `done-fx done-${kind}`, "aria-hidden": "true" });
    fx.style.left = `${r.left + r.width / 2}px`;
    fx.style.top = `${r.top + r.height / 2}px`;
    fx.append(el("i", { class: "done-ring" }));
    if (kind !== "quiet") {
      const n = kind === "signal" ? 8 : 10;
      for (let i = 0; i < n; i++) {
        const p = el("i", { class: "done-bit" });
        const a = kind === "signal" ? i * 45 : (i / n) * 360 + Math.random() * 24 - 12;
        p.style.setProperty("--a", `${a.toFixed(1)}deg`);
        p.style.setProperty("--d", `${(kind === "signal" ? 30 : 26 + Math.random() * 22).toFixed(1)}px`);
        p.style.setProperty("--t", `${(Math.random() * 120).toFixed(0)}ms`);
        fx.append(p);
      }
      if (kind === "verse") fx.append(el("b", { class: "done-word", text: "DONE!" }));
      if (kind === "odyssey") fx.append(el("i", { class: "done-streak" }));
    }
    document.body.append(fx);
    setTimeout(() => fx.remove(), 1300);
  };
  document.addEventListener("change", onChange, true);
  return () => document.removeEventListener("change", onChange, true);
}

// ---- Numbers --------------------------------------------------------------------------
// Pages re-render whole panels, so a number's "slot" is remembered by where
// it sits (its page, its panel's heading, its place in the panel), not by
// its element. Only plain numbers ("45 min", "6 msg") roll; "1 h 20 min"
// is left alone.

const NUMS = ".num, .now-big b";
const ONE_NUMBER = /^(\D*?)(\d+)(\D*)$/;

function counters() {
  const main = document.getElementById("main");
  if (!main) return null;
  const seen = new Map(); // slot -> last value shown
  let arrivedAt = 0;
  let surface = "";
  const slotOf = (e) => {
    const sec = e.closest(".surface");
    const panel = e.closest(".panel, section");
    const head = panel?.querySelector("h2, h3")?.textContent || "";
    const list = panel ? [...panel.querySelectorAll(NUMS)] : [];
    return `${sec?.dataset.surface}|${head}|${list.indexOf(e)}`;
  };
  const roll = (e, from, to, pre, post) => {
    const t0 = performance.now();
    const dur = Math.min(700, 360 + Math.abs(to - from) * 8);
    e.classList.add("num-rolling");
    e.dataset.rolling = "1";
    const step = (t) => {
      const q = Math.min(1, (t - t0) / dur);
      const k = 1 - (1 - q) ** 3;
      e.textContent = `${pre}${Math.round(from + (to - from) * k)}${post}`;
      if (q < 1 && e.isConnected) requestAnimationFrame(step);
      else {
        delete e.dataset.rolling;
        e.classList.remove("num-rolling");
        e.classList.add("num-landed");
        setTimeout(() => e.classList.remove("num-landed"), 500);
      }
    };
    requestAnimationFrame(step);
  };
  const visit = (e) => {
    if (e.dataset.rolling || e.children.length) return;
    const m = (e.textContent || "").trim().match(ONE_NUMBER);
    if (!m) return;
    const to = Number(m[2]);
    const slot = slotOf(e);
    const prev = seen.get(slot);
    seen.set(slot, to);
    if (still() || quiet()) return;
    if (prev === undefined) {
      // First sight of this number: count up, if the page just arrived.
      if (to > 0 && to < 100000 && performance.now() - arrivedAt < 1500) roll(e, 0, to, m[1], m[3]);
    } else if (prev !== to) roll(e, prev, to, m[1], m[3]);
  };
  const scan = (node) => {
    if (!(node instanceof Element)) return;
    if (node.matches(NUMS)) visit(node);
    node.querySelectorAll?.(NUMS).forEach(visit);
  };
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") {
        const host = m.target.parentElement;
        if (host?.matches(NUMS)) visit(host);
      } else m.addedNodes.forEach(scan);
    }
  });
  mo.observe(main, { subtree: true, childList: true, characterData: true });
  const onArrive = (ev) => {
    arrivedAt = performance.now();
    if (ev.detail?.name !== surface) {
      surface = ev.detail?.name;
      // Count this page's numbers up again on each visit.
      for (const k of [...seen.keys()]) if (k.startsWith(`${surface}|`)) seen.delete(k);
      requestAnimationFrame(() => document.querySelector(`.surface[data-surface="${surface}"]`)?.querySelectorAll(NUMS).forEach(visit));
    }
  };
  window.addEventListener("panalo:arrive", onArrive);
  return () => {
    mo.disconnect();
    window.removeEventListener("panalo:arrive", onArrive);
  };
}

// ---- How far down the page you are ---------------------------------------------------
// A line under the bar that fills as you scroll (drawn by the browser on
// the scroll position itself: css/details.css).

function readLine() {
  const line = el("i", { class: "read-line", "aria-hidden": "true" });
  document.getElementById("app")?.append(line);
  return () => line.remove();
}

// ---- Panels below the fold ------------------------------------------------------------
// Only panels that start out of view rise in as you scroll to them
// (css/details.css): one already on screen must never fade back out.

function below() {
  const mark = (name) => {
    const sec = document.querySelector(`.surface[data-surface="${name}"]`);
    if (!sec) return;
    const H = window.innerHeight;
    sec.querySelectorAll(".panel").forEach((p) => p.classList.toggle("below", p.getBoundingClientRect().top > H - 40));
  };
  let timers = [];
  const onArrive = (e) => {
    const name = e.detail?.name;
    timers.forEach(clearTimeout);
    // Now, and again once a first visit's content has arrived.
    timers = [0, 450].map((ms) => setTimeout(() => mark(name), ms));
  };
  window.addEventListener("panalo:arrive", onArrive);
  return () => {
    timers.forEach(clearTimeout);
    window.removeEventListener("panalo:arrive", onArrive);
  };
}

// ---- Cards lean towards the pointer ----------------------------------------------------

const LEANS = ".drift-card, .look-opt, .systems li";

function lean() {
  if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) return null;
  let card = null;
  let raf = 0;
  let last = null;
  const reset = () => {
    if (!card) return;
    card.style.removeProperty("--rx");
    card.style.removeProperty("--ry");
    card.classList.remove("leaning");
    card = null;
  };
  const onMove = (e) => {
    last = e;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const t = still() || !["glass", "odyssey"].includes(look()) ? null : last.target.closest?.(LEANS);
      if (t !== card) reset();
      if (!t) return;
      card = t;
      const b = t.getBoundingClientRect();
      const x = (last.clientX - b.left) / b.width - 0.5;
      const y = (last.clientY - b.top) / b.height - 0.5;
      t.style.setProperty("--rx", `${(-y * 6).toFixed(2)}deg`);
      t.style.setProperty("--ry", `${(x * 8).toFixed(2)}deg`);
      t.classList.add("leaning");
    });
  };
  document.addEventListener("pointermove", onMove, { passive: true });
  document.addEventListener("pointerleave", reset);
  return () => {
    cancelAnimationFrame(raf);
    reset();
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerleave", reset);
  };
}
