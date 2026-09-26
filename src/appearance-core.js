// Appearance settings, as pure functions.
//
// No DOM and no storage here, so every rule is tested in Node
// (tests/appearance.test.mjs). src/appearance.js applies the result to the
// page; src/boot.js applies the same saved result before first paint.
//
// Stored under localStorage "panalo.settings" alongside the non-visual
// preferences (alerts, cursor...), which pass through untouched.

export const THEME_MODES = ["auto", "light", "dark"];
export const BUBBLE_SHAPES = ["round", "soft", "crisp"];
export const TEXT_SIZES = ["s", "m", "l"];
export const DENSITIES = ["comfortable", "compact"];

export const SETTINGS_DEFAULTS = Object.freeze({
  themeMode: "auto",
  accent: "default",
  bubbles: "round",
  textSize: "m",
  density: "comfortable",
  quickBar: false,
  reduceMotion: false,
  wallpaper: "doodle",
  customWallpaper: null,
  effect: "aurora",
  ambientImage: null,
  appFont: "default",
  cursorGlow: false,
  notifications: false, // desktop (needs browser permission)
  inAppAlerts: true, // always works
  alertSound: true,
});

const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

// Merge what was stored with the defaults, repairing anything invalid and
// carrying old settings forward:
//   animatedBg: false  (pre-effects toggle)  → effect "none"
//   ogSkin: true       (the old dark-violet skin) → dark theme, Grape accent
// A value that is not one of the known choices falls back to the default
// rather than leaking an unknown attribute into the page.
export function normalizeSettings(stored, { accentIds = null, wallpaperIds = null } = {}) {
  const s = stored && typeof stored === "object" ? { ...stored } : {};

  if (s.animatedBg === false && !s.effect) s.effect = "none";
  delete s.animatedBg;

  if (s.ogSkin === true) {
    if (!s.themeMode) s.themeMode = "dark";
    if (!s.accent || s.accent === "default") s.accent = "grape";
  }
  delete s.ogSkin;

  const out = { ...SETTINGS_DEFAULTS, ...s };
  out.themeMode = oneOf(out.themeMode, THEME_MODES, SETTINGS_DEFAULTS.themeMode);
  out.bubbles = oneOf(out.bubbles, BUBBLE_SHAPES, SETTINGS_DEFAULTS.bubbles);
  out.textSize = oneOf(out.textSize, TEXT_SIZES, SETTINGS_DEFAULTS.textSize);
  out.density = oneOf(out.density, DENSITIES, SETTINGS_DEFAULTS.density);
  if (accentIds && !accentIds.includes(out.accent)) out.accent = SETTINGS_DEFAULTS.accent;
  if (wallpaperIds && !wallpaperIds.includes(out.wallpaper)) out.wallpaper = SETTINGS_DEFAULTS.wallpaper;
  // An uploaded wallpaper that failed to save can't be shown.
  if (out.wallpaper === "custom" && !out.customWallpaper) out.wallpaper = SETTINGS_DEFAULTS.wallpaper;
  for (const k of ["quickBar", "reduceMotion", "cursorGlow", "notifications", "inAppAlerts", "alertSound"]) {
    out[k] = Boolean(out[k]);
  }
  return out;
}

// "auto" follows the device; anything else is what the person picked.
export function resolveTheme(mode, prefersDark) {
  if (mode === "light" || mode === "dark") return mode;
  return prefersDark ? "dark" : "light";
}

// The three variables an accent sets; every other shade is derived in CSS.
export function accentVars(preset) {
  if (!preset) return null;
  return {
    "--primary": preset.primary,
    "--primary-strong": preset.strong,
    "--on-primary": preset.on || "#ffffff",
  };
}

// Attributes for <html>. null means "remove the attribute".
export function rootAttributes(settings, prefersDark) {
  return {
    "data-theme": resolveTheme(settings.themeMode, prefersDark),
    "data-density": settings.density === "compact" ? "compact" : null,
    "data-bubbles": settings.bubbles === "round" ? null : settings.bubbles,
    "data-text": settings.textSize === "m" ? null : settings.textSize,
    "data-motion": settings.reduceMotion ? "reduce" : null,
  };
}

// The browser UI colour (address bar, PWA title bar) for a resolved theme.
export function themeColor(theme) {
  return theme === "dark" ? "#070b16" : "#f3efe9";
}
