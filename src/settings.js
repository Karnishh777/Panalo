// Per-device "vibe" settings: global accent, chat wallpaper, animated background,
// and cursor glow. Stored in localStorage (UI preferences, no backend needed).
import { THEME_PRESETS, WALLPAPER_PRESETS } from "./config.js";
import { el } from "./util.js";

const SETTINGS_KEY = "panalo.settings";
const DEFAULTS = { accent: "default", wallpaper: "dots", animatedBg: true, cursorGlow: true };

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}
function save() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

const settings = load();

// ---- Appliers ----
function applyAccent(id) {
  const p = THEME_PRESETS.find((t) => t.id === id) || THEME_PRESETS[0];
  const grad = `linear-gradient(135deg, ${p.primary}, ${p.strong})`;
  const root = document.documentElement.style;
  root.setProperty("--primary", p.primary);
  root.setProperty("--primary-strong", p.strong);
  root.setProperty("--grad", grad);
  root.setProperty("--bubble-out", grad);
}

function applyWallpaper(id) {
  const chatMain = document.querySelector(".chat-main");
  if (chatMain) chatMain.dataset.wallpaper = id;
}

function applyAnimatedBg(on) {
  document.body.classList.toggle("no-aurora", !on);
}

// Cursor glow — a soft light that trails the pointer (desktop only, respects
// reduced-motion). Uses a single element + rAF lerp, so it's cheap.
let glowEl = null;
let glowRAF = 0;
let glowOn = false;
let targetX = 0;
let targetY = 0;
let glowX = 0;
let glowY = 0;

function onPointerMove(e) {
  targetX = e.clientX;
  targetY = e.clientY;
}
function glowLoop() {
  glowX += (targetX - glowX) * 0.15;
  glowY += (targetY - glowY) * 0.15;
  if (glowEl) glowEl.style.transform = `translate(${glowX}px, ${glowY}px) translate(-50%, -50%)`;
  glowRAF = requestAnimationFrame(glowLoop);
}
function applyCursorGlow(on) {
  const finePointer = window.matchMedia("(pointer: fine)").matches;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const enable = on && finePointer && !reduced;

  if (enable && !glowOn) {
    if (!glowEl) {
      glowEl = document.createElement("div");
      glowEl.id = "cursor-glow";
      document.body.append(glowEl);
    }
    glowEl.style.display = "block";
    window.addEventListener("mousemove", onPointerMove);
    glowRAF = requestAnimationFrame(glowLoop);
    glowOn = true;
  } else if (!enable && glowOn) {
    if (glowEl) glowEl.style.display = "none";
    window.removeEventListener("mousemove", onPointerMove);
    cancelAnimationFrame(glowRAF);
    glowOn = false;
  } else if (!enable && glowEl) {
    glowEl.style.display = "none";
  }
}

function markSelected(container, selector, id, attr = "id") {
  container.querySelectorAll(selector).forEach((n) => {
    n.classList.toggle("selected", n.dataset[attr] === id);
  });
}

export function initSettings() {
  // Apply saved prefs on load.
  applyAccent(settings.accent);
  applyWallpaper(settings.wallpaper);
  applyAnimatedBg(settings.animatedBg);
  applyCursorGlow(settings.cursorGlow);

  // Accent swatches.
  const accentBox = document.getElementById("accent-swatches");
  THEME_PRESETS.forEach((p) => {
    const s = el("button", {
      class: "theme-swatch",
      type: "button",
      title: p.name,
      "aria-label": `${p.name} accent`,
      onClick: () => {
        settings.accent = p.id;
        save();
        applyAccent(p.id);
        markSelected(accentBox, ".theme-swatch", p.id);
      },
    });
    s.dataset.id = p.id;
    s.style.background = `linear-gradient(135deg, ${p.primary}, ${p.strong})`;
    accentBox.append(s);
  });
  markSelected(accentBox, ".theme-swatch", settings.accent);

  // Wallpaper chips.
  const wpBox = document.getElementById("wallpaper-options");
  WALLPAPER_PRESETS.forEach((w) => {
    const chip = el("button", {
      class: "wallpaper-chip",
      type: "button",
      text: w.name,
      onClick: () => {
        settings.wallpaper = w.id;
        save();
        applyWallpaper(w.id);
        markSelected(wpBox, ".wallpaper-chip", w.id);
      },
    });
    chip.dataset.id = w.id;
    wpBox.append(chip);
  });
  markSelected(wpBox, ".wallpaper-chip", settings.wallpaper);

  // Effect toggles.
  const auroraToggle = document.getElementById("setting-aurora");
  const cursorToggle = document.getElementById("setting-cursor");
  auroraToggle.checked = settings.animatedBg;
  cursorToggle.checked = settings.cursorGlow;
  auroraToggle.addEventListener("change", () => {
    settings.animatedBg = auroraToggle.checked;
    save();
    applyAnimatedBg(settings.animatedBg);
  });
  cursorToggle.addEventListener("change", () => {
    settings.cursorGlow = cursorToggle.checked;
    save();
    applyCursorGlow(settings.cursorGlow);
  });

  // Open / close.
  document.getElementById("settings-btn").addEventListener("click", () => {
    document.getElementById("settings-modal").classList.remove("hidden");
  });
  document.getElementById("close-settings-modal").addEventListener("click", () => {
    document.getElementById("settings-modal").classList.add("hidden");
  });
}
