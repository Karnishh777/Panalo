// Premade greeting cards & stickers.
//
// Every sticker is drawn here as vector art — a gradient card with a white
// emblem and a caption. Nothing is fetched, nothing is hosted, nothing is
// generated: the whole library is a few KB of path data, it stays crisp at any
// size, and it works offline. (The roadmap's "curated, local, no external
// generation" requirement, met without spending Storage or bundle budget.)
//
// A sticker travels as an ordinary text message containing a marker, so it is
// encrypted exactly like anything else you send and needs no schema change.
import { el } from "./util.js";

const MARKER = /^\[\[sticker:([a-z0-9-]+)\]\]$/i;
const IMG_MARKER = /^\[\[sticker-img:(.+)\]\]$/;

export function stickerMarker(id) {
  return `[[sticker:${id}]]`;
}
export function imageStickerMarker(file) {
  return `[[sticker-img:${encodeURI(file)}]]`;
}

// Sticker paths arrive inside messages, so they're untrusted. Only accept a
// plain relative path under stickers/ — no traversal, no absolute or remote
// URLs, no protocol tricks.
function safeStickerPath(raw) {
  let path;
  try {
    path = decodeURI(raw).trim();
  } catch {
    return null;
  }
  if (!/^[A-Za-z0-9 _\-./]+$/.test(path)) return null;
  if (path.includes("..") || path.startsWith("/") || path.startsWith(".")) return null;
  if (!/\.(webp|png|gif|svg|jpe?g)$/i.test(path)) return null;
  return path;
}

// Returns { kind: "vector", sticker } | { kind: "image", path, name } | null
export function parseSticker(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();

  const vector = trimmed.match(MARKER);
  if (vector) {
    const sticker = STICKERS.find((s) => s.id === vector[1]);
    return sticker ? { kind: "vector", sticker, name: sticker.name } : null;
  }

  const image = trimmed.match(IMG_MARKER);
  if (image) {
    const path = safeStickerPath(image[1]);
    if (!path) return null;
    const known = customStickers.find((s) => s.file === path);
    return { kind: "image", path, name: known?.name || "Sticker" };
  }
  return null;
}

// What to show for a sticker in previews and notifications.
export function describeText(text) {
  const found = parseSticker(text);
  return found ? `Sticker · ${found.name}` : text;
}

// ---- Your own stickers (the stickers/ folder) ----
// Static hosting can't list a directory, so the folder ships a manifest built
// by tools/build-stickers.mjs. Missing or empty is fine — the built-in vector
// cards always work on their own.
let customStickers = [];

export async function loadCustomStickers() {
  try {
    const res = await fetch("stickers/manifest.json", { cache: "no-cache" });
    if (!res.ok) return [];
    const data = await res.json();
    customStickers = (data.stickers || [])
      .map((s) => ({ ...s, file: safeStickerPath(s.file) }))
      .filter((s) => s.file);
  } catch {
    customStickers = [];
  }
  return customStickers;
}

export function stickerImg(path, size = 120) {
  return el("img", {
    src: `stickers/${path}`,
    class: "sticker-img",
    alt: "Sticker",
    loading: "lazy",
    width: size,
    height: size,
  });
}

