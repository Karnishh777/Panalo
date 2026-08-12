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
import { messagePlaintext } from "./encryption.js";

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

  const rows = [];
  for (const m of data || []) {
    // Decrypt sequentially-ish; keys are cached per conversation after the first.
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

// Add a newly-sent/received message so a fresh message is searchable at once.
export function addToIndex(msg, text) {
  if (!index) return;
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
