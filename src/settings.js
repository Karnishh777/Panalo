// Per-device "vibe" settings: global accent, chat wallpaper (presets or your own
// image), animated background, and a themed custom cursor. Stored in localStorage
// (UI preferences, no backend needed).
import { THEME_PRESETS, WALLPAPER_PRESETS, EFFECT_PRESETS, FONT_PRESETS } from "./config.js";
import { el, showToast } from "./util.js";
import { icon } from "./icons.js";
import {
  setAlertPrefs,
  requestDesktopPermission,
  sendTestAlert,
  notificationPermission,
} from "./notifications.js";
import { applyEffect } from "./effects.js";
import { hasPin, setPin, verifyPin, appLockEnabled, setAppLock, askPin, setHiddenVisible, hiddenCount } from "./lock.js";

const SETTINGS_KEY = "panalo.settings";
const DEFAULTS = {
  accent: "default",
  wallpaper: "doodle",
  customWallpaper: null,
  effect: "aurora",
  ambientImage: null,
  appFont: "default",
  cursorGlow: true,
  notifications: false, // desktop (needs browser permission)
  inAppAlerts: true, // always works
  alertSound: true,
};

function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    // Migrate the old boolean "animatedBg" toggle to the effect selector.
    if (stored.animatedBg === false && !stored.effect) stored.effect = "none";
    delete stored.animatedBg;
    return { ...DEFAULTS, ...stored };
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

// ---- App font ----
// "default" restores the Sora + Inter mix; any preset takes over app-wide,
// so all existing text (headers, buttons, chats) follows the choice.
function applyAppFont(id) {
  const root = document.documentElement.style;
  const preset = FONT_PRESETS.find((f) => f.id === id);
  if (!preset || id === "default") {
    root.removeProperty("--font-ui");
    root.removeProperty("--font-display");
    return;
  }
  root.setProperty("--font-ui", preset.stack);
  root.setProperty("--font-display", preset.stack);
}

