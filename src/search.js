// Message search.
//
// Postgres full-text search can't help here: `content` is base64 ciphertext, so
// the server has nothing meaningful to index. Search therefore runs on this
// device, over messages decrypted with keys only this device holds.
//
// WHY NOT SERVER-SIDE SEARCH
// It is possible — blind indexing stores an HMAC of each word so the server can
// match without decrypting. It was rejected: it leaks which messages share a
// term, which is enough for frequency analysis against a known language by
// anyone holding the database. That is a real privacy regression for an app
// whose whole point is that the server learns as little as possible, and it is
// why Signal doesn't do it either. The cap on search was a client problem, and
// it is fixed here as one.
//
// HOW THE INDEX WORKS
// The index persists in IndexedDB and grows. The first build on a device pages
// back through history; every later session loads what it already has and
// fetches only what arrived since. So search coverage is "everything this
// device has ever seen", not "the newest thousand messages" — the old cap made
// results silently incomplete, which is worse than slow because an incomplete
// answer looks exactly like a complete one.
//
// The stored index holds DECRYPTED text. That is not a new exposure: the
// private key is already cached in IndexedDB so reloads stay unlocked, so
// anyone with the unlocked device could decrypt everything anyway. It is
// cleared on logout alongside that key.
import { supabaseClient } from "./client.js";
import { messagePlaintext, prefetchConversationKeys } from "./encryption.js";
import { state } from "./state.js";

// How many recent messages to pull into the searchable index. Deliberately
// bounded: decrypting is per-message work and this stays instant on a phone.
// Pages fetched when first building the index on a device. Decrypting is
// cheap (measured: ~19ms per thousand); the cost is transfer, so history is
// pulled in pages with a generous ceiling rather than all at once.
const PAGE_SIZE = 1000;
const INITIAL_MAX = 10000;

const DB_NAME = "panalo-search";
const STORE = "rows";
const META = "meta";

let index = null; // [{ id, conversation_id, user_id, username, created_at, file_url, text }]
let building = null;

// ---- Persistence -----------------------------------------------------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readPersisted() {
  try {
    const db = await openDb();
    const rows = await new Promise((resolve) => {
      const r = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => resolve([]);
    });
    const owner = await new Promise((resolve) => {
      const r = db.transaction(META, "readonly").objectStore(META).get("owner");
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    });
    return { rows, owner };
  } catch {
    return { rows: [], owner: null };
  }
}

async function writePersisted(rows, owner) {
  try {
    const db = await openDb();
    await new Promise((resolve) => {
      const tx = db.transaction([STORE, META], "readwrite");
      const store = tx.objectStore(STORE);
      for (const row of rows) store.put(row);
      tx.objectStore(META).put(owner, "owner");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    /* private mode, or quota -- search still works for this session */
  }
}

// Decrypted message text must not outlive the session allowed to read it, and
// must never be inherited by a different account on the same device.
export async function clearPersistedIndex() {
  index = null;
  building = null;
  try {
    const db = await openDb();
    await new Promise((resolve) => {
      const tx = db.transaction([STORE, META], "readwrite");
      tx.objectStore(STORE).clear();
      tx.objectStore(META).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    /* nothing to clear */
  }
}

export function invalidateSearchIndex() {
  index = null;
  building = null;
}

// ---- Building --------------------------------------------------------

async function decryptRows(data) {
  // Every conversation key this batch needs, in ONE query, before decrypting
  // anything. Otherwise messagePlaintext() fetches a key the first time it
  // meets each conversation, strictly in sequence -- twenty conversations was
  // one to four seconds of serialised round trips against 19ms of real work.
  await prefetchConversationKeys(data.map((m) => m.conversation_id));
  const rows = [];
  for (const m of data) {
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

const FIELDS = "id, conversation_id, user_id, username, content, iv, file_url, created_at";

async function fetchPage({ before, after, limit }) {
  let q = supabaseClient.from("messages").select(FIELDS);
  if (before) q = q.lt("created_at", before);
  if (after) q = q.gt("created_at", after);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
  return error ? [] : data || [];
}

async function buildIndex() {
  const me = state.currentUser?.id || null;
  const { rows: persisted, owner } = await readPersisted();

  // A different account on this device must never see the last one's messages.
  const usable = owner && me && owner === me ? persisted : [];
  if (persisted.length && !usable.length) await clearPersistedIndex();

  const known = new Map(usable.map((r) => [r.id, r]));
  const newest = usable.reduce((max, r) => (!max || r.created_at > max ? r.created_at : max), null);

  const fresh = [];
  if (newest) {
    // Catch up: only what arrived since this device last indexed.
    let after = newest;
    for (;;) {
      const page = await fetchPage({ after, limit: PAGE_SIZE });
      if (!page.length) break;
      fresh.push(...page);
      if (page.length < PAGE_SIZE) break;
      after = page[0].created_at; // pages come newest-first
    }
  } else {
    // First time on this device: page backwards through history.
    let before = null;
    while (fresh.length < INITIAL_MAX) {
      const page = await fetchPage({ before, limit: PAGE_SIZE });
      if (!page.length) break;
      fresh.push(...page);
      if (page.length < PAGE_SIZE) break;
      before = page[page.length - 1].created_at;
    }
  }

  const decrypted = fresh.length ? await decryptRows(fresh) : [];
  for (const row of decrypted) known.set(row.id, row);

  const all = [...known.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  if (decrypted.length) await writePersisted(decrypted, me);
  return all;
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

// Add a newly-sent/received message so it is searchable at once, and keep it
// across reloads.
//
// Both this and invalidateSearchIndex existed but were never called, so the
// index was built on the first search of a session and never touched again --
// every message sent or received afterwards was invisible to search until a
// reload. The results were not slow, they were quietly wrong.
export function addToIndex(msg, text) {
  const row = {
    id: msg.id,
    conversation_id: msg.conversation_id,
    user_id: msg.user_id,
    username: msg.username,
    created_at: msg.created_at,
    file_url: msg.file_url,
    text: text || "",
  };
  // Persist regardless of whether an index is loaded in memory: a message
  // that arrives before the first search still belongs in the stored index.
  writePersisted([row], state.currentUser?.id || null);
  if (!index) return;
  if (index.some((r) => r.id === msg.id)) return;
  index.unshift(row);
}

// Drop a deleted message, so search can't offer a result that no longer exists
// and would fail to open.
export function removeFromIndex(msgId) {
  if (index) {
    const at = index.findIndex((r) => r.id === msgId);
    if (at !== -1) index.splice(at, 1);
  }
  openDb()
    .then(
      (db) =>
        new Promise((resolve) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).delete(msgId);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        })
    )
    .catch(() => {
      /* nothing stored */
    });
}
