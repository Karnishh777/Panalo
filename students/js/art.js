// The painted art (v0.2): Pan the mascot, the subject guardians, their
// scenes and the wallpapers -- bitmaps made from students/assets/art/
// PROMPTS.md by tools/art/process.py. manifest.json lists what exists; the
// app asks only for those, and every place that shows art has a plain
// fallback, so a missing image never leaves a hole.
const BASE = "assets/art/";
let have = null;
let loading = null;
const listeners = new Set();

/** Load the manifest once; resolves when known. */
export function loadArt() {
  if (have) return Promise.resolve(have);
  loading ??= fetch(`${BASE}manifest.json`, { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : { files: [] }))
    .catch(() => ({ files: [] }))
    .then((j) => {
      have = new Set(Array.isArray(j.files) ? j.files : []);
      listeners.forEach((fn) => fn());
      return have;
    });
  return loading;
}

/** Call `fn` once the manifest is in (at once if it already is). */
export function onArt(fn) {
  if (have) fn();
  else listeners.add(fn);
  loadArt();
}

/** The URL of an image by its name ("pan-cheer"), or null if it isn't there. */
export function art(name) {
  return have?.has(name) ? `${BASE}${name}.webp` : null;
}

// Which guardian looks after a subject, and its colour.
export const GUARDIANS = {
  physics: "#9ad8ff",
  chemistry: "#ffc47a",
  biology: "#7ee2a8",
  maths: "#b59cff",
  computing: "#ff9db0",
  commerce: "#e7d19b",
  words: "#8fe3e0",
  art: "#f5a46b",
};
const FAMILY = {
  phy: "physics",
  chem: "chemistry",
  bio: "biology",
  sci: "physics",
  math: "maths",
  amath: "maths",
  fmath: "maths",
  cs: "computing",
  ict: "computing",
  it: "computing",
  ip: "computing",
  ai: "computing",
  bst: "commerce",
  eco: "commerce",
  bus: "commerce",
  acc: "commerce",
  art: "art",
  dt: "art",
  psy: "art",
};
export function guardianOf(subjectId) {
  return FAMILY[subjectId] || "words";
}

/** A <img> for a piece of art, or null. Decorative unless given alt text. */
export function artImg(name, { cls = "", alt = "" } = {}) {
  const src = art(name);
  if (!src) return null;
  const img = document.createElement("img");
  img.src = src;
  img.alt = alt;
  img.decoding = "async";
  img.loading = "lazy";
  img.draggable = false;
  if (cls) img.className = cls;
  if (!alt) img.setAttribute("aria-hidden", "true");
  return img;
}
