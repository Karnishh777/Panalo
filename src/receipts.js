// Read receipts. Rather than a row per message per reader, each person stores
// one "I've read up to here" timestamp per conversation — so a message counts
// as read when everyone else's marker is at or past its creation time.
//
// The same table doubles as cross-device unread sync: the marker written on
// your phone is visible to your laptop.
import { supabaseClient } from "./client.js";
import { state } from "./state.js";

// conversation_id -> { user_id: last_read_at }
const readState = new Map();
let channel = null;
let onChange = null;

export function setReceiptListener(fn) {
  onChange = fn;
}

// Record that we've read everything in this conversation up to now.
export async function markConversationRead(convId) {
  if (!convId || !state.currentUser) return;
  await supabaseClient
    .from("conversation_reads")
    .upsert(
      { conversation_id: convId, user_id: state.currentUser.id, last_read_at: new Date().toISOString() },
      { onConflict: "conversation_id,user_id" }
    );
}

export async function loadReadState(convId) {
  const { data, error } = await supabaseClient
    .from("conversation_reads")
    .select("user_id, last_read_at")
    .eq("conversation_id", convId);
  if (error) return; // table not created yet — ticks stay at "sent"
  const map = {};
  (data || []).forEach((r) => {
    map[r.user_id] = r.last_read_at;
  });
  readState.set(convId, map);
}

// My own markers across all conversations, used to seed local unread state so
// chats read elsewhere don't come back as unread here.
export async function loadMyReadMarkers() {
  if (!state.currentUser) return {};
  const { data, error } = await supabaseClient
    .from("conversation_reads")
    .select("conversation_id, last_read_at")
    .eq("user_id", state.currentUser.id);
  if (error) return {};
  const out = {};
  (data || []).forEach((r) => {
    out[r.conversation_id] = r.last_read_at;
  });
  return out;
}

// Has every other member read this message?
// Timestamps are parsed rather than string-compared: Postgres returns
// "…+00:00" while the browser writes "…Z", and those don't sort together.
export function isReadByAll(convId, msg, memberIds) {
  const map = readState.get(convId);
  if (!map) return false;
  const others = (memberIds || []).filter((id) => id !== state.currentUser?.id);
  if (!others.length) return false;
  const sentAt = Date.parse(msg.created_at);
  return others.every((id) => map[id] && Date.parse(map[id]) >= sentAt);
}

// Live ticks: someone opening the chat updates their marker.
export function subscribeReceipts(convId) {
  if (channel) supabaseClient.removeChannel(channel);
  if (!convId) return;
  channel = supabaseClient
    .channel(`reads:${convId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "conversation_reads", filter: `conversation_id=eq.${convId}` },
      (payload) => {
        const row = payload.new;
        if (!row || !row.user_id) return;
        const map = readState.get(convId) || {};
        map[row.user_id] = row.last_read_at;
        readState.set(convId, map);
        onChange?.();
      }
    )
    .subscribe();
}

export function stopReceipts() {
  if (channel) {
    supabaseClient.removeChannel(channel);
    channel = null;
  }
  readState.clear();
}
