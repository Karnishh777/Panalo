// Looks: three complete ways Panalo can look and move.
//
//   glass   Cinematic Glass -- frosted, layered panels floating over your
//           world; serif headlines; light that catches edges. Calm, premium.
//   signal  Signal -- pure black, dot-matrix numerals, one red, a strict grid
//           of rounded tiles. Bold, precise, playful.
//   verse   Verse -- the special one: your day laid out in orbit around your
//           world, drawn like a comic book torn between universes. Halftone,
//           offset-print misregistration, ink, caption boxes, glitches,
//           speed lines, motion on twos.
//
// The look is a preference (prefs.look), so it follows you to every device.
// boot.js applies it before the first paint (no flash of the wrong look);
// this module switches it live, with a transition in the new look's style.
import { getPrefs, setPrefs, el } from "./ui.js";
import { reducedMotion } from "./motion.js";

export const LOOKS = [
  {
    id: "glass",
    name: "Glass",
    line: "Frosted, layered and calm.",
    fonts: "family=Instrument+Serif:ital@0;1&family=Geist:wght@300..700&family=Geist+Mono:wght@400;500",
  },
  {
    id: "signal",
    name: "Signal",
    line: "Black, dot-matrix, one red.",
    fonts: "family=Doto:wght@600..900&family=Space+Grotesk:wght@400..700&family=Space+Mono:wght@400;700",
  },
  {
    id: "verse",
    name: "Verse",
    line: "Your day in orbit, drawn like a comic between universes.",
    fonts: "family=Anton&family=Archivo:wdth,wght@62..125,400..900&family=Permanent+Marker&family=Space+Mono:wght@400;700",
  },
];
export const DEFAULT_LOOK = "glass";
const EVENT = "panalo:look";

const byId = (id) => LOOKS.find((l) => l.id === id) || LOOKS[0];

export function getLook() {
  const id = getPrefs().look;
  return LOOKS.some((l) => l.id === id) ? id : DEFAULT_LOOK;
}

/** The fonts a look needs, loaded once each (boot.js loads the first). */
export function loadFonts(id) {
  const look = byId(id);
  if (document.querySelector(`link[data-look-fonts="${look.id}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?${look.fonts}&display=swap`;
  link.dataset.lookFonts = look.id;
  document.head.append(link);
}

/** Put a look on the page now (no saving, no transition). */
export function applyLook(id = getLook()) {
  const look = byId(id);
  loadFonts(look.id);
  if (document.documentElement.dataset.look !== look.id) {
    document.documentElement.dataset.look = look.id;
    window.dispatchEvent(new CustomEvent(EVENT, { detail: look.id }));
  }
}

export function onLook(fn) {
  const h = (e) => fn(e.detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}

/** Choose a look: saved, synced, and switched to with its own transition. */
export function setLook(id) {
  const look = byId(id);
  if (look.id === getLook() && document.documentElement.dataset.look === look.id) return;
  setPrefs({ look: look.id });
  loadFonts(look.id);
  if (reducedMotion()) return applyLook(look.id);
  // The cut: each look arrives in its own way, covering the swap.
  const veil = el("div", { class: `look-cut look-cut-${look.id}`, "aria-hidden": "true" }, [el("i"), el("i"), el("i")]);
  document.body.append(veil);
  setTimeout(() => applyLook(look.id), 260);
  setTimeout(() => veil.remove(), 900);
}

/** A row of the three looks, as radio buttons. compact: names only. */
export function lookPicker({ compact = false, onPick } = {}) {
  const name = `look-${Math.random().toString(36).slice(2, 7)}`;
  const wrap = el("div", { class: `look-picker${compact ? " compact" : ""}`, role: "radiogroup", "aria-label": "Look" });
  const draw = () => {
    const now = getLook();
    wrap.replaceChildren(
      ...LOOKS.map((l) => {
        const input = el("input", { type: "radio", name, value: l.id, class: "sr-only" });
        input.checked = l.id === now;
        input.addEventListener("change", () => {
          setLook(l.id);
          onPick?.(l.id);
        });
        return el("label", { class: `look-opt look-opt-${l.id}` }, [
          input,
          el("span", { class: "look-swatch", "aria-hidden": "true" }, [el("i"), el("i"), el("i")]),
          el("span", { class: "look-text" }, [el("b", { text: l.name }), compact ? null : el("small", { text: l.line })]),
        ]);
      })
    );
  };
  draw();
  const off = onLook(draw);
  wrap.addEventListener("look-picker-destroy", off);
  return wrap;
}

// A Look button opens its menu of the three.
function wireButton(btn, menu) {
  if (!btn || !menu || btn.dataset.wired) return;
  btn.dataset.wired = "1";
  const label = () => {
    const l = byId(getLook());
    btn.dataset.now = l.id;
    btn.querySelector(".look-name").textContent = l.name;
    btn.setAttribute("aria-label", `Look: ${l.name}. Change look`);
  };
  label();
  onLook(label);
  const close = () => {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!menu.hidden) return close();
    menu.replaceChildren(el("p", { class: "kicker", text: "Look" }), lookPicker({ compact: true, onPick: () => setTimeout(close, 150) }));
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    menu.querySelector("input:checked")?.focus();
  });
  menu.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => !menu.hidden && close());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) {
      close();
      btn.focus();
    }
  });
}