// Emblems are 24×24 stroke paths, scaled up onto the card.
const E = {
  wave: ["M7 11.5V6.2a1.4 1.4 0 0 1 2.8 0v4", "M9.8 10.2V4.6a1.4 1.4 0 0 1 2.8 0v5.4", "M12.6 10.6V6.2a1.4 1.4 0 0 1 2.8 0v5.6", "M15.4 12.2v-1.6a1.4 1.4 0 0 1 2.8 0V14c0 4-3.1 7-7 7s-7-3-7-7v-1.8a1.4 1.4 0 0 1 2.8 0V14"],
  sun: ["M12 17.2a5.2 5.2 0 1 0 0-10.4 5.2 5.2 0 0 0 0 10.4z", "M12 1.8v2.6M12 19.6v2.6M4.8 4.8l1.9 1.9M17.3 17.3l1.9 1.9M1.8 12h2.6M19.6 12h2.6M4.8 19.2l1.9-1.9M17.3 6.7l1.9-1.9"],
  moon: ["M20.6 14.4A8.6 8.6 0 0 1 9.6 3.4a8.6 8.6 0 1 0 11 11z", "M17.5 3.5l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6z"],
  trophy: ["M7.8 3.2h8.4v4.6a4.2 4.2 0 0 1-8.4 0z", "M7.8 5.2H5a3 3 0 0 0 3 3.2M16.2 5.2H19a3 3 0 0 1-3 3.2", "M12 12v4.2", "M8.6 20.8h6.8l-1-4.6h-4.8z"],
  cake: ["M4 20.6v-6.2h16v6.2z", "M6.2 14.4v-2.2h11.6v2.2", "M9 12.2V8.4M12 12.2V7.4M15 12.2V8.4", "M9 6.6v.2M12 5.6v.2M15 6.6v.2"],
  hands: ["M12 3.4L8 11.6v5.8a3.2 3.2 0 0 0 3.2 3.2h1.6a3.2 3.2 0 0 0 3.2-3.2v-5.8z", "M12 3.4v17.2"],
  flower: ["M12 9.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z", "M12 9.6c0-3 1-4.6 0-6.2-1 1.6 0 3.2 0 6.2z", "M14.4 12c3 0 4.6 1 6.2 0-1.6-1-3.2 0-6.2 0z", "M12 14.4c0 3-1 4.6 0 6.2 1-1.6 0-3.2 0-6.2z", "M9.6 12c-3 0-4.6 1-6.2 0 1.6-1 3.2 0 6.2 0z"],
  gift: ["M3.6 11.4h16.8v9.2H3.6z", "M2.6 7.4h18.8v4H2.6z", "M12 7.4v13.2", "M12 7.4S10.6 3.4 8.2 3.4a2.2 2.2 0 0 0 0 4M12 7.4s1.4-4 3.8-4a2.2 2.2 0 0 1 0 4"],
  heart: ["M12 20.8S3.4 15.6 3.4 9.8A4.6 4.6 0 0 1 12 7.4a4.6 4.6 0 0 1 8.6 2.4c0 5.8-8.6 11-8.6 11z"],
  laugh: ["M12 2.8a9.2 9.2 0 1 0 0 18.4 9.2 9.2 0 0 0 0-18.4z", "M7.6 13.6a4.8 4.8 0 0 0 8.8 0z", "M7.8 9.6a2 2 0 0 1 2.6 0M13.6 9.6a2 2 0 0 1 2.6 0"],
  wow: ["M12 2.8a9.2 9.2 0 1 0 0 18.4 9.2 9.2 0 0 0 0-18.4z", "M12 12.6a2.2 2.8 0 1 0 0 5.6 2.2 2.8 0 0 0 0-5.6z", "M8.8 9.2v.2M15.2 9.2v.2"],
  sad: ["M12 2.8a9.2 9.2 0 1 0 0 18.4 9.2 9.2 0 0 0 0-18.4z", "M8 16.4a4.8 4.8 0 0 1 8 0", "M8.8 9.4v.2M15.2 9.4v.2", "M16.4 12.4c.8 1.2 1.2 2 1.2 2.6a1.2 1.2 0 0 1-2.4 0c0-.6.4-1.4 1.2-2.6z"],
  fire: ["M12 21.4c4 0 7-2.8 7-6.6 0-4.2-4.2-5.8-4.2-10-3 2-4.4 4.4-4.4 6.4-1-.8-1.6-1.8-1.8-2.8-2 2-3.6 4.2-3.6 6.4 0 3.8 3 6.6 7 6.6z", "M12 18.6c1.6 0 2.8-1.2 2.8-2.6 0-1.6-1.6-2.4-1.6-4-1.4 1-2.2 2.2-2.2 3.2-.6-.4-.8-.8-1-1.2-.6.8-.8 1.4-.8 2 0 1.4 1.2 2.6 2.8 2.6z"],
  party: ["M3.6 20.8l5.8-12.4 6.6 6.6z", "M14 3.6v2M18.6 5.6l-1.4 1.4M20.4 10.4h-2M11.8 4.8l1 1.6M19.6 15.2l-1.6-1"],
  clap: ["M8.4 20.6l-2.8-5.4 2.4-7.2 2 .7-1.7 6.1 2.6 4.4z", "M13.2 20.8l3.4-4.8-1-6.6 2.1-.3 1.2 7.4-3.8 5.2z", "M11 8.2l1.4-4.4M15.4 9l3-3.2"],
  check: ["M12 2.8a9.2 9.2 0 1 0 0 18.4 9.2 9.2 0 0 0 0-18.4z", "M7.8 12.2l3 3 5.4-5.8"],
  coffee: ["M4.6 8.4h12.2v6a5 5 0 0 1-5 5H9.6a5 5 0 0 1-5-5z", "M16.8 10h1.8a2.6 2.6 0 0 1 0 5.2h-1.8", "M8 5.6c.8-1 .8-1.8 0-2.8M12 5.6c.8-1 .8-1.8 0-2.8"],
  music: ["M9.4 17.6a2.6 2.6 0 1 0 0 .1z", "M18.4 15.4a2.4 2.4 0 1 0 0 .1z", "M9.4 17.6V6.2l11.4-2.4v11.6", "M9.4 9.6l11.4-2.4"],
  rocket: ["M12 2.6c3.2 3 5 7.2 5 11.2l-2.6 3h-4.8l-2.6-3c0-4 1.8-8.2 5-11.2z", "M12 10.4a1.8 1.8 0 1 0 0-.1z", "M9.6 16.8l-2.8 2.2 1 2.4M14.4 16.8l2.8 2.2-1 2.4"],
  star: ["M12 2.8l2.9 6 6.5.9-4.7 4.5 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.7l6.5-.9z"],
  rainbow: ["M3 19.4a9 9 0 0 1 18 0", "M6.6 19.4a5.4 5.4 0 0 1 10.8 0", "M10.2 19.4a1.8 1.8 0 0 1 3.6 0"],
  crown: ["M3.6 18.4h16.8l-1.6-9.6-4.2 4.2L12 5.6l-2.6 7.4-4.2-4.2z", "M3.6 21h16.8"],
  peace: ["M12 2.8a9.2 9.2 0 1 0 0 18.4 9.2 9.2 0 0 0 0-18.4z", "M12 2.8v18.4M12 12.4l-6.4 6.4M12 12.4l6.4 6.4"],
  sparkle: ["M11 2.6l1.8 5.6 5.6 1.8-5.6 1.8L11 17.4 9.2 11.8 3.6 10l5.6-1.8z", "M18 15l.8 2.4 2.4.8-2.4.8-.8 2.4-.8-2.4-2.4-.8 2.4-.8z"],
};

