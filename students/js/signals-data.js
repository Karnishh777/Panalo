// Signals' data: conversations, unread, messages, circles and rooms.
//
// Same tables, same encryption and the same rules as Panalo Chat -- a
// message sent here is an ordinary encrypted message there, and vice versa.
// What is new is the shape: every group has a context (kind), rooms end,
// and rooms open with a code and a host at the door (phase 16).
import { supabaseClient, findProfileByUsername } from "../../src/client.js";
import { state } from "../../src/state.js";
import { mapLimited, compressImage } from "../../src/util.js";
import { getConversationKey, prefetchConversationKeys, provisionConversationKey, keyForSending, messagePlaintext } from "../../src/encryption.js";
import { SEND } from "../../src/sendpolicy.js";
import { describeKeyRequest } from "../../src/keystatus.js";
import { uploadEncrypted, primeAttachmentCache } from "../../src/attachments.js";
import { countUnread, mergeServerMarkers, markRead } from "../../src/unread.js";
import { loadMyReadMarkers, markConversationRead } from "../../src/receipts.js";
import { MAX_FILE_BYTES, MESSAGES_PAGE_SIZE } from "../../src/config.js";
import { store, emit, api } from "./store.js";

export const CONTEXTS = [
  { id: "people", label: "People", sub: "one to one", tone: "tone-signal" },
  { id: "crew", label: "Crew", sub: "friends", tone: "tone-drift" },
  { id: "study", label: "Study circles", sub: "learning together", tone: "tone-focus" },
  { id: "class", label: "Classes", sub: "a class and its teacher", tone: "tone-time" },
  { id: "project", label: "Projects", sub: "making something", tone: "tone-world" },
  { id: "event", label: "Rooms", sub: "temporary, with a door", tone: "tone-time" },
  { id: "other", label: "Other groups", sub: "made in Panalo Chat", tone: "tone-signal" },
];

export function contextOf(conv) {
  if (conv.type === "direct") return "people";
  return conv.kind || "other";
}

export function titleOf(conv) {
  return conv.type === "direct" ? conv.displayTitle || conv.name || "Direct message" : conv.name || "Untitled";
}

store.conversations = [];
store.unreadTotal = 0;
store.requests = []; // waiting-room requests for rooms I host
store.myRequests = []; // rooms I asked to join

const META_FIELDS = "id, conversation_id, user_id, username, content, iv, file_url, created_at";
let openConversationId = null;
let channel = null;
let pollTimer = null;
const messageListeners = new Set();

export function setOpenConversation(id) {
  openConversationId = id;
}
export function onLiveMessage(fn) {
  messageListeners.add(fn);
  return () => messageListeners.delete(fn);
}

function recount() {
  store.unreadTotal = store.conversations.reduce((n, c) => n + (c.unread || 0), 0);
  emit("unread");
}

async function preview(msg) {
  if (!msg) return "";
  const text = describeKeyRequest(await messagePlaintext(msg));
  if (text) return text;
  return msg.file_url ? "📎 Attachment" : "";
}

