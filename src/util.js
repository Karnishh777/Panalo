import {
  STORAGE_URL_PREFIX,
  MAX_IMAGE_DIMENSION,
  IMAGE_QUALITY,
  COMPRESS_MIN_BYTES,
} from "./config.js";

// Safe DOM builder — text is assigned via textContent, so any user-controlled
// value is inert. This is the single choke point that makes stored-XSS
// structurally impossible in rendered content.
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

// Only allow image URLs served from our own Supabase Storage over http(s).
export function safeImageUrl(url) {
  if (typeof url !== "string") return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!parsed.href.startsWith(STORAGE_URL_PREFIX)) return null;
  return parsed.href;
}

// Derive the auth redirect from where the app is actually served.
export function redirectUrl() {
  return window.location.origin + window.location.pathname;
}

// Run an async action while showing a busy state on `button`, preventing
// double-submits. Restores the original label afterward no matter what.
export async function withBusy(button, busyLabel, fn) {
  if (!button || button.disabled) return;
  const previousLabel = button.textContent;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  if (busyLabel) button.textContent = busyLabel;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = previousLabel;
  }
}

// Lightweight, accessible, non-blocking toast.
export function showToast(message, type = "error") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = el("div", { id: "toast-container", "aria-live": "polite", "aria-atomic": "true" });
    document.body.append(container);
  }
  const toast = el("div", { class: `toast${type ? ` toast-${type}` : ""}`, role: "status", text: message });
  container.append(toast);
  setTimeout(() => {
    toast.classList.add("toast-hide");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Run `task` over `items` with at most `limit` running at once, preserving
// input order in the result. Used where a job fans out to one request per
// item and firing them all simultaneously would be rude to the server (and
// to the user's connection) without being any faster.
export async function mapLimited(items, limit, task) {
  const results = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

// Deterministic hue [0-360) for any string — used to give each chat its own
// mood colour without needing anything stored per-chat. Same peer always
// picks up the same accent, so the visual identity stays stable across
// sessions and devices.
export function hueFor(seed) {
  const s = String(seed || "");
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

// Delegated click ripple. Any element matching RIPPLE_SELECTOR gets a
// material-style splash from where the pointer landed. Called once from
// startup; no per-button wiring.
const RIPPLE_SELECTOR = "#send-btn, .modal-btn, .danger-btn, .mini-btn, .primary-btn, [data-ripple]";
export function attachRipples() {
  document.addEventListener("pointerdown", (event) => {
    const target = event.target.closest(RIPPLE_SELECTOR);
    if (!target || target.disabled) return;
    const rect = target.getBoundingClientRect();
    target.style.setProperty("--rx", `${event.clientX - rect.left}px`);
    target.style.setProperty("--ry", `${event.clientY - rect.top}px`);
    target.classList.remove("rippling");
    // Force reflow so the animation restarts on rapid re-taps.
    void target.offsetWidth;
    target.classList.add("rippling");
    setTimeout(() => target.classList.remove("rippling"), 620);
  }, { passive: true });
}

// Fire a small vibration on devices that support it. No-op on desktop and on
// browsers that expose the API but disable it. Centralised so a future
// user-level "no haptics" toggle only needs one edit.
export function haptic(ms = 8) {
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    navigator.vibrate?.(ms);
  } catch {
    /* ignore */
  }
}

// Fill an avatar element: profile photo if there's a safe URL, else the
// colored-initial fallback.
export function setAvatar(node, name, url) {
  node.innerHTML = "";
  const safe = safeImageUrl(url);
  if (safe) {
    node.style.background = "var(--surface-2)";
    node.append(el("img", { src: safe, alt: "", loading: "lazy" }));
  } else {
    node.textContent = (name || "?").trim().charAt(0).toUpperCase();
    node.style.background = getAvatarColor(name || "?");
  }
}

// Deterministic avatar colour from a name, tinted to suit the current skin.
//
// This used to pick from eight fixed hex values. Two problems with that: the
// palette was neon (#00d69b, #6fd3ff, #ffe066), chosen for a dark theme, so
// it read as garish once the app went pale -- and eight colours means people
// collide constantly. In a list of ten chats you would expect several pairs
// sharing a colour, which defeats the point of a colour that identifies
// someone.
//
// The hue now comes from the same deterministic hash used elsewhere, giving
// 360 distinct values instead of 8, and how saturated and light that hue
// should be is left to CSS -- so the matte skin gets muted avatars on its
// pale ground and the OG skin gets brighter ones on its dark ground, from
// one source of truth.
let tintCache = { skin: null, sat: "42%", light: "46%" };

function avatarTint() {
  const skin = document.documentElement.getAttribute("data-skin") || "matte";
  if (tintCache.skin === skin) return tintCache;
  const root = getComputedStyle(document.documentElement);
  tintCache = {
    skin,
    sat: root.getPropertyValue("--avatar-sat").trim() || "42%",
    light: root.getPropertyValue("--avatar-light").trim() || "46%",
  };
  return tintCache;
}

export function getAvatarColor(name) {
  const { sat, light } = avatarTint();
  return `hsl(${hueFor(name)} ${sat} ${light})`;
}

// Clock times are shown 12-hour with am/pm ("9:41 pm"). The locale is pinned so
// the app reads the same everywhere rather than flipping to 24-hour on some
// devices and not others.
export function formatTime(value) {
  const d = value instanceof Date ? value : new Date(value || Date.now());
  return d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    .toLowerCase();
}

export function scrollToBottom() {
  const container = document.getElementById("messages-container");
  container.scrollTop = container.scrollHeight;
}

// Announce a message to screen readers via the aria-live region.
export function announce(message) {
  const region = document.getElementById("sr-announcer");
  if (region) region.textContent = message;
}

// Downscale large photos and re-encode to WebP/JPEG before upload. Any failure
// (or no real size gain) falls back to the original file untouched.
export async function compressImage(file) {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  if (file.size <= COMPRESS_MIN_BYTES) return file;

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob =
      (await new Promise((res) => canvas.toBlob(res, "image/webp", IMAGE_QUALITY))) ||
      (await new Promise((res) => canvas.toBlob(res, "image/jpeg", IMAGE_QUALITY)));

    if (!blob || blob.size >= file.size) return file;

    const ext = blob.type === "image/webp" ? "webp" : "jpg";
    const baseName = file.name.replace(/\.[^./\\]+$/, "") || "image";
    return new File([blob], `${baseName}.${ext}`, { type: blob.type });
  } catch {
    return file;
  }
}