// id · name · category · gradient · emblem · caption
export const STICKERS = [
  { id: "hello", name: "Hello!", cat: "Greetings", from: "#8b7cf6", to: "#6c5ce7", e: "wave", cap: "HELLO!" },
  { id: "good-morning", name: "Good morning", cat: "Greetings", from: "#ffb86f", to: "#ff8a5b", e: "sun", cap: "MORNING" },
  { id: "good-night", name: "Good night", cat: "Greetings", from: "#3a7bd5", to: "#25325e", e: "moon", cap: "GOODNIGHT" },
  { id: "congrats", name: "Congrats", cat: "Greetings", from: "#ffd166", to: "#f0a202", e: "trophy", cap: "CONGRATS" },
  { id: "birthday", name: "Happy birthday", cat: "Greetings", from: "#ff6fae", to: "#e0559a", e: "cake", cap: "HBD!" },
  { id: "thank-you", name: "Thank you", cat: "Greetings", from: "#7ef2c2", to: "#2fa060", e: "hands", cap: "THANK YOU" },
  { id: "get-well", name: "Get well soon", cat: "Greetings", from: "#a0e8af", to: "#4ecb71", e: "flower", cap: "GET WELL" },
  { id: "welcome", name: "Welcome", cat: "Greetings", from: "#c792ff", to: "#8b5cf6", e: "gift", cap: "WELCOME" },

  { id: "love", name: "Love", cat: "Reactions", from: "#ff8a8a", to: "#e63946", e: "heart", cap: "LOVE" },
  { id: "haha", name: "Haha", cat: "Reactions", from: "#ffe066", to: "#f4b400", e: "laugh", cap: "HAHA" },
  { id: "wow", name: "Wow", cat: "Reactions", from: "#6fd3ff", to: "#2a9df4", e: "wow", cap: "WOW" },
  { id: "sad", name: "Sad", cat: "Reactions", from: "#9aa4b8", to: "#5c6780", e: "sad", cap: "OH NO" },
  { id: "fire", name: "Fire", cat: "Reactions", from: "#ff9d4d", to: "#e8442a", e: "fire", cap: "FIRE" },
  { id: "party", name: "Party", cat: "Reactions", from: "#ff7ac6", to: "#9b5de5", e: "party", cap: "PARTY!" },
  { id: "clap", name: "Applause", cat: "Reactions", from: "#ffd6a0", to: "#f79d5c", e: "clap", cap: "BRAVO" },
  { id: "yes", name: "Yes!", cat: "Reactions", from: "#7ef2c2", to: "#12b886", e: "check", cap: "YES!" },

  { id: "coffee", name: "Coffee time", cat: "Vibes", from: "#c8a27a", to: "#7b4b2a", e: "coffee", cap: "COFFEE" },
  { id: "music", name: "Music", cat: "Vibes", from: "#b388ff", to: "#6d28d9", e: "music", cap: "VIBES" },
  { id: "rocket", name: "Let's go", cat: "Vibes", from: "#74c0fc", to: "#4263eb", e: "rocket", cap: "LET'S GO" },
  { id: "star", name: "Superstar", cat: "Vibes", from: "#ffe066", to: "#fab005", e: "star", cap: "STAR" },
  { id: "rainbow", name: "Good vibes", cat: "Vibes", from: "#8ce99a", to: "#22b8cf", e: "rainbow", cap: "VIBES" },
  { id: "crown", name: "Royalty", cat: "Vibes", from: "#ffd43b", to: "#e67700", e: "crown", cap: "ROYAL" },
  { id: "peace", name: "Peace", cat: "Vibes", from: "#a5d8ff", to: "#4c6ef5", e: "peace", cap: "PEACE" },
  { id: "sparkle", name: "Sparkle", cat: "Vibes", from: "#ffc9f0", to: "#c026d3", e: "sparkle", cap: "SHINE" },
];