export async function refreshConversations() {
  const me = state.currentUser.id;
  const { data: rows, error } = await supabaseClient.from("conversation_participants").select("conversation_id, conversations(*)").eq("user_id", me);
  if (error) {
    console.error(error);
    return { error };
  }
  const convs = (rows || []).map((r) => r.conversations).filter(Boolean);
  const ids = convs.map((c) => c.id);

  const [parts, meta] = await Promise.all([
    ids.length
      ? supabaseClient.from("conversation_participants").select("conversation_id, user_id, role, profiles(username)").in("conversation_id", ids)
      : { data: [] },
    ids.length ? supabaseClient.from("messages").select(META_FIELDS).order("created_at", { ascending: false }).limit(500) : { data: [] },
  ]);

  const members = new Map();
  for (const p of parts.data || []) {
    if (!members.has(p.conversation_id)) members.set(p.conversation_id, []);
    members.get(p.conversation_id).push({ id: p.user_id, role: p.role || "member", username: p.profiles?.username || "someone" });
  }
  const byConv = new Map();
  for (const m of meta.data || []) {
    if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
    byConv.get(m.conversation_id).push(m);
  }
  const gaps = convs.filter((c) => !byConv.has(c.id));
  if (gaps.length) {
    const filled = await mapLimited(gaps, 6, async (c) => {
      const { data } = await supabaseClient.from("messages").select(META_FIELDS).eq("conversation_id", c.id).order("created_at", { ascending: false }).limit(60);
      return [c.id, data || []];
    });
    filled.forEach(([id, list]) => byConv.set(id, list));
  }

  mergeServerMarkers(await loadMyReadMarkers());
  await prefetchConversationKeys(ids);

  for (const c of convs) {
    const mem = members.get(c.id) || [];
    c.members = mem;
    c.myRole = mem.find((m) => m.id === me)?.role || "member";
    c.isHost = c.type === "group" && ["owner", "admin"].includes(c.myRole);
    if (c.type === "direct") {
      const other = mem.find((m) => m.id !== me);
      c.displayTitle = other?.username || c.name;
      c.otherUserId = other?.id || null;
    }
    const msgs = byConv.get(c.id) || [];
    c.lastMessage = msgs[0] || null;
    c.lastAt = msgs[0]?.created_at || c.created_at;
    c.unread = c.id === openConversationId ? 0 : countUnread(c.id, msgs);
  }
  await Promise.all(convs.map(async (c) => (c.preview = await preview(c.lastMessage))));
  convs.sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
  store.conversations = convs;
  recount();
  emit("signals");
  refreshRequests();
  return {};
}

export async function refreshRequests() {
  const { data, error } = await supabaseClient.from("room_requests").select("*").order("created_at");
  if (error) return; // phase 16 not applied: no rooms, nothing to show
  const me = state.currentUser.id;
  store.requests = (data || []).filter((r) => r.user_id !== me);
  store.myRequests = (data || []).filter((r) => r.user_id === me);
  emit("requests");
}

export async function startInbox() {
  if (channel) return;
  await refreshConversations();
  const me = state.currentUser.id;
  channel = supabaseClient
    .channel("students-inbox")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async (payload) => {
      const msg = payload.new;
      const conv = store.conversations.find((c) => c.id === msg.conversation_id);
      if (!conv) return refreshConversations();
      conv.lastMessage = msg;
      conv.lastAt = msg.created_at;
      conv.preview = await preview(msg);
      const viewing = msg.conversation_id === openConversationId && !document.hidden;
      if (msg.user_id !== me && !viewing) conv.unread = (conv.unread || 0) + 1;
      if (viewing) markOpenRead();
      store.conversations.sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
      recount();
      emit("signals");
      messageListeners.forEach((fn) => fn(msg));
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, (payload) => {
      messageListeners.forEach((fn) => fn(null, payload.old?.id));
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "conversation_participants", filter: `user_id=eq.${me}` }, () => {
      refreshConversations();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "room_requests" }, () => refreshRequests())
    .subscribe();

  // Realtime is best effort; a slow poll and a refresh on return cover gaps.
  pollTimer = setInterval(() => !document.hidden && refreshConversations(), 90000);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onVisible);
}

function onVisible() {
  if (!document.hidden) refreshConversations();
}

export function stopInbox() {
  if (channel) supabaseClient.removeChannel(channel);
  channel = null;
  clearInterval(pollTimer);
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener("online", onVisible);
}

export function markOpenRead() {
  if (!openConversationId) return;
  markRead(openConversationId);
  markConversationRead(openConversationId).catch(() => {});
  const conv = store.conversations.find((c) => c.id === openConversationId);
  if (conv && conv.unread) {
    conv.unread = 0;
    recount();
    emit("signals");
  }
}

// ---- messages -----------------------------------------------------------------

export async function fetchMessages(convId, before = null) {
  let q = supabaseClient.from("messages").select("*").eq("conversation_id", convId).order("created_at", { ascending: false }).limit(MESSAGES_PAGE_SIZE);
  if (before) q = q.lt("created_at", before);
  const { data, error } = await q;
  if (error) return { error };
  return { messages: (data || []).slice().reverse(), more: (data || []).length === MESSAGES_PAGE_SIZE };
}

