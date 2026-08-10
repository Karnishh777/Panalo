import {
  STORAGE_URL_PREFIX,
  AVATAR_COLORS,
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

// Deterministic avatar color from a name.
export function getAvatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
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