// ---- Wallpaper ----
function applyWallpaper(id) {
  const container = document.querySelector(".app-container");
  if (!container) return;
  container.dataset.wallpaper = id;
  if (id === "custom" && settings.customWallpaper) {
    // Dark overlay keeps text readable over any photo.
    container.style.backgroundImage =
      `linear-gradient(rgba(18,14,30,0.55), rgba(18,14,30,0.7)), url(${settings.customWallpaper})`;
  } else {
    container.style.removeProperty("background-image"); // let the CSS preset apply
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

// ---- Alerts ----
function syncAlertPrefs() {
  setAlertPrefs({
    desktop: settings.notifications,
    inApp: settings.inAppAlerts,
    sound: settings.alertSound,
  });
}

// Tell the user exactly where desktop notifications stand — the old UI gave no
// feedback at all, so a blocked permission looked like a broken feature.
function refreshNotifyStatus() {
  const box = document.getElementById("notify-status");
  if (!box) return;
  const perm = notificationPermission();
  if (!settings.notifications) {
    box.textContent = "In-app alerts still work with desktop notifications off.";
    box.className = "notify-status";
  } else if (perm === "granted") {
    box.textContent = "✅ Desktop notifications are allowed.";
    box.className = "notify-status ok";
  } else if (perm === "denied") {
    box.textContent = "⚠️ Blocked by your browser. Click the 🔒 icon next to the web address → Notifications → Allow.";
    box.className = "notify-status warn";
  } else if (perm === "unsupported") {
    box.textContent = "⚠️ This browser has no desktop notifications — in-app alerts will be used.";
    box.className = "notify-status warn";
  } else {
    box.textContent = "Permission not granted yet — toggle this on and accept the browser prompt.";
    box.className = "notify-status warn";
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
  applyAppFont(settings.appFont);
  applyWallpaper(settings.wallpaper);
  applyEffect(settings.effect, settings.ambientImage);
  applyCursor(settings.cursorGlow);
  syncAlertPrefs();

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

  // App font chips — these restyle every bit of text in the app.
  const fontBox = document.getElementById("app-font-options");
  FONT_PRESETS.forEach((f) => {
    const chip = el("button", {
      class: "wallpaper-chip",
      type: "button",
      text: f.id === "default" ? "Default mix" : f.name,
      onClick: () => {
        settings.appFont = f.id;
        save();
        applyAppFont(f.id);
        markSelected(fontBox, ".wallpaper-chip", f.id);
      },
    });
    chip.dataset.id = f.id;
    if (f.id !== "default") chip.style.fontFamily = f.stack;
    fontBox.append(chip);
  });
  markSelected(fontBox, ".wallpaper-chip", settings.appFont);

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
    if (w.icon) chip.prepend(icon(w.icon, 14));
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

  // Ambient effect chips (Aurora / Liquid / Bubbles / Tech / Upload / None).
  const fxBox = document.getElementById("effect-options");
  const ambientInput = document.getElementById("ambient-input");
  EFFECT_PRESETS.forEach((f) => {
    const chip = el("button", {
      class: "wallpaper-chip",
      type: "button",
      text: f.name,
      onClick: () => {
        if (f.id === "image") {
          ambientInput.click();
          return;
        }
        settings.effect = f.id;
        save();
        applyEffect(f.id, settings.ambientImage);
        markSelected(fxBox, ".wallpaper-chip", f.id);
      },
    });
    chip.dataset.id = f.id;
    if (f.icon) chip.prepend(icon(f.icon, 14));
    fxBox.append(chip);
  });
  markSelected(fxBox, ".wallpaper-chip", settings.effect);

  ambientInput.addEventListener("change", async () => {
    const file = ambientInput.files[0];
    ambientInput.value = "";
    if (!file) return;
    try {
      settings.ambientImage = await imageToWallpaperDataUrl(file);
      settings.effect = "image";
      save();
      applyEffect("image", settings.ambientImage);
      markSelected(fxBox, ".wallpaper-chip", "image");
    } catch {
      showToast("Could not use that image.");
    }
  });

  // Alert toggles (desktop / in-app / sound) + the test button.
  const notifyToggle = document.getElementById("setting-notify");
  const inAppToggle = document.getElementById("setting-inapp");
  const soundToggle = document.getElementById("setting-sound");
  const cursorToggle = document.getElementById("setting-cursor");
  notifyToggle.checked = settings.notifications;
  inAppToggle.checked = settings.inAppAlerts;
  soundToggle.checked = settings.alertSound;
  cursorToggle.checked = settings.cursorGlow;
  refreshNotifyStatus();

  notifyToggle.addEventListener("change", async () => {
    settings.notifications = notifyToggle.checked;
    save();
    syncAlertPrefs();
    if (settings.notifications) {
      const result = await requestDesktopPermission();
      // A blocked browser can't be overridden from here — reflect reality.
      if (result !== "granted") {
        settings.notifications = false;
        notifyToggle.checked = false;
        save();
        syncAlertPrefs();
      }
    }
    refreshNotifyStatus();
  });
  inAppToggle.addEventListener("change", () => {
    settings.inAppAlerts = inAppToggle.checked;
    save();
    syncAlertPrefs();
  });
  soundToggle.addEventListener("change", () => {
    settings.alertSound = soundToggle.checked;
    save();
    syncAlertPrefs();
  });
  document.getElementById("test-alert-btn").addEventListener("click", () => {
    sendTestAlert();
    refreshNotifyStatus();
  });

  // ---- Privacy & lock ----
  const appLockToggle = document.getElementById("setting-app-lock");
  const showHiddenToggle = document.getElementById("setting-show-hidden");
  appLockToggle.checked = appLockEnabled();

  async function ensurePin() {
    if (hasPin()) return true;
    const pin = window.prompt("Choose a 4–8 digit PIN:");
    if (!pin) return false;
    return setPin(pin);
  }

  appLockToggle.addEventListener("change", async () => {
    if (appLockToggle.checked) {
      if (!(await ensurePin())) {
        appLockToggle.checked = false;
        return;
      }
      setAppLock(true);
      showToast("App lock is on — you'll be asked for your PIN when you open Panalo.", "success");
    } else {
      // Turning protection off should itself be protected.
      if (hasPin() && !(await askPin({ title: "Turn off app lock", subtitle: "Enter your PIN to confirm" }))) {
        appLockToggle.checked = true;
        return;
      }
      setAppLock(false);
    }
  });

  document.getElementById("change-pin-btn").addEventListener("click", async () => {
    if (hasPin() && !(await askPin({ title: "Change PIN", subtitle: "Enter your current PIN first" }))) return;
    const pin = window.prompt("New 4–8 digit PIN:");
    if (!pin) return;
    if (await setPin(pin)) showToast("PIN updated.", "success");
  });

  showHiddenToggle.addEventListener("change", async () => {
    if (showHiddenToggle.checked) {
      if (hasPin() && !(await askPin({ title: "Show hidden chats", subtitle: "Enter your PIN" }))) {
        showHiddenToggle.checked = false;
        return;
      }
      setHiddenVisible(true);
      showToast(`${hiddenCount()} hidden chat(s) now visible.`, "success");
    } else {
      setHiddenVisible(false);
    }
    document.dispatchEvent(new CustomEvent("panalo:refresh-chats"));
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
