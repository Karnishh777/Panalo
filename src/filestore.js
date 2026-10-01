// Files on Cloudflare R2, through /api/files (functions/api/files).
//
// Shared by Panalo Chat (encrypted attachments) and Panalo Students (the
// archive). Used only when the site has an R2 bucket bound -- the Function's
// health check says so; otherwise both apps keep using Supabase Storage,
// and files already there keep working either way.
//
// Keys begin with their uploader (o/<owner>/...), so deleting an account
// can remove every file of theirs in one call.
import { supabaseClient } from "./client.js";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const R2_URL = new RegExp(`^/api/files/(o/${UUID}/(?:u/${UUID}|c/${UUID}/${UUID}|a/${UUID}))$`);

let health = null;
/** Whether R2 storage is available on this site (asked once). */
export function r2Available() {
  health ??= fetch("/api/files/health", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : {}))
    .then((j) => ({ r2: Boolean(j?.r2), signing: Boolean(j?.signing) }))
    .catch(() => ({ r2: false, signing: false }));
  return health.then((h) => h.r2);
}
export const r2CanSign = () => (health || Promise.resolve({})).then((h) => Boolean(h?.signing));

async function session() {
  const { data } = await supabaseClient.auth.getSession();
  return data.session || null;
}

/** The URL a key is served at (same origin, so both apps can use it). */
export const r2Url = (key) => `/api/files/${key}`;
/** A stored file URL that points at R2, and its key. */
export const isR2Url = (url) => typeof url === "string" && R2_URL.test(url);
export const r2KeyOf = (url) => R2_URL.exec(url || "")?.[1] || null;

/** A fresh key under the signed-in person's name. */
export async function newKey(kind, conversationId = null) {
  const s = await session();
  if (!s) throw new Error("Not signed in.");
  const base = `o/${s.user.id}`;
  if (kind === "c") return `${base}/c/${conversationId}/${crypto.randomUUID()}`;
  return `${base}/${kind}/${crypto.randomUUID()}`;
}

/** Upload with progress. Resolves { error } with a reason the UI can use. */
export async function r2Put(key, blob, { type = "", name = "file", onProgress, signal } = {}) {
  const s = await session();
  if (!s) return { error: { message: "Not signed in." } };
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", r2Url(key));
    xhr.setRequestHeader("authorization", `Bearer ${s.access_token}`);
    xhr.setRequestHeader("content-type", type || "application/octet-stream");
    xhr.setRequestHeader("x-file-name", encodeURIComponent(name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve({ error: null });
      let body = {};
      try {
        body = JSON.parse(xhr.responseText || "{}");
      } catch {}
      resolve({ error: { message: body.error || `HTTP ${xhr.status}`, status: xhr.status } });
    };
    xhr.onerror = () => resolve({ error: { message: "network error" } });
    xhr.onabort = () => resolve({ error: { message: "cancelled", cancelled: true } });
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

/** Fetch a file with the signed-in person's token. */
export async function r2Get(key) {
  const s = await session();
  return fetch(r2Url(key), { headers: s ? { authorization: `Bearer ${s.access_token}` } : {} });
}

/** A ten-minute link that works without a token (a new tab, a download). */
export async function r2Sign(key, { download = false } = {}) {
  const s = await session();
  if (!s || !(await r2CanSign())) return null;
  const res = await fetch("/api/files/sign", {
    method: "POST",
    headers: { authorization: `Bearer ${s.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ key, download }),
  });
  if (!res.ok) return null;
  return (await res.json()).url || null;
}

export async function r2Delete(key) {
  const s = await session();
  if (!s) return false;
  const res = await fetch(r2Url(key), { method: "DELETE", headers: { authorization: `Bearer ${s.access_token}` } });
  return res.ok;
}

/** Remove every file the signed-in person ever put on R2. */
export async function r2DeleteMine() {
  if (!(await r2Available())) return true;
  const s = await session();
  if (!s) return false;
  const res = await fetch("/api/files/mine", { method: "DELETE", headers: { authorization: `Bearer ${s.access_token}` } });
  return res.ok;
}

/**
 * Before an account is deleted: every file the person uploaded, on Supabase
 * Storage (listed by my_storage_objects(), phase 18) and on R2. Best effort
 * per file; returns how many Supabase files couldn't be removed.
 */
export async function deleteAllMyFiles() {
  let failed = 0;
  const { data, error } = await supabaseClient.rpc("my_storage_objects");
  if (!error && Array.isArray(data)) {
    const byBucket = new Map();
    for (const o of data) {
      if (!byBucket.has(o.bucket)) byBucket.set(o.bucket, []);
      byBucket.get(o.bucket).push(o.name);
    }
    for (const [bucket, names] of byBucket) {
      for (let i = 0; i < names.length; i += 100) {
        const chunk = names.slice(i, i + 100);
        const { error: e } = await supabaseClient.storage.from(bucket).remove(chunk);
        if (e) failed += chunk.length;
      }
    }
  }
  await r2DeleteMine().catch(() => false);
  return failed;
}
