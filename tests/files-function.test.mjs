// The R2 file Function (functions/api/files/[[path]].js), run in Node against
// an in-memory bucket and a stand-in for Supabase's auth and REST answers.
import test from "node:test";
import assert from "node:assert/strict";
import { onRequest, parseKey, servedType } from "../functions/api/files/[[path]].js";

const A = "11111111-1111-4111-8111-111111111111"; // alex
const M = "22222222-2222-4222-8222-222222222222"; // maya
const S = "33333333-3333-4333-8333-333333333333"; // sam, outside the circle
const CIRCLE = "44444444-4444-4444-8444-444444444444";
const id = () => crypto.randomUUID();

function bucket() {
  const store = new Map();
  return {
    store,
    async head(key) {
      const o = store.get(key);
      return o ? { key, size: o.bytes.length, customMetadata: o.meta, httpEtag: '"e"' } : null;
    },
    async get(key) {
      const o = store.get(key);
      return o ? { key, size: o.bytes.length, customMetadata: o.meta, httpEtag: '"e"', body: o.bytes } : null;
    },
    async put(key, body, opts) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      store.set(key, { bytes, meta: opts.customMetadata });
    },
    async delete(keys) {
      for (const k of [].concat(keys)) store.delete(k);
    },
    async list({ prefix }) {
      return { objects: [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })), truncated: false };
    },
  };
}

// Supabase, as each person's token sees it.
const members = { [CIRCLE]: { [A]: "owner", [M]: "member" } };
const listedKeys = new Set();
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const token = (init.headers?.authorization || "").replace("Bearer ", "");
  const user = { "tok-a": A, "tok-m": M, "tok-s": S }[token];
  if (u.pathname === "/auth/v1/user") return user ? Response.json({ id: user }) : new Response("no", { status: 401 });
  if (u.pathname === "/rest/v1/conversation_participants") {
    const conv = u.searchParams.get("conversation_id").slice(3);
    const who = u.searchParams.get("user_id").slice(3);
    const role = who === user ? members[conv]?.[who] : null;
    return Response.json(role ? [{ role }] : []);
  }
  if (u.pathname === "/rest/v1/resources") {
    const key = u.searchParams.get("object_path").slice(3);
    // Row-level security: only the circle's members see its listing.
    const conv = parseKey(key)?.conversation;
    return Response.json(listedKeys.has(key) && members[conv]?.[user] ? [{ id: 1 }] : []);
  }
  throw new Error(`unexpected fetch ${url}`);
};

const env = { FILES: bucket(), FILES_SIGNING_SECRET: "test-secret", USER_QUOTA_MB: "1" };
async function call(method, path, { token, body, headers = {}, search = "" } = {}) {
  const h = new Headers(headers);
  if (token) h.set("authorization", `Bearer ${token}`);
  if (body !== undefined && typeof body !== "string" && !(body instanceof Uint8Array)) {
    body = JSON.stringify(body);
    h.set("content-type", "application/json");
  }
  if (body instanceof Uint8Array) h.set("content-length", String(body.length));
  const request = new Request(`https://panalo.test/api/files/${path}${search}`, { method, headers: h, body });
  return onRequest({ request, env, params: { path: path.split("/") } });
}
const put = (key, token, bytes = new Uint8Array([1, 2, 3]), type = "application/pdf", name = "notes.pdf") =>
  call("PUT", key, { token, body: bytes, headers: { "content-type": type, "x-file-name": encodeURIComponent(name) } });

test("keys must name their owner and a known shape", () => {
  assert.equal(parseKey(`o/${A}/u/${id()}`).kind, "u");
  assert.equal(parseKey(`o/${A}/c/${CIRCLE}/${id()}`).conversation, CIRCLE);
  assert.equal(parseKey(`o/${A}/a/${id()}`).kind, "a");
  for (const bad of ["", `u/${A}/x`, `o/${A}/u/../../x`, `o/${A}/u/${id()}/extra`, `o/not-a-uuid/u/${id()}`]) assert.equal(parseKey(bad), null, bad);
});

test("health says whether R2 is bound; without it everything else is 501", async () => {
  assert.deepEqual(await (await call("GET", "health")).json(), { r2: true, signing: true });
  const res = await onRequest({ request: new Request("https://panalo.test/api/files/health"), env: {}, params: { path: ["health"] } });
  assert.deepEqual(await res.json(), { r2: false, signing: false });
  const off = await onRequest({ request: new Request(`https://panalo.test/api/files/o/${A}/u/${id()}`), env: {}, params: { path: ["o", A, "u", id()] } });
  assert.equal(off.status, 501);
});

