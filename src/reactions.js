// Emoji reactions. Reaction rows are tiny and unencrypted by design — an emoji
// carries no private content, and keeping them in the clear lets counts be
// grouped without unwrapping a key for every message.
import { supabaseClient } from "./client.js";
import { reportChannelStatus, forgetChannel } from "./connection.js";
import { state } from "./state.js";

export const REACTION_EMOJIS = ["❤️", "👍", "😂", "😮", "😢", "🙏", "🔥", "🎉"];

// message_id -> [{ user_id, emoji }]
const byMessage = new Map();
const REACTIONS_CHANNEL = "reactions:all";
let channel = null;
let onChange = null; // chat.js re-renders the pills for a message

export function setReactionListener(fn) {
  onChange = fn;
}

export function reactionsFor(messageId) {
  return byMessage.get(messageId) || [];
}

// Group into [{ emoji, count, mine }] for rendering, most-reacted first.
export function groupedReactions(messageId) {
  const rows = reactionsFor(messageId);
  const map = new Map();
  for (const r of rows) {
    const entry = map.get(r.emoji) || { emoji: r.emoji, count: 0, mine: false };
    entry.count++;
    if (r.user_id === state.currentUser?.id) entry.mine = true;
    map.set(r.emoji, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function addLocal(row) {
  const rows = byMessage.get(row.message_id) || [];
  if (rows.some((r) => r.user_id === row.user_id && r.emoji === row.emoji)) return false;
  rows.push({ user_id: row.user_id, emoji: row.emoji });
  byMessage.set(row.message_id, rows);
  return true;
}

function removeLocal(row) {
  const rows = byMessage.get(row.message_id);
  if (!rows) return false;
  const i = rows.findIndex((r) => r.user_id === row.user_id && r.emoji === row.emoji);
  if (i < 0) return false;
  rows.splice(i, 1);
  return true;
}

// Load reactions for a batch of messages (the page currently on screen).
export async function loadReactions(messageIds, { replace = true } = {}) {
  if (replace) byMessage.clear();
  const ids = messageIds.filter((id) => typeof id === "string" && !id.startsWith("temp-"));
  if (!ids.length) return;
  const { data, error } = await supabaseClient
    .from("message_reactions")
    .select("message_id, user_id, emoji")
    .in("message_id", ids);
  if (error) return; // table not created yet — reactions simply stay empty
  (data || []).forEach(addLocal);
}

// Toggle my reaction. Applied locally first so the pill responds instantly;
// the realtime echo is deduped by addLocal/removeLocal.
export async function toggleReaction(messageId, emoji) {
  const me = state.currentUser?.id;
  if (!me) return;
  const mine = reactionsFor(messageId).some((r) => r.user_id === me && r.emoji === emoji);

  if (mine) {
    removeLocal({ message_id: messageId, user_id: me, emoji });
    onChange?.(messageId);
    const { error } = await supabaseClient
      .from("message_reactions")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", me)
      .eq("emoji", emoji);
    if (error) {
      addLocal({ message_id: messageId, user_id: me, emoji }); // put it back
      onChange?.(messageId);
    }
    return;
  }

  addLocal({ message_id: messageId, user_id: me, emoji });
  onChange?.(messageId);
  const { error } = await supabaseClient
    .from("message_reactions")
    .insert([{ message_id: messageId, user_id: me, emoji }]);
  if (error) {
    removeLocal({ message_id: messageId, user_id: me, emoji });
    onChange?.(messageId);
  }
}

// One global subscription: reaction rows carry no conversation id, and RLS
// already limits them to conversations we belong to.
export function startReactions() {
  if (channel) return;
  channel = supabaseClient
    .channel(REACTIONS_CHANNEL)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_reactions" }, (payload) => {
      if (addLocal(payload.new)) onChange?.(payload.new.message_id);
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "message_reactions" }, (payload) => {
      if (removeLocal(payload.old)) onChange?.(payload.old.message_id);
    })
    .subscribe((status) => reportChannelStatus(REACTIONS_CHANNEL, status));
}

export function stopReactions() {
  if (channel) {
    forgetChannel(REACTIONS_CHANNEL);
    supabaseClient.removeChannel(channel);
    channel = null;
  }
  byMessage.clear();
}
