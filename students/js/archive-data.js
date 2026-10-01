// The archive: files in a PRIVATE bucket (phase 16). Where a file lives
// decides who can read it -- u/<you>/... only you, c/<conversation>/...
// everyone in that conversation -- and Storage policies enforce it. Files
// are fetched with the signed-in session (download), never from a public
// URL. They are NOT end-to-end encrypted; the app says so.
import { supabaseClient } from "../../src/client.js";
import { state } from "../../src/state.js";
import { MAX_FILE_BYTES } from "../../src/config.js";
import { store, emit } from "./store.js";
import { safeBlobType } from "./model/safe-type.js";

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

export async function uploadResource(file, { title, shelf, conversationId = null, note = null } = {}) {
  if (!file) return { error: { message: "Choose a file." } };
  if (file.size > MAX_FILE_BYTES) return { error: { message: "Files can be up to 50 MB." } };
  if (store.resources && usedBytes() + file.size > ARCHIVE_QUOTA) return { error: { message: "Your archive is full (200 MB). Remove something to make room." } };
  const path = conversationId ? `c/${conversationId}/${crypto.randomUUID()}` : `u/${state.currentUser.id}/${crypto.randomUUID()}`;
  const { error: upErr } = await supabaseClient.storage.from(BUCKET).upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (upErr) return { error: { message: /row-level|policy|403/i.test(upErr.message || "") ? "You can't put files there." : "The upload failed. Check your connection." } };
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
    await supabaseClient.storage.from(BUCKET).remove([path]);
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
  const { data, error } = await supabaseClient.storage.from(BUCKET).download(r.object_path);
  if (error || !data) return null;
  const url = URL.createObjectURL(new Blob([data], { type: safeBlobType(r) }));
  blobs.set(r.id, url);
  if (blobs.size > 12) {
    const [k, v] = blobs.entries().next().value;
    URL.revokeObjectURL(v);
    blobs.delete(k);
  }
  return url;
}

export async function downloadResource(r) {
  const url = await resourceUrl(r);
  if (!url) return false;
  const a = document.createElement("a");
  a.href = url;
  a.download = r.file_name || r.title;
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
  const { error } = await supabaseClient.from("resources").delete().eq("id", r.id);
  if (error) return { error };
  // Only the uploader can remove the bytes; a host removing someone else's
  // file removes the listing, which is what makes it unreachable in the app.
  if (r.owner_id === state.currentUser.id) await supabaseClient.storage.from(BUCKET).remove([r.object_path]);
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