test("you upload only under your own name, and need to be signed in", async () => {
  assert.equal((await put(`o/${A}/u/${id()}`, "tok-a")).status, 201);
  assert.equal((await put(`o/${M}/u/${id()}`, "tok-a")).status, 403);
  assert.equal((await put(`o/${A}/u/${id()}`, null)).status, 401);
  const k = `o/${A}/u/${id()}`;
  await put(k, "tok-a");
  assert.equal((await put(k, "tok-a")).status, 409, "no overwriting");
});

test("sharing into a circle needs membership; reading needs membership and a listing", async () => {
  const k = `o/${A}/c/${CIRCLE}/${id()}`;
  assert.equal((await put(`o/${S}/c/${CIRCLE}/${id()}`, "tok-s")).status, 403, "outsiders can't share in");
  assert.equal((await put(k, "tok-a")).status, 201);
  assert.equal((await call("GET", k, { token: "tok-m" })).status, 403, "not listed yet");
  listedKeys.add(k);
  assert.equal((await call("GET", k, { token: "tok-m" })).status, 200, "member, listed");
  assert.equal((await call("GET", k, { token: "tok-s" })).status, 403, "outsider");
  assert.equal((await call("GET", k)).status, 401);
});

test("private files are the owner's alone; chat attachments are readable when signed in", async () => {
  const k = `o/${A}/u/${id()}`;
  await put(k, "tok-a");
  assert.equal((await call("GET", k, { token: "tok-a" })).status, 200);
  assert.equal((await call("GET", k, { token: "tok-m" })).status, 403);
  const a = `o/${A}/a/${id()}`;
  await put(a, "tok-a", new Uint8Array([9]), "application/octet-stream");
  assert.equal((await call("GET", a, { token: "tok-s" })).status, 200);
  assert.equal((await call("GET", a)).status, 401);
});

test("what an uploader calls a file can't make it run here", async () => {
  assert.equal(servedType("text/html", "u"), "text/plain; charset=utf-8");
  assert.equal(servedType("image/svg+xml", "u"), "application/octet-stream");
  assert.equal(servedType("application/pdf", "a"), "application/octet-stream");
  assert.equal(servedType("image/png", "u"), "image/png");
  const k = `o/${A}/u/${id()}`;
  await put(k, "tok-a", new TextEncoder().encode("<script>alert(1)</script>"), "text/html", "x.html");
  const res = await call("GET", k, { token: "tok-a" });
  assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("content-security-policy"), /sandbox/);
});

test("signed links work without a token, and only for their key, until they expire", async () => {
  const k = `o/${A}/u/${id()}`;
  await put(k, "tok-a");
  assert.equal((await call("POST", "sign", { token: "tok-m", body: { key: k } })).status, 403, "can't sign what you can't read");
  const { url } = await (await call("POST", "sign", { token: "tok-a", body: { key: k } })).json();
  const q = url.slice(url.indexOf("?"));
  assert.equal((await call("GET", k, { search: q })).status, 200);
  assert.equal((await call("HEAD", k, { search: q })).headers.get("content-type"), "application/pdf");
  const other = `o/${A}/u/${id()}`;
  await put(other, "tok-a");
  assert.equal((await call("GET", other, { search: q })).status, 401, "a link is for one file");
  assert.equal((await call("GET", k, { search: q.replace(/exp=\d+/, "exp=1") })).status, 401, "expired or tampered");
});

test("deleting: yours always; a circle's file also by its host; nobody else's", async () => {
  const mayaFile = `o/${M}/c/${CIRCLE}/${id()}`;
  await put(mayaFile, "tok-m");
  assert.equal((await call("DELETE", mayaFile, { token: "tok-s" })).status, 403);
  assert.equal((await call("DELETE", mayaFile, { token: "tok-a" })).status, 200, "alex hosts the circle");
  assert.equal(await env.FILES.head(mayaFile), null);
  const mine = `o/${M}/u/${id()}`;
  await put(mine, "tok-m");
  assert.equal((await call("DELETE", mine, { token: "tok-a" })).status, 403, "hosts can't touch private files");
});

test("the quota counts what's really in the bucket", async () => {
  const big = new Uint8Array(700 * 1024);
  assert.equal((await put(`o/${S}/u/${id()}`, "tok-s", big)).status, 201);
  assert.equal((await put(`o/${S}/u/${id()}`, "tok-s", big)).status, 507, "1 MB quota in this test");
});

test("deleting an account wipes every file under its name and nobody else's", async () => {
  await put(`o/${M}/u/${id()}`, "tok-m");
  const before = [...env.FILES.store.keys()].filter((k) => k.startsWith(`o/${A}/`)).length;
  assert.ok(before > 0);
  const res = await call("DELETE", "mine", { token: "tok-m" });
  assert.equal(res.status, 200);
  assert.equal([...env.FILES.store.keys()].filter((k) => k.startsWith(`o/${M}/`)).length, 0);
  assert.equal([...env.FILES.store.keys()].filter((k) => k.startsWith(`o/${A}/`)).length, before);
});
