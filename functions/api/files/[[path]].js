// /api/files/* — file storage on Cloudflare R2 (10 GB free).
//
// A Cloudflare Pages Function. It is used only when an R2 bucket is bound
// to the Pages project as FILES; until then /api/files/health says so and
// both apps keep using Supabase Storage exactly as before. Setup: R2.md.
//
// Keys always begin with the uploader, so "is this mine" and "delete
// everything of mine" are prefix questions:
//
//   o/<owner>/u/<uuid>                  a private archive file
//   o/<owner>/c/<conversation>/<uuid>   an archive file shared into a circle
//   o/<owner>/a/<uuid>                  a chat attachment (always ciphertext)
//
// Who may do what -- the same rules the Supabase policies enforce for the
// files that live there (phases 16-18), checked against Supabase with the
// caller's own token, so row-level security answers every question:
//
//   upload  your own prefix only; into c/<conv> only if you're a member;
//           50 MB a file, USER_QUOTA_MB (300) and 2,000 files a person
//   read    your own files; c/ files while you're a member AND the file is
//           still listed in the archive; a/ files by anyone signed in
//           (they're encrypted with the conversation's key)
//   delete  your own files; c/ files also by that circle's hosts
//
// Files are served from this origin, so what an uploader says a file is
// can never make it run here: types are mapped to a short list of inert
// ones, everything else is a download, and responses carry a sandboxing CSP.
//
// Routes
//   GET    /api/files/health          { r2, signing }
//   PUT    /api/files/<key>           upload (body = bytes; X-File-Name)
//   GET    /api/files/<key>           read (Bearer token, or a signed link)
//   HEAD   /api/files/<key>           the same, without the body
//   DELETE /api/files/<key>           delete
//   POST   /api/files/sign            { key, download? } -> { url } (10 min)
//   DELETE /api/files/mine            delete every file you uploaded
const DEFAULT_SUPABASE_URL = "https://zqtvqobonmpxffjxbjpt.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_TQ1NrHUU3HaIcFRkOWXHuQ_yC3REquy";
const MAX_FILE = 50 * 1024 * 1024;
const MAX_FILES = 2000;
const SIGNED_TTL = 600; // seconds

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY_RE = new RegExp(`^o/(${UUID})/(?:u/${UUID}|c/(${UUID})/${UUID}|a/${UUID})$`);

