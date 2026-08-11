// Browser notifications for new messages + per-chat mute. A single global channel
// receives inserts across all the user's conversations (RLS already scopes realtime
// to chats they belong to), so notifications work even when another chat is open.
import { supabaseClient } from "./client.js";
import { state } from "./state.js";

const MUTED_KEY = "panalo.muted";
let channel = null;
let enabled = false;

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

export function setNotificationsEnabled(on) {
  enabled = on;
  if (on && "Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function show(msg) {
  if (!enabled || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification(`New message from ${msg.username || "someone"}`, {
      body: msg.iv ? "🔒 Encrypted message" : (msg.content || "Sent a photo"),
      icon: "logo.svg",
      tag: msg.conversation_id,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* ignore */
  }
}

export function startNotifications() {
  if (channel) return;
  channel = supabaseClient
    .channel("notify:all")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
      const m = payload.new;
      if (!state.currentUser || m.user_id === state.currentUser.id) return;
      if (isMuted(m.conversation_id)) return;
      // Notify if the window is hidden, or the message is for a chat you're not viewing.
      if (document.hidden || m.conversation_id !== state.currentConversationId) show(m);
    })
    .subscribe();
}

export function stopNotifications() {
  if (channel) {
    supabaseClient.removeChannel(channel);
    channel = null;
  }
}