// Verse: a sound effect lettered where you press an action.
const SFX = [
  [/begin|start|focus|launch|go\b/i, "GO!"],
  [/save|done|close the day|finish|set/i, "DONE!"],
  [/send|share|post/i, "WHOOSH!"],
  [/join|create|new|add/i, "ZAP!"],
];
const RANDOM_SFX = ["POW!", "BAM!", "WHAM!", "KRAK!", "ZOOM!"];
function sfx(x, y, label) {
  const word = SFX.find(([re]) => re.test(label))?.[1] || RANDOM_SFX[Math.floor(Math.random() * RANDOM_SFX.length)];
  const s = el("div", { class: "verse-sfx", "aria-hidden": "true", style: `left:${x}px;top:${y - 40}px` }, [el("b", { text: word })]);
  document.body.append(s);
  setTimeout(() => s.remove(), 700);
}

let started = false;
/** Once, at start-up: the buttons, the light, the sound effects, sync. */
export function initLooks() {
  applyLook();
  if (started) return;
  started = true;
  wireButton(document.getElementById("look-open"), document.getElementById("look-menu"));
  wireButton(document.getElementById("land-look-open"), document.getElementById("land-look-menu"));
  // Your look changed on another device.
  document.addEventListener("panalo:prefs", () => applyLook());

  // Glass: light catches each panel where the pointer is.
  let raf = 0;
  document.addEventListener("pointermove", (e) => {
    if (document.documentElement.dataset.look !== "glass" || raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const p = e.target.closest?.(".panel");
      if (!p) return;
      const r = p.getBoundingClientRect();
      p.style.setProperty("--mx", `${e.clientX - r.left}px`);
      p.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  }, { passive: true });

  // Verse: rifts in the dark (css), spray paint where the pointer goes, and
  // a label when the world slips into another universe.
  const rifts = el("div", { class: "verse-rifts", "aria-hidden": "true" }, [el("i"), el("i"), el("i"), el("i")]);
  document.body.prepend(rifts);
  initSpray();
  const UNIVERSES = { 2: "U-00 · SIGNAL", 3: "U-1940 · NOIR", 4: "U-8 · 8-BIT" };
  document.addEventListener("universe-slip", (e) => {
    const c = e.target;
    if (!(c instanceof HTMLCanvasElement) || !c.isConnected) return;
    const r = c.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || r.width < 80) return;
    const host = c.parentElement;
    host.classList.remove("slipping");
    void host.offsetWidth;
    host.classList.add("slipping");
    setTimeout(() => host.classList.remove("slipping"), 500);
    const tag = el("div", { class: "universe-tag", "aria-hidden": "true", style: `left:${Math.round(r.left + r.width * 0.62)}px;top:${Math.round(r.top + r.height * 0.12)}px`, text: UNIVERSES[e.detail?.style] || "U-?? · ELSEWHERE" });
    document.body.append(tag);
    setTimeout(() => tag.remove(), 950);
  });

  // Verse: actions land with a lettered sound effect.
  document.addEventListener("click", (e) => {
    if (document.documentElement.dataset.look !== "verse" || reducedMotion()) return;
    if (document.body.dataset.view === "study") return; // the Study Room stays quiet
    const b = e.target.closest?.(".btn-primary, .btn-toned, .fx-cta");
    if (!b) return;
    const r = b.getBoundingClientRect();
    sfx(r.left + r.width / 2, r.top, b.textContent || "");
  });
}

