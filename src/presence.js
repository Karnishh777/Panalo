// Online presence via Supabase Realtime Presence. Every logged-in user joins one
// global presence channel; we track who's online so chats can show a live status.
// Ephemeral — nothing is stored in the database.
import { supabaseClient } from "./client.js";

const onlineUsers = new Set();
let channel = null;
let listener = null;

export function isOnline(userId) {
  return onlineUsers.has(userId);
}

// Register a callback invoked whenever the online set changes.
export function setPresenceListener(cb) {
  listener = cb;
}

export function startPresence(user) {
  if (channel || !user) return;
  channel = supabaseClient.channel("presence:global", {
    config: { presence: { key: user.id } },
  });

  const sync = () => {
    onlineUsers.clear();
    try {
      Object.keys(channel.presenceState()).forEach((id) => onlineUsers.add(id));
    } catch {
      /* ignore */
    }
    if (listener) listener();
  };

  channel
    .on("presence", { event: "sync" }, sync)
    .on("presence", { event: "join" }, sync)
    .on("presence", { event: "leave" }, sync)
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        try {
          await channel.track({ online_at: new Date().toISOString() });
        } catch {
          /* ignore */
        }
      }
    });
}

export function stopPresence() {
  if (channel) {
    supabaseClient.removeChannel(channel);
    channel = null;
  }
  onlineUsers.clear();
}
