// The archive: files in a PRIVATE bucket (phase 16). Where a file lives
// decides who can read it -- u/<you>/... only you, c/<conversation>/...
// everyone in that conversation -- and Storage policies enforce it. Files
// are fetched with the signed-in session (download), never from a public
// URL. They are NOT end-to-end encrypted; the app says so.
import { supabaseClient } from "../../src/client.js";
import { state } from "../../src/state.js";
import { MAX_FILE_BYTES, SUPABASE_URL, SUPABASE_KEY } from "../../src/config.js";
import { store, emit } from "./store.js";
import { safeBlobType } from "./model/safe-type.js";
import { r2Available, newKey, r2Put, r2Get, r2Sign, r2Delete } from "../../src/filestore.js";

// Files whose key starts with o/ live on Cloudflare R2 (src/filestore.js);
// the rest are in Supabase Storage. New uploads go to R2 when the site has it.
const onR2 = (r) => String(r.object_path || "").startsWith("o/");

const BUCKET = "student-resources";
export const ARCHIVE_QUOTA = 200 * 1024 * 1024;

store.resources = null;
store.owners = {}; // user id -> username, for provenance labels

export async function loadResources() {
  const { data, error } = await supabaseClient.from("resources").select("*").order("created_at", { ascending: false }).limit(1000);
  if (error) return { error };
  store.resources = data || [];
  const ids = [...new Set(store.resources.map((r) => r.owner_id))].filter((id) => !store.owners[id]);
  if (ids.length) {
    const { data: profs } = await supabaseClient.from("profiles").select("id, username").in("id", ids);
    for (const p of profs || []) store.owners[p.id] = p.username;
  }
  store.owners[state.currentUser.id] = state.currentUsername;
  emit("resources");
  return {};
}

export function usedBytes() {
  return (store.resources || []).filter((r) => r.owner_id === state.currentUser.id).reduce((n, r) => n + Number(r.size_bytes || 0), 0);
}