// Encrypt and send, following src/sendpolicy.js exactly: never plaintext
// into a chat that is (or may be) encrypted.
export async function sendMessage(conv, { text = "", file = null, clientId }) {
  const memberIds = (conv.members || []).map((m) => m.id);
  const plan = await keyForSending(conv.id, memberIds.length ? memberIds : undefined);
  if (plan.mode === SEND.REFUSE) {
    return { error: { message: plan.locked ? "Not sent: unlock your messages first." : "Not sent: this device doesn't have this conversation's key." } };
  }
  let fileUrl = null;
  if (file) {
    if (file.size > MAX_FILE_BYTES) return { error: { message: "That file is over 50 MB." } };
    const toUpload = file.type.startsWith("image/") ? await compressImage(file) : file;
    if (plan.key) {
      try {
        fileUrl = await uploadEncrypted(toUpload, plan.key);
        primeAttachmentCache(fileUrl, toUpload);
      } catch {
        return { error: { message: "The upload failed." } };
      }
    } else {
      // A conversation with no key at all is plaintext for everyone in it;
      // encrypting only the file would be theatre (see src/attachments.js).
      const safeName = (file.name || "file").replace(/[^\w.\- ]+/g, "_").slice(-80);
      const path = `files/${Date.now()}_${crypto.randomUUID()}_s${file.size}__${safeName}`;
      const { error } = await supabaseClient.storage.from("chat-files").upload(path, toUpload, { contentType: toUpload.type || undefined });
      if (error) return { error: { message: "The upload failed." } };
      fileUrl = supabaseClient.storage.from("chat-files").getPublicUrl(path).data.publicUrl;
    }
  }
  let content = text || null;
  let iv = null;
  if (text && plan.key) {
    const enc = await window.PanaloCrypto.encryptMessage(text, plan.key);
    content = enc.ciphertext;
    iv = enc.iv;
  }
  const row = { conversation_id: conv.id, user_id: state.currentUser.id, username: state.currentUsername, content, iv, file_url: fileUrl, client_id: clientId };
  let { data, error } = await supabaseClient.from("messages").insert([row]).select().single();
  if (error && /duplicate|unique/i.test(error.message)) {
    // An earlier attempt went through and we never saw the answer.
    ({ data, error } = await supabaseClient.from("messages").select("*").eq("client_id", clientId).maybeSingle());
  }
  if (error || !data) {
    const rls = /row-level security/i.test(error?.message || "");
    return { error: { message: rls ? (conv.posting === "hosts" ? "Only hosts can post in this room." : "This conversation isn't accepting messages.") : "Message failed to send." } };
  }
  api.noteSent(data);
  return { message: data };
}

export async function deleteMessage(id) {
  return supabaseClient.from("messages").delete().eq("id", id);
}

// ---- starting things ---------------------------------------------------------------

