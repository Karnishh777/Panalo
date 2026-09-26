// Applies appearance settings to the page. The rules themselves are pure and
// live in appearance-core.js; this is only the part that touches the DOM.
import { rootAttributes, accentVars, themeColor } from "./appearance-core.js";
import { THEME_PRESETS } from "./config.js";

const darkQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
const prefersDark = () => !!darkQuery?.matches;

export function accentPreset(id) {
  return THEME_PRESETS.find((t) => t.id === id) || THEME_PRESETS[0];
}

// Colour one element (and everything inside it) with an accent. Used for
// <html> (the app accent), .chat-main (a chat's own theme) and the landing
// page's live preview.
const LEGACY_VARS = ["--grad", "--bubble-out"]; // written inline by older builds
export function paintAccent(node, id) {
  const vars = accentVars(accentPreset(id));
  LEGACY_VARS.forEach((v) => node.style.removeProperty(v));
  for (const [k, v] of Object.entries(vars)) node.style.setProperty(k, v);
  return vars;
}
export function clearAccent(node) {
  ["--primary", "--primary-strong", "--on-primary", ...LEGACY_VARS].forEach((v) => node.style.removeProperty(v));
}

// Tab icon in the accent colour (the drawing lives in src/boot.js).
export function paintFavicon(id) {
  const p = accentPreset(id);
  window.PanaloFavicon?.(p.primary, p.strong);
}

export function applyRootAppearance(settings) {
  const root = document.documentElement;
  const attrs = rootAttributes(settings, prefersDark());
  for (const [name, value] of Object.entries(attrs)) {
    if (value == null) root.removeAttribute(name);
    else root.setAttribute(name, value);
  }
  // Address bar / installed-app title bar follow the theme actually shown.
  const color = themeColor(attrs["data-theme"]);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", color));
  document.dispatchEvent(new CustomEvent("panalo:theme", { detail: { theme: attrs["data-theme"] } }));
}

// "Auto" has to keep following the device after load, e.g. at sunset.
export function watchSystemTheme(getSettings) {
  darkQuery?.addEventListener?.("change", () => {
    if (getSettings().themeMode === "auto") applyRootAppearance(getSettings());
  });
}

export function motionReduced() {
  return (
    document.documentElement.getAttribute("data-motion") === "reduce" ||
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}
