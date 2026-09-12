// Incoming-message alerts + per-chat mute.
//
// A single global channel receives inserts across all of the user's
// conversations (RLS already scopes realtime to chats they belong to), so this
// drives BOTH alerts and unread counts even when another chat is open.
//
// Three independent layers, so an alert is never silently swallowed:
//   1. in-app banner — always available, needs no permission (the reliable one)
//   2. sound         — a short WebAudio chime, no asset to load
//   3. desktop       — real OS notifications, only if the browser granted them
import { supabaseClient } from "./client.js";
import { state } from "./state.js";
import { el, showToast } from "./util.js";
import { messagePlaintext } from "./encryption.js";
import { describeText } from "./stickers.js";

const MUTED_KEY = "panalo.muted";
let channel = null;
let prefs = { desktop: false, inApp: true, sound: true };
let inboxListener = null; // chat.js: update unread + list previews
let openChatListener = null; // chat.js: focus a conversation when a banner is clicked

// ---- Mute ----
function getMuted() {
  try {
    return JSON.parse(localStorage.getItem(MUTED_KEY) || "[]");
  } catch {
    return [];
  }
}
export function isMuted(convId) {
  return getMuted().includes(convId);
}
export function toggleMute(convId) {
  const list = getMuted();
  const i = list.indexOf(convId);
  if (i >= 0) list.splice(i, 1);
  else list.push(convId);
  try {
    localStorage.setItem(MUTED_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list.includes(convId);
}
export function forgetMute(convId) {
  const list = getMuted().filter((id) => id !== convId);
  try {
    localStorage.setItem(MUTED_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function setAlertPrefs(next) {
  prefs = { ...prefs, ...next };
}
export function setInboxListener(fn) {
  inboxListener = fn;
}
export function setOpenChatListener(fn) {
  openChatListener = fn;
}

// ---- Desktop notifications ----
export function notificationsSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}
export function notificationPermission() {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

// Ask the browser for permission and report what actually happened — the old
// code failed silently when permission was already denied, which is why
// notifications appeared to do nothing at all.
export async function requestDesktopPermission() {
  if (!notificationsSupported()) {
    showToast("This browser can't show desktop notifications — in-app alerts will be used.", "");
    return "unsupported";
  }
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") {
    showToast("Notifications are blocked. Click the 🔒 icon next to the web address → Notifications → Allow.", "");
    return "denied";
  }
  const result = await Notification.requestPermission();
  if (result === "granted") showToast("Desktop notifications are on 🔔", "success");
  else showToast("You dismissed the permission prompt — in-app alerts will still work.", "");
  return result;
}

// Chrome ignores SVG notification icons, so draw a PNG once and reuse it.
let iconDataUrl = null;
function notificationIcon() {
  if (iconDataUrl) return iconDataUrl;
  try {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 64, 64);
    grad.addColorStop(0, "#6f4e37");
    grad.addColorStop(1, "#a9784f");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#fff";
    g.font = "bold 40px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("P", 32, 34);
    iconDataUrl = c.toDataURL("image/png");
  } catch {
    iconDataUrl = null;
  }
  return iconDataUrl;
}

// Registered service worker, if any. Notifications raised through it land in
// the OS notification centre and survive the tab losing focus, which a
// page-created Notification does not reliably do.
let swRegistration = null;
export function setServiceWorker(reg) {
  swRegistration = reg;
}

function showDesktop(title, body, convId) {
  if (!prefs.desktop || notificationPermission() !== "granted") return;

  // Preferred path: let the service worker raise it.
  if (swRegistration?.active) {
    try {
      swRegistration.active.postMessage({
        type: "notify",
        title,
        body,
        icon: notificationIcon() || undefined,
        tag: convId,
        conversationId: convId,
      });
      return;
    } catch {
      /* fall through to the page notification */
    }
  }

  try {
    const n = new Notification(title, { body, icon: notificationIcon() || undefined, tag: convId });
    n.onclick = () => {
      window.focus();
      openChatListener?.(convId);
      n.close();
    };
  } catch {
    /* some browsers require a service worker; the in-app banner still fires */
  }
}

// ---- Sound (generated, no asset) ----
let audioCtx = null;
export function playChime() {
  // Tiny haptic tap alongside the chime — makes the phone-in-pocket case feel
  // alive without being loud. Guarded by prefers-reduced-motion via util.haptic.
  try {
    if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      navigator.vibrate?.(10);
    }
  } catch {
    /* ignore */
  }
  if (!prefs.sound) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const now = audioCtx.currentTime;
    // Two quick notes — a friendly "ta-da" rather than a harsh beep.
    [
      [880, 0],
      [1174.7, 0.09],
    ].forEach(([freq, offset]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.16, now + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.25);
    });
  } catch {
    /* audio is a nicety, never a failure */
  }
}

// ---- In-app banner (the layer that always works) ----
function bannerHost() {
  let host = document.getElementById("alert-host");
  if (!host) {
    host = el("div", { id: "alert-host", "aria-live": "polite" });
    document.body.append(host);
  }
  return host;
}

export function showBanner(title, body, convId) {
  if (!prefs.inApp) return;
  const host = bannerHost();
  // Keep the stack short so alerts never cover the app.
  while (host.children.length >= 3) host.firstChild.remove();

  const card = el("div", { class: "alert-card", role: "status" }, [
    el("div", { class: "alert-avatar", text: (title || "?").trim().charAt(0).toUpperCase() }),
    el("div", { class: "alert-body" }, [
      el("div", { class: "alert-title", text: title }),
      el("div", { class: "alert-text", text: body }),
    ]),
    el("button", {
      class: "alert-close",
      type: "button",
      text: "✕",
      "aria-label": "Dismiss",
      onClick: (e) => {
        e.stopPropagation();
        card.remove();
      },
    }),
  ]);
  if (convId) {
    card.addEventListener("click", () => {
      openChatListener?.(convId);
      card.remove();
    });
  }
  host.append(card);
  setTimeout(() => {
    card.classList.add("alert-hide");
    setTimeout(() => card.remove(), 300);
  }, 6000);
}

// Let the user prove to themselves that alerts work.
export async function sendTestAlert() {
  if (prefs.desktop) await requestDesktopPermission();
  showBanner("Panalo", "This is a test alert — you're all set! 🎉", null);
  playChime();
  showDesktop("Panalo", "This is a test alert — you're all set! 🎉", "test");
}

// ---- Realtime inbox ----
async function alertFor(msg) {
  const body = msg.file_url
    ? "📎 Sent an attachment"
    : describeText(await messagePlaintext(msg)) || "New message";
  const title = msg.username || "New message";
  showBanner(title, body, msg.conversation_id);
  playChime();
  showDesktop(title, body, msg.conversation_id);
}

export function startNotifications() {
  if (channel) return;
  channel = supabaseClient
    .channel("notify:all")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
      const m = payload.new;
      if (!state.currentUser || m.user_id === state.currentUser.id) return;

      // Unread counts + chat-list previews update for every message, always.
      inboxListener?.(m);

      if (isMuted(m.conversation_id)) return;
      // Don't alert for the chat you're actively looking at.
      const watching = m.conversation_id === state.currentConversationId && !document.hidden;
      if (watching) return;
      alertFor(m);
    })
    .subscribe();
}

export function stopNotifications() {
  if (channel) {
    supabaseClient.removeChannel(channel);
    channel = null;
  }
}