/** A surface arriving: play the look's entrance on it and its panels. */
export function enter(section) {
  if (reducedMotion() || !section) return;
  const index = () => section.querySelectorAll(".panel").forEach((p, i) => p.style.setProperty("--i", String(Math.min(i, 8))));
  index();
  section.classList.remove("look-enter");
  void section.offsetWidth;
  section.classList.add("look-enter");
  // Content may still be arriving (a first visit loads the surface).
  setTimeout(index, 60);
  setTimeout(index, 400);
  clearTimeout(section.lookTimer);
  section.lookTimer = setTimeout(() => section.classList.remove("look-enter"), 1800);
}

// Spray paint: the pointer leaves a mist of pink, cyan and white that fades
// in a moment. Verse only, a mouse or pen only (never a finger), never in
// the Study Room or with reduced motion.
function initSpray() {
  if (!window.matchMedia?.("(pointer: fine)").matches) return;
  let canvas = null;
  let ctx = null;
  let dots = [];
  let raf = 0;
  let last = null;
  const COLS = ["255,46,99", "41,240,255", "247,244,255"];
  const on = () => document.documentElement.dataset.look === "verse" && !reducedMotion() && document.body.dataset.view !== "study" && document.body.classList.contains("in-app");
  const fit = () => {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const frame = (t) => {
    raf = 0;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    dots = dots.filter((d) => t - d.t0 < d.life);
    for (const d of dots) {
      const k = 1 - (t - d.t0) / d.life;
      ctx.fillStyle = `rgba(${d.c},${(0.55 * k).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y + (1 - k) * d.drip, d.r * (0.6 + 0.4 * k), 0, Math.PI * 2);
      ctx.fill();
    }
    if (dots.length) raf = requestAnimationFrame(frame);
  };
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch" || !on()) {
      last = null;
      return;
    }
    if (!canvas) {
      canvas = el("canvas", { class: "verse-spray", "aria-hidden": "true" });
      document.body.append(canvas);
      ctx = canvas.getContext("2d");
      fit();
      window.addEventListener("resize", fit);
    }
    const now = performance.now();
    const speed = last ? Math.hypot(e.clientX - last.x, e.clientY - last.y) : 0;
    last = { x: e.clientX, y: e.clientY };
    const n = Math.min(7, 2 + Math.floor(speed / 6));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() ** 1.6 * (6 + speed * 0.25);
      dots.push({ x: e.clientX + Math.cos(a) * rr, y: e.clientY + Math.sin(a) * rr, r: 0.8 + Math.random() * 2.2, c: COLS[(Math.random() * 3) | 0], t0: now, life: 500 + Math.random() * 500, drip: Math.random() < 0.06 ? 14 : 0 });
    }
    if (dots.length > 600) dots.splice(0, dots.length - 600);
    if (!raf) raf = requestAnimationFrame(frame);
  }, { passive: true });
}