export const STICKER_CATEGORIES = [...new Set(STICKERS.map((s) => s.cat))];

const SVG_NS = "http://www.w3.org/2000/svg";
let gradientSeq = 0;

// Build the card. Each instance needs its own gradient id, hence the counter.
export function stickerSvg(sticker, size = 120) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("class", "sticker-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", sticker.name);

  const gid = `stk${++gradientSeq}`;
  const defs = document.createElementNS(SVG_NS, "defs");
  const grad = document.createElementNS(SVG_NS, "linearGradient");
  grad.setAttribute("id", gid);
  grad.setAttribute("x1", "0");
  grad.setAttribute("y1", "0");
  grad.setAttribute("x2", "1");
  grad.setAttribute("y2", "1");
  [[0, sticker.from], [1, sticker.to]].forEach(([offset, color]) => {
    const stop = document.createElementNS(SVG_NS, "stop");
    stop.setAttribute("offset", offset);
    stop.setAttribute("stop-color", color);
    grad.append(stop);
  });
  defs.append(grad);
  svg.append(defs);

  const card = document.createElementNS(SVG_NS, "rect");
  card.setAttribute("width", "120");
  card.setAttribute("height", "120");
  card.setAttribute("rx", "26");
  card.setAttribute("fill", `url(#${gid})`);
  svg.append(card);

  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("transform", "translate(28.5 20) scale(2.625)");
  group.setAttribute("fill", "none");
  group.setAttribute("stroke", "#ffffff");
  group.setAttribute("stroke-width", "1.7");
  group.setAttribute("stroke-linecap", "round");
  group.setAttribute("stroke-linejoin", "round");
  (E[sticker.e] || []).forEach((d) => {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    group.append(p);
  });
  svg.append(group);

  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("x", "60");
  label.setAttribute("y", "104");
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("fill", "#ffffff");
  label.setAttribute("font-size", "13");
  label.setAttribute("font-weight", "800");
  label.setAttribute("letter-spacing", "0.5");
  label.setAttribute("font-family", "Sora, Segoe UI, sans-serif");
  label.textContent = sticker.cap;
  svg.append(label);

  return svg;
}

// ---- Picker ----
// Built once, then shown/hidden. `onPick` receives the sticker id.
export async function initStickerPicker(onPick) {
  const panel = document.getElementById("sticker-panel");
  const tabs = document.getElementById("sticker-tabs");
  const grid = document.getElementById("sticker-grid");

  await loadCustomStickers();
  const customCats = [...new Set(customStickers.map((s) => s.cat))];
  const categories = [...STICKER_CATEGORIES, ...customCats];
  let active = categories[0];

  function renderGrid() {
    grid.innerHTML = "";
    // Built-in vector cards…
    STICKERS.filter((s) => s.cat === active).forEach((s) => {
      const btn = el("button", {
        class: "sticker-cell",
        type: "button",
        title: s.name,
        "aria-label": s.name,
        onClick: () => {
          onPick(stickerMarker(s.id));
          panel.classList.add("hidden");
        },
      });
      btn.append(stickerSvg(s, 76));
      grid.append(btn);
    });
    // …then anything from the stickers/ folder.
    customStickers.filter((s) => s.cat === active).forEach((s) => {
      const btn = el("button", {
        class: "sticker-cell",
        type: "button",
        title: s.name,
        "aria-label": s.name,
        onClick: () => {
          onPick(imageStickerMarker(s.file));
          panel.classList.add("hidden");
        },
      });
      btn.append(stickerImg(s.file, 76));
      grid.append(btn);
    });
  }

  categories.forEach((cat) => {
    const tab = el("button", {
      class: `filter-tab${cat === active ? " active" : ""}`,
      type: "button",
      text: cat,
      onClick: () => {
        active = cat;
        tabs.querySelectorAll(".filter-tab").forEach((t) => t.classList.toggle("active", t === tab));
        renderGrid();
      },
    });
    tabs.append(tab);
  });
  renderGrid();

  document.getElementById("sticker-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("hidden");
  });
  panel.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => panel.classList.add("hidden"));
}