export function parseKey(key) {
  const m = KEY_RE.exec(String(key || ""));
  if (!m) return null;
  const kind = key.split("/")[2];
  return { key, owner: m[1], kind, conversation: m[2] || null };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// ---- who is asking -----------------------------------------------------------------

const tokens = new Map(); // token -> { id, until }
async function whoIs(request, env) {
  const auth = request.headers.get("authorization") || "";
  const m = /^Bearer (\S+)$/.exec(auth);
  if (!m) return null;
  const hit = tokens.get(m[1]);
  if (hit && hit.until > Date.now()) return { id: hit.id, token: m[1] };
  const res = await fetch(`${env.SUPABASE_URL || DEFAULT_SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY, authorization: auth },
  });
  if (!res.ok) return null;
  const user = await res.json();
  if (!user?.id) return null;
  if (tokens.size > 500) tokens.clear();
  tokens.set(m[1], { id: user.id, until: Date.now() + 60000 });
  return { id: user.id, token: m[1] };
}

// Ask Supabase's REST API as the caller: row-level security decides.
async function rows(env, token, path) {
  const res = await fetch(`${env.SUPABASE_URL || DEFAULT_SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY, authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!res.ok) return [];
  const body = await res.json().catch(() => []);
  return Array.isArray(body) ? body : [];
}
const enc = encodeURIComponent;
const memberRole = async (env, who, conv) =>
  (await rows(env, who.token, `conversation_participants?select=role&conversation_id=eq.${enc(conv)}&user_id=eq.${enc(who.id)}`))[0]?.role || null;
const listed = async (env, who, key) => (await rows(env, who.token, `resources?select=id&object_path=eq.${enc(key)}`)).length > 0;

// ---- what a file may be served as ----------------------------------------------------

const INLINE = /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/(mp4|webm|ogg|quicktime)|audio\/(mpeg|mp4|ogg|wav|x-wav|webm|aac|flac)|application\/pdf)$/;
export function servedType(claimed, kind) {
  if (kind === "a") return "application/octet-stream"; // ciphertext
  const t = String(claimed || "").toLowerCase().split(";")[0].trim();
  if (INLINE.test(t)) return t;
  if (t.startsWith("text/") || t === "application/json") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function fileHeaders(obj, info, { download }) {
  const type = servedType(obj.customMetadata?.type, info.kind);
  const name = obj.customMetadata?.name || "file";
  const h = new Headers();
  h.set("content-type", type);
  h.set("x-content-type-options", "nosniff");
  h.set("cache-control", "private, max-age=300");
  h.set("cross-origin-resource-policy", "same-origin");
  h.set("accept-ranges", "bytes");
  const inline = !download && type !== "application/octet-stream";
  h.set("content-disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${enc(name)}`);
  // Nothing served from here may script this origin. PDFs are the one
  // exception to the sandbox, because browsers' PDF viewers refuse to run
  // inside one; a PDF is still only ever shown by the viewer (nosniff).
  if (type !== "application/pdf") h.set("content-security-policy", "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'");
  if (obj.httpEtag) h.set("etag", obj.httpEtag);
  return h;
}

// ---- signed links (for a new tab, which can't send a token) --------------------------

async function hmac(secret, text) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function signedOk(env, key, url) {
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") || "";
  const dl = url.searchParams.get("dl") === "1" ? "1" : "0";
  if (!env.FILES_SIGNING_SECRET || !exp || exp < Date.now() / 1000) return false;
  const want = await hmac(env.FILES_SIGNING_SECRET, `${key}\n${exp}\n${dl}`);
  if (want.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// ---- quota ---------------------------------------------------------------------------

async function usage(bucket, owner) {
  let bytes = 0, count = 0, cursor;
  do {
    const page = await bucket.list({ prefix: `o/${owner}/`, cursor, limit: 1000 });
    for (const o of page.objects) {
      bytes += o.size;
      count++;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { bytes, count };
}

// ---- the handlers ----------------------------------------------------------------------

async function mayRead(env, who, info) {
  if (!who) return false;
  if (info.owner === who.id) return true;
  if (info.kind === "a") return true;
  if (info.kind === "c") return Boolean(await memberRole(env, who, info.conversation)) && (await listed(env, who, info.key));
  return false;
}

async function upload(request, env, who, info) {
  if (info.owner !== who.id) return json({ error: "not-yours" }, 403);
  if (info.kind === "c" && !(await memberRole(env, who, info.conversation))) return json({ error: "not-a-member" }, 403);
  const length = Number(request.headers.get("content-length"));
  if (!length) return json({ error: "length-required" }, 411);
  if (length > MAX_FILE) return json({ error: "too-large", max: MAX_FILE }, 413);
  if (await env.FILES.head(info.key)) return json({ error: "exists" }, 409);
  const quota = Math.max(1, Number(env.USER_QUOTA_MB) || 300) * 1024 * 1024;
  const used = await usage(env.FILES, who.id);
  if (used.count >= MAX_FILES || used.bytes + length > quota) return json({ error: "quota", used: used.bytes, quota }, 507);
  let name = "file";
  try {
    name = decodeURIComponent(request.headers.get("x-file-name") || "file").slice(0, 200) || "file";
  } catch {}
  const claimed = (request.headers.get("content-type") || "").slice(0, 120);
  await env.FILES.put(info.key, request.body, {
    httpMetadata: { contentType: servedType(claimed, info.kind) },
    customMetadata: { owner: who.id, name, type: claimed },
  });
  return json({ key: info.key, size: length }, 201);
}

async function read(request, env, info, url, { head }) {
  const download = url.searchParams.get("dl") === "1";
  const obj = head ? await env.FILES.head(info.key) : await env.FILES.get(info.key, { range: request.headers });
  if (!obj) return json({ error: "not-found" }, 404);
  const h = fileHeaders(obj, info, { download });
  if (head) {
    h.set("content-length", String(obj.size));
    return new Response(null, { status: 200, headers: h });
  }
  let status = 200;
  if (obj.range && request.headers.get("range")) {
    const off = obj.range.offset ?? 0;
    const len = obj.range.length ?? obj.size - off;
    h.set("content-range", `bytes ${off}-${off + len - 1}/${obj.size}`);
    h.set("content-length", String(len));
    status = 206;
  } else {
    h.set("content-length", String(obj.size));
  }
  return new Response(obj.body, { status, headers: h });
}

async function remove(env, who, info) {
  let ok = info.owner === who.id;
  if (!ok && info.kind === "c") ok = ["owner", "admin"].includes(await memberRole(env, who, info.conversation));
  if (!ok) return json({ error: "forbidden" }, 403);
  await env.FILES.delete(info.key);
  return json({ deleted: info.key });
}

async function removeMine(env, who) {
  let n = 0, cursor;
  do {
    const page = await env.FILES.list({ prefix: `o/${who.id}/`, cursor, limit: 1000 });
    const keys = page.objects.map((o) => o.key);
    if (keys.length) await env.FILES.delete(keys);
    n += keys.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return json({ deleted: n });
}

export async function onRequest({ request, env, params }) {
  const url = new URL(request.url);
  const path = [].concat(params?.path || []).join("/");
  const method = request.method.toUpperCase();

  if (path === "health" && method === "GET") return json({ r2: Boolean(env.FILES), signing: Boolean(env.FILES_SIGNING_SECRET) });
  if (!env.FILES) return json({ error: "r2-not-configured" }, 501);

  if (path === "sign" && method === "POST") {
    if (!env.FILES_SIGNING_SECRET) return json({ error: "signing-not-configured" }, 501);
    const who = await whoIs(request, env);
    if (!who) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const info = parseKey(body.key);
    if (!info) return json({ error: "bad-key" }, 400);
    if (!(await mayRead(env, who, info))) return json({ error: "forbidden" }, 403);
    const exp = Math.floor(Date.now() / 1000) + SIGNED_TTL;
    const dl = body.download ? "1" : "0";
    const sig = await hmac(env.FILES_SIGNING_SECRET, `${info.key}\n${exp}\n${dl}`);
    return json({ url: `/api/files/${info.key}?exp=${exp}&dl=${dl}&sig=${sig}` });
  }

  if (path === "mine" && method === "DELETE") {
    const who = await whoIs(request, env);
    if (!who) return json({ error: "unauthorized" }, 401);
    return removeMine(env, who);
  }

  const info = parseKey(path);
  if (!info) return json({ error: "bad-key" }, 400);

  if (method === "GET" || method === "HEAD") {
    if (!(await signedOk(env, info.key, url))) {
      const who = await whoIs(request, env);
      if (!(await mayRead(env, who, info))) return json({ error: who ? "forbidden" : "unauthorized" }, who ? 403 : 401);
    }
    return read(request, env, info, url, { head: method === "HEAD" });
  }

  const who = await whoIs(request, env);
  if (!who) return json({ error: "unauthorized" }, 401);
  if (method === "PUT") return upload(request, env, who, info);
  if (method === "DELETE") return remove(env, who, info);
  return json({ error: "method-not-allowed" }, 405);
}
