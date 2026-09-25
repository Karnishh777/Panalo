// Personalisation fonts, loaded the first time they are needed.
//
// index.html used to request seven font families on every page load -- about
// half a megabyte of fonts before anyone had chosen anything -- so that a
// handful of people could pick "Comic" in Settings. Now only the two UI
// families load up front, and each preset's stylesheet is added the first
// time it is applied or previewed.
import { FONT_PRESETS } from "./config.js";

const requested = new Set();

export function ensureFont(presetOrId) {
  const preset = typeof presetOrId === "string" ? FONT_PRESETS.find((f) => f.id === presetOrId) : presetOrId;
  if (!preset?.google || requested.has(preset.id)) return;
  requested.add(preset.id);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${preset.google}&display=swap`;
  document.head.append(link);
}

// For a picker that previews every option in its own face.
export function ensureAllFonts() {
  FONT_PRESETS.forEach(ensureFont);
}
