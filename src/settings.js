// Per-device "vibe" settings: global accent, chat wallpaper (presets or your own
// image), animated background, and a themed custom cursor. Stored in localStorage
// (UI preferences, no backend needed).
import { THEME_PRESETS, WALLPAPER_PRESETS } from "./config.js";
import { el, showToast } from "./util.js";

const SETTINGS_KEY = "panalo.settings";
const DEFAULTS = { accent: "default", wallpaper: "dots", customWallpaper: null, animatedBg: true, cursorGlow: true };

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
    // Likely quota (a big custom wallpaper) — the setting still applies this session.
    showToast("Couldn't save that wallpaper (too large). It'll reset on reload.", "");
  }
}

const settings = load();

// ---- Accent ----
function applyAccent(id) {
  const p = THEME_PRESETS.find((t) => t.id === id) || THEME_PRESETS[0];
  const grad = `linear-gradient(135deg, ${p.primary}, ${p.strong})`;
  const root = document.documentElement.style;
  root.setProperty("--primary", p.primary);
  root.setProperty("--primary-strong", p.strong);
  root.setProperty("--grad", grad);
  root.setProperty("--bubble-out", grad);
}

// ---- Wallpaper ----
function applyWallpaper(id) {
  const chatMain = document.querySelector(".chat-main");
  if (!chatMain) return;
  chatMain.dataset.wallpaper = id;
  if (id === "custom" && settings.customWallpaper) {
    // Dark overlay keeps message text readable over any photo.
    chatMain.style.backgroundImage =
      `linear-gradient(rgba(18,14,30,0.5), rgba(18,14,30,0.66)), url(${settings.customWallpaper})`;
  } else {
    chatMain.style.removeProperty("background-image"); // let the CSS preset apply
  }
}

// Downscale + re-encode an uploaded image so it fits comfortably in localStorage.
async function imageToWallpaperDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  const maxDim = 1280;
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.72);
}

// ---- Animated background ----
function applyAnimatedBg(on) {
  document.body.classList.toggle("no-aurora", !on);
}

// ---- Custom cursor (themed ring + soft glow trail; desktop only) ----
let dotEl = null;
let glowEl = null;
let glowRAF = 0;
let cursorOn = false;
let mx = 0;
let my = 0;
let gx = 0;
let gy = 0;

function onPointerMove(e) {
  mx = e.clientX;
  my = e.clientY;
  if (dotEl) {
    dotEl.style.left = `${mx}px`;
    dotEl.style.top = `${my}px`;
  }
}
function onPointerOver(e) {
  if (!dotEl || !e.target.closest) return;
  const interactive = e.target.closest(
    'button, a, [role="button"], .conv-item, .quick-btn, .theme-swatch, .wallpaper-chip, input, label, .switch'
  );
  dotEl.classList.toggle("big", !!interactive);
}
function glowLoop() {
  gx += (mx - gx) * 0.18;
  gy += (my - gy) * 0.18;
  if (glowEl) glowEl.style.transform = `translate(${gx}px, ${gy}px) translate(-50%, -50%)`;
  glowRAF = requestAnimationFrame(glowLoop);
}
function applyCursor(on) {
  const finePointer = window.matchMedia("(pointer: fine)").matches;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const enable = on && finePointer;

  if (enable && !cursorOn) {
    if (!dotEl) {
      dotEl = document.createElement("div");
      dotEl.id = "cursor-dot";
      document.body.append(dotEl);
    }
    if (!glowEl) {
      glowEl = document.createElement("div");
      glowEl.id = "cursor-glow";
      document.body.append(glowEl);
    }
    dotEl.style.display = "block";
    document.body.classList.add("custom-cursor");
    window.addEventListener("mousemove", onPointerMove);
    document.addEventListener("mouseover", onPointerOver);
    if (!reduced) {
      glowEl.style.display = "block";
      glowRAF = requestAnimationFrame(glowLoop);
    }
    cursorOn = true;
  } else if (!enable && cursorOn) {
    if (dotEl) dotEl.style.display = "none";
    if (glowEl) glowEl.style.display = "none";
    document.body.classList.remove("custom-cursor");
    window.removeEventListener("mousemove", onPointerMove);
    document.removeEventListener("mouseover", onPointerOver);
    cancelAnimationFrame(glowRAF);
    cursorOn = false;
  }
}

function markSelected(container, selector, id) {
  container.querySelectorAll(selector).forEach((n) => {
    n.classList.toggle("selected", n.dataset.id === id);
  });
}

export function initSettings() {
  // Apply saved prefs on load.
  applyAccent(settings.accent);
  applyWallpaper(settings.wallpaper);
  applyAnimatedBg(settings.animatedBg);
  applyCursor(settings.cursorGlow);

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

  // Wallpaper chips ("custom" opens the file picker).
  const wpBox = document.getElementById("wallpaper-options");
  const wpInput = document.getElementById("wallpaper-input");
  WALLPAPER_PRESETS.forEach((w) => {
    const chip = el("button", {
      class: "wallpaper-chip",
      type: "button",
      text: w.name,
      onClick: () => {
        if (w.id === "custom") {
          wpInput.click();
          return;
        }
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

  wpInput.addEventListener("change", async () => {
    const file = wpInput.files[0];
    wpInput.value = "";
    if (!file) return;
    try {
      settings.customWallpaper = await imageToWallpaperDataUrl(file);
      settings.wallpaper = "custom";
      save();
      applyWallpaper("custom");
      markSelected(wpBox, ".wallpaper-chip", "custom");
    } catch {
      showToast("Could not use that image.");
    }
  });

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
    applyCursor(settings.cursorGlow);
  });

  // Open / close.
  document.getElementById("settings-btn").addEventListener("click", () => {
    document.getElementById("settings-modal").classList.remove("hidden");
  });
  document.getElementById("close-settings-modal").addEventListener("click", () => {
    document.getElementById("settings-modal").classList.add("hidden");
  });
}
