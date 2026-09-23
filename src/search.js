// Message search.
//
// Postgres full-text search can't help here: `content` is base64 ciphertext, so
// the server has nothing meaningful to index. Search therefore runs on this
// device, over messages decrypted with keys only this device holds — which is
// the price of end-to-end-ish encryption, and the honest way to do it.
//
// The index is built once per session (fetch + decrypt), then every keystroke
// filters it in memory.
import { supabaseClient } from "./client.js";
import { messagePlaintext, prefetchConversationKeys } from "./encryption.js";

// How many recent messages to pull into the searchable index. Deliberately
// bounded: decrypting is per-message work and this stays instant on a phone.
const INDEX_LIMIT = 1000;

let index = null; // [{ id, conversation_id, user_id, username, created_at, file_url, text }]
let building = null;

export function invalidateSearchIndex() {
  index = null;
  building = null;
}

async function buildIndex() {
  const { data, error } = await supabaseClient
    .from("messages")
    .select("id, conversation_id, user_id, username, content, iv, file_url, created_at")
    .order("created_at", { ascending: false })
    .limit(INDEX_LIMIT);
  if (error) return [];

  // Every conversation key this batch needs, in one query, BEFORE decrypting
  // anything. messagePlaintext() otherwise fetches a key the first time it
  // meets each conversation, strictly in sequence -- so the loop below used
  // to stall on a fresh network round trip per chat. Decrypting a thousand
  // messages takes about 19ms; twenty of those round trips take one to four
  // seconds. This is the whole performance problem, and it was never the
  // cryptography.
  await prefetchConversationKeys((data || []).map((m) => m.conversation_id));

  const rows = [];
  for (const m of data || []) {
    // Now purely local work: every key is already in memory.
    const text = m.content ? await messagePlaintext(m) : m.file_url ? "Attachment" : "";
    rows.push({
      id: m.id,
      conversation_id: m.conversation_id,
      user_id: m.user_id,
      username: m.username,
      created_at: m.created_at,
      file_url: m.file_url,
      text: text || "",
    });
  }
  return rows;
}

export async function ensureIndex() {
  if (index) return index;
  if (!building) building = buildIndex().then((rows) => (index = rows));
  return building;
}

// Newest matches first. Returns at most `limit` hits.
export async function searchMessages(query, limit = 30) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const rows = await ensureIndex();
  const hits = [];
  for (const row of rows) {
    if (row.text.toLowerCase().includes(q)) {
      hits.push(row);
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

// Add a newly-sent/received message so it is searchable at once.
//
// This existed but was never called, and neither was invalidateSearchIndex.
// So the index was built on the first search of a session and then never
// touched again: every message sent or received afterwards was invisible to
// search until a reload. That is a correctness bug wearing a performance
// bug's clothes -- the results were not slow, they were quietly wrong.
export function addToIndex(msg, text) {
  if (!index) return; // nothing built yet; the first search will include it
  if (index.some((r) => r.id === msg.id)) return;
  index.unshift({
    id: msg.id,
    conversation_id: msg.conversation_id,
    user_id: msg.user_id,
    username: msg.username,
    created_at: msg.created_at,
    file_url: msg.file_url,
    text: text || "",
  });
}

// Drop a deleted message, so search can't offer a result that no longer
// exists and would fail to open.
export function removeFromIndex(msgId) {
  if (!index) return;
  const at = index.findIndex((r) => r.id === msgId);
  if (at !== -1) index.splice(at, 1);
}