function friendly(error, fallback) {
  const m = error?.message || "";
  if (/can't be added/i.test(m)) return { error: { message: "That person can't be added." } };
  if (error?.code === "54000" || /too many/i.test(m)) return { error: { message: m } };
  return { error: { message: fallback } };
}

async function findExistingDirect(otherId) {
  return store.conversations.find((c) => c.type === "direct" && c.otherUserId === otherId) || null;
}

export async function startDirect(username) {
  const name = String(username || "").trim().replace(/^@/, "");
  if (!name) return { error: { message: "Enter a username." } };
  if (name.toLowerCase() === state.currentUsername.toLowerCase()) return { error: { message: "That's you." } };
  let target;
  try {
    target = await findProfileByUsername(name);
  } catch {
    return { error: { message: "Couldn't look that up. Try again." } };
  }
  if (!target) return { error: { message: `Nobody is called @${name}. Usernames have to match exactly.` } };
  const existing = await findExistingDirect(target.id);
  if (existing) return { conversation: existing };
  const { data: conv, error } = await supabaseClient.from("conversations").insert([{ type: "direct", name: target.username }]).select().single();
  if (error) return friendly(error, "Couldn't start the conversation.");
  const { error: pe } = await supabaseClient.from("conversation_participants").insert([
    { conversation_id: conv.id, user_id: state.currentUser.id },
    { conversation_id: conv.id, user_id: target.id },
  ]);
  if (pe) {
    await supabaseClient.from("conversation_participants").delete().eq("conversation_id", conv.id).eq("user_id", state.currentUser.id);
    return friendly(pe, "Couldn't add them to the conversation.");
  }
  await provisionConversationKey(conv.id, [state.currentUser.id, target.id]);
  await refreshConversations();
  return { conversation: store.conversations.find((c) => c.id === conv.id) };
}

// Resolve usernames one exact name at a time -- bulk lookup is precisely
// what would make the user list enumerable (see src/client.js).
export async function resolveUsernames(list) {
  const names = [...new Set(String(list || "").split(/[\s,]+/).map((s) => s.trim().replace(/^@/, "")).filter(Boolean))];
  const found = [];
  const missing = [];
  for (const n of names) {
    if (n.toLowerCase() === state.currentUsername.toLowerCase()) continue;
    const p = await findProfileByUsername(n).catch(() => null);
    if (p) found.push(p);
    else missing.push(n);
  }
  return { found, missing };
}

export async function createCircle({ name, kind, members }) {
  if (!name.trim()) return { error: { message: "Give it a name." } };
  const { data: conv, error } = await supabaseClient.from("conversations").insert([{ type: "group", name: name.trim(), kind }]).select().single();
  if (error) return friendly(error, "Couldn't create it.");
  const rows = [{ conversation_id: conv.id, user_id: state.currentUser.id }, ...members.map((p) => ({ conversation_id: conv.id, user_id: p.id }))];
  // The creator first, alone: if one invitee refuses (blocked), the rest
  // still get in.
  const { error: e1 } = await supabaseClient.from("conversation_participants").insert([rows[0]]);
  if (e1) return friendly(e1, "Couldn't create it.");
  const added = [state.currentUser.id];
  const refused = [];
  for (const p of members) {
    const { error: e2 } = await supabaseClient.from("conversation_participants").insert([{ conversation_id: conv.id, user_id: p.id }]);
    if (e2) refused.push(p.username);
    else added.push(p.id);
  }
  await provisionConversationKey(conv.id, added);
  await refreshConversations();
  return { conversation: store.conversations.find((c) => c.id === conv.id), refused };
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function makeCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
export function prettyCode(code) {
  return code ? `${code.slice(0, 4)}-${code.slice(4)}` : "";
}
export function inviteLink(code) {
  return `${location.origin}${location.pathname}#join=${code}`;
}

export async function createRoom({ name, endsAt, posting }) {
  if (!name.trim()) return { error: { message: "Give the room a name." } };
  const { data: conv, error } = await supabaseClient
    .from("conversations")
    .insert([{ type: "group", name: name.trim(), kind: "event", ends_at: endsAt.toISOString(), posting }])
    .select()
    .single();
  if (error) return friendly(error, error.message || "Couldn't open the room.");
  const { error: pe } = await supabaseClient.from("conversation_participants").insert([{ conversation_id: conv.id, user_id: state.currentUser.id }]);
  if (pe) return friendly(pe, "Couldn't open the room.");
  await provisionConversationKey(conv.id, [state.currentUser.id]);
  const code = await newCode(conv.id);
  await refreshConversations();
  return { conversation: store.conversations.find((c) => c.id === conv.id), code };
}

export async function getCode(convId) {
  const { data } = await supabaseClient.from("room_codes").select("code").eq("conversation_id", convId).maybeSingle();
  return data?.code || null;
}

export async function newCode(convId) {
  await supabaseClient.from("room_codes").delete().eq("conversation_id", convId);
  for (let i = 0; i < 4; i++) {
    const code = makeCode();
    const { error } = await supabaseClient.from("room_codes").insert([{ conversation_id: convId, code }]);
    if (!error) return code;
    if (!/duplicate|unique/i.test(error.message)) return null;
  }
  return null;
}

export async function closeCode(convId) {
  return supabaseClient.from("room_codes").delete().eq("conversation_id", convId);
}

export async function requestToJoin(code) {
  const { data, error } = await supabaseClient.rpc("request_to_join", { code });
  if (error) return { error: { message: error.code === "54000" ? error.message : "Couldn't send your request. Try again." } };
  const row = (data || [])[0] || { status: "invalid" };
  refreshRequests();
  return row;
}

export async function cancelRequest(convId) {
  await supabaseClient.from("room_requests").delete().eq("conversation_id", convId).eq("user_id", state.currentUser.id);
  refreshRequests();
}

// Letting someone in is what shares the room's key with them -- a host's
// decision, made visibly, never automatic (the trust model of keyshare.js).
export async function admit(request) {
  const { error } = await supabaseClient.from("conversation_participants").insert([{ conversation_id: request.conversation_id, user_id: request.user_id }]);
  if (error && !/duplicate/i.test(error.message)) return friendly(error, "Couldn't let them in.");
  let keyShared = true;
  try {
    const key = await getConversationKey(request.conversation_id);
    if (key) {
      const { data: prof } = await supabaseClient.from("profiles").select("public_key").eq("id", request.user_id).maybeSingle();
      if (prof?.public_key) {
        const pub = await window.PanaloCrypto.importPublicKey(prof.public_key);
        const wrapped = await window.PanaloCrypto.wrapConversationKey(key, pub);
        const { error: ke } = await supabaseClient.from("conversation_keys").insert([{ conversation_id: request.conversation_id, user_id: request.user_id, wrapped_key: wrapped }]);
        if (ke && !/duplicate/i.test(ke.message)) keyShared = false;
      } else keyShared = false;
    }
  } catch (e) {
    console.error(e);
    keyShared = false;
  }
  await supabaseClient.from("room_requests").delete().eq("conversation_id", request.conversation_id).eq("user_id", request.user_id);
  await refreshConversations();
  return { keyShared };
}

export async function decline(request) {
  await supabaseClient.from("room_requests").delete().eq("conversation_id", request.conversation_id).eq("user_id", request.user_id);
  refreshRequests();
}

export async function setPosting(conv, posting) {
  const { error } = await supabaseClient.from("conversations").update({ posting }).eq("id", conv.id);
  if (!error) conv.posting = posting;
  return { error };
}

export async function setKind(conv, kind) {
  const { error } = await supabaseClient.from("conversations").update({ kind }).eq("id", conv.id);
  if (!error) {
    conv.kind = kind;
    emit("signals");
  }
  return { error };
}

export async function endRoomSoon(conv) {
  const at = new Date(Date.now() + 60_000).toISOString();
  const { error } = await supabaseClient.from("conversations").update({ ends_at: at }).eq("id", conv.id);
  if (!error) conv.ends_at = at;
  return { error };
}

export async function leave(conv) {
  const { error } = await supabaseClient.from("conversation_participants").delete().eq("conversation_id", conv.id).eq("user_id", state.currentUser.id);
  if (error) return { error };
  await supabaseClient.from("conversation_keys").delete().eq("conversation_id", conv.id).eq("user_id", state.currentUser.id);
  await refreshConversations();
  return {};
}

// ---- safety -------------------------------------------------------------------------

export async function block(userId) {
  const { error } = await supabaseClient.from("blocks").insert([{ blocked_id: userId }]);
  if (error && !/duplicate/i.test(error.message)) return { error };
  await refreshConversations();
  return {};
}

export async function unblock(userId) {
  return supabaseClient.from("blocks").delete().eq("blocked_id", userId).eq("blocker_id", state.currentUser.id);
}

export async function report({ reason, details, evidence, reportedUserId, conversationId, messageId }) {
  const { error } = await supabaseClient.from("reports").insert([
    {
      reason,
      details: details || null,
      evidence: evidence || null,
      reported_user_id: reportedUserId || null,
      conversation_id: conversationId || null,
      message_id: messageId || null,
    },
  ]);
  return { error };
}