// Send the bytes with progress. supabase-js uploads with fetch(), which can't
// report progress, so a big file looked frozen for many seconds. This is
// the same Storage endpoint and the same session token, over XHR. (Where
// the client has no endpoint to talk to -- the QA mock -- it falls back to
// supabase-js and reports 0% then 100%.)
function sendBytes(path, file, { onProgress, signal } = {}) {
  const api = supabaseClient.storage.from(BUCKET);
  if (!supabaseClient.storage?.url || typeof XMLHttpRequest === "undefined") {
    onProgress?.(0);
    return api.upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false }).then((r) => {
      if (!r.error) onProgress?.(1);
      return r;
    });
  }
  return supabaseClient.auth.getSession().then(({ data }) => new Promise((resolve) => {
    const token = data.session?.access_token;
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`);
    xhr.setRequestHeader("apikey", SUPABASE_KEY);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve({ data: { path }, error: null });
      let body = {};
      try {
        body = JSON.parse(xhr.responseText || "{}");
      } catch {}
      resolve({ data: null, error: { message: body.message || body.error || `HTTP ${xhr.status}`, statusCode: String(body.statusCode || xhr.status) } });
    };
    xhr.onerror = () => resolve({ data: null, error: { message: "network error" } });
    xhr.onabort = () => resolve({ data: null, error: { message: "cancelled", cancelled: true } });
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  }));
}

export async function uploadResource(file, { title, shelf, conversationId = null, note = null, onProgress, signal } = {}) {
  if (!file) return { error: { message: "Choose a file." } };
  if (!file.size) return { error: { message: "That file is empty." } };
  if (file.size > MAX_FILE_BYTES) return { error: { message: "Files can be up to 50 MB." } };
  if (store.resources && usedBytes() + file.size > ARCHIVE_QUOTA) return { error: { message: "Your archive is full (200 MB). Remove something to make room." } };
  let path;
  let upErr;
  if (await r2Available()) {
    path = await newKey(conversationId ? "c" : "u", conversationId);
    ({ error: upErr } = await r2Put(path, file, { type: file.type, name: file.name, onProgress, signal }));
    if (upErr && !upErr.cancelled) {
      const st = upErr.status;
      upErr = { message: st === 507 ? "quota" : st === 403 ? "policy" : st === 413 ? "too large" : upErr.message, statusCode: String(st || "") };
    }
  } else {
    path = conversationId ? `c/${conversationId}/${crypto.randomUUID()}` : `u/${state.currentUser.id}/${crypto.randomUUID()}`;
    ({ error: upErr } = await sendBytes(path, file, { onProgress, signal }));
  }
  if (upErr) {
    if (upErr.cancelled) return { error: { message: "Upload cancelled.", cancelled: true } };
    const m = upErr.message || "";
    return {
      error: {
        message: /quota|507/i.test(m + upErr.statusCode)
          ? "Your storage is full. Remove something to make room."
          : /row-level|policy|403|unauthorized/i.test(m + upErr.statusCode)
          ? "You can't put files there — or your archive is full."
          : /413|too large|maximum/i.test(m + upErr.statusCode)
            ? "That file is bigger than this server accepts."
            : "The upload failed. Check your connection.",
      },
    };
  }
  const row = {
    title: (title || file.name || "Untitled").trim().slice(0, 120) || "Untitled",
    shelf: shelf ? shelf.trim().slice(0, 40) || null : null,
    file_name: (file.name || "file").slice(0, 200),
    mime_type: file.type ? file.type.slice(0, 120) : null,
    size_bytes: file.size,
    object_path: path,
    conversation_id: conversationId,
    note: note ? note.trim().slice(0, 280) || null : null,
  };
  const { data, error } = await supabaseClient.from("resources").insert([row]).select().single();
  if (error) {
    // Don't leave an orphaned file behind a failed row.
    if (path.startsWith("o/")) await r2Delete(path);
    else await supabaseClient.storage.from(BUCKET).remove([path]);
    return { error: { message: error.code === "54000" ? error.message : "Couldn't add it to the archive." } };
  }
  if (store.resources) store.resources.unshift(data);
  emit("resources");
  return { data };
}

export const saveToArchive = (file, opts) => uploadResource(file, { ...opts, conversationId: null });

const blobs = new Map(); // resource id -> object URL (a few, for previews)
export async function resourceUrl(r) {
  if (blobs.has(r.id)) return blobs.get(r.id);
  let data = null;
  if (onR2(r)) {
    const res = await r2Get(r.object_path).catch(() => null);
    if (!res?.ok) return null;
    data = await res.blob();
  } else {
    const got = await supabaseClient.storage.from(BUCKET).download(r.object_path);
    if (got.error || !got.data) return null;
    data = got.data;
  }
  const url = URL.createObjectURL(new Blob([data], { type: safeBlobType(r) }));
  blobs.set(r.id, url);
  if (blobs.size > 12) {
    const [k, v] = blobs.entries().next().value;
    URL.revokeObjectURL(v);
    blobs.delete(k);
  }
  return url;
}

// A short-lived link to the file on Storage itself. Downloading through it
// streams straight to disk -- no copy of a 50 MB file held in memory first.
export async function signedUrl(r, { download = false } = {}) {
  if (onR2(r)) return r2Sign(r.object_path, { download });
  const api = supabaseClient.storage.from(BUCKET);
  if (typeof api.createSignedUrl !== "function") return null;
  const { data, error } = await api.createSignedUrl(r.object_path, 600, download ? { download: r.file_name || r.title || true } : undefined);
  return error ? null : data?.signedUrl || null;
}

// PDFs open in the browser's own viewer from that link. Not from a blob: a
// blob: page inherits this site's CSP, whose object-src 'none' stops
// Chrome's PDF viewer, so the tab stayed blank. The link is checked first:
// only something Storage really serves as a PDF is opened in a tab.
export async function pdfLink(r) {
  const url = await signedUrl(r);
  if (!url) return null;
  try {
    const head = await fetch(url, { method: "HEAD" });
    if (!head.ok || !/^application\/pdf\b/i.test(head.headers.get("content-type") || "")) return null;
  } catch {
    return null;
  }
  return url;
}

export async function downloadResource(r) {
  const url = (await signedUrl(r, { download: true })) || (await resourceUrl(r));
  if (!url) return false;
  const a = document.createElement("a");
  a.href = url;
  a.download = r.file_name || r.title;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  return true;
}

export async function updateResource(r, patch) {
  const { data, error } = await supabaseClient.from("resources").update(patch).eq("id", r.id).select().single();
  if (error) return { error };
  Object.assign(r, data);
  emit("resources");
  return { data };
}

export async function deleteResource(r) {
  // The bytes first, then the listing. Reading a shared file requires its
  // listing (phase 17), so once the row is gone a host could no longer see
  // the object to remove it. The uploader, or a host of the circle, may.
  if (onR2(r)) await r2Delete(r.object_path);
  else await supabaseClient.storage.from(BUCKET).remove([r.object_path]);
  const { error } = await supabaseClient.from("resources").delete().eq("id", r.id);
  if (error) return { error };
  const url = blobs.get(r.id);
  if (url) URL.revokeObjectURL(url);
  blobs.delete(r.id);
  store.resources = (store.resources || []).filter((x) => x.id !== r.id);
  emit("resources");
  return {};
}

export function clearArchiveCache() {
  for (const url of blobs.values()) URL.revokeObjectURL(url);
  blobs.clear();
}
