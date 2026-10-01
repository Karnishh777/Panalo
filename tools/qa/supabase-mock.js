// QA-ONLY in-memory stand-in for @supabase/supabase-js.
//
// NEVER referenced by index.html. The only way this file runs is when
// tools/qa/run.mjs (Playwright) intercepts the supabase-js CDN request and
// answers it with this file instead. It refuses to do anything unless the
// page is served from localhost AND the QA runner set window.__PANALO_QA__,
// so even someone loading it by hand on the deployed site gets nothing.
//
// What it is for: driving the real UI -- real crypto.js, real encryption.js,
// real rendering -- against a believable backend without creating accounts
// in the production project. It mirrors the server behaviour the client
// depends on (RLS scoping to your own chats, unique constraints the client
// relies on to detect races, the signup trigger, message expiry stamping,
// realtime fan-out). It is not a Postgres emulator; anything it doesn't
// implement throws loudly rather than returning something plausible.
(function () {
  "use strict";

  const QA = window.__PANALO_QA__;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (!QA || !local) {
    console.error("supabase-mock.js: refusing to run outside the QA harness.");
    return;
  }

  const SUPA = "https://zqtvqobonmpxffjxbjpt.supabase.co";
  const STORAGE_PUBLIC = `${SUPA}/storage/v1/object/public/`;
  const uuid = () => crypto.randomUUID();
  const nowIso = () => new Date().toISOString();
  const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------- tables
  const db = {
    profiles: [],
    user_keys: [],
    conversations: [],
    conversation_participants: [],
    conversation_keys: [],
    conversation_reads: [],
    messages: [],
    message_reactions: [],
    call_invites: [],
    // Panalo Students (phase 16)
    student_profiles: [],
    student_tasks: [],
    focus_sessions: [],
    student_events: [],
    activity_log: [],
    student_goals: [],
    resources: [],
    blocks: [],
    reports: [],
    room_codes: [],
    room_requests: [],
  };
  const OWNED_BY_USER = ["student_profiles", "student_tasks", "focus_sessions", "student_events", "activity_log", "student_goals"];
  const NO_ID = ["user_keys", "conversation_keys", "conversation_reads", "conversation_participants", "student_profiles", "blocks", "room_codes", "room_requests"];
  const authUsers = []; // { id, email, password, user_metadata }
  const storage = new Map(); // "bucket/path" -> Blob
  const privateKeys = new Map(); // seeded users' private keys, for __qa.receive
  const convKeys = new Map(); // convId -> AES key (seeded chats)

  // Unique constraints the client depends on to detect lost races/duplicates.
  const UNIQUE = {
    profiles: [["id"], ["username_lc"]],
    user_keys: [["user_id"]],
    conversation_participants: [["conversation_id", "user_id"]],
    conversation_keys: [["conversation_id", "user_id"]],
    conversation_reads: [["conversation_id", "user_id"]],
    message_reactions: [["message_id", "user_id", "emoji"]],
    messages: [["id"], ["client_id"]],
    student_profiles: [["user_id"]],
    blocks: [["blocker_id", "blocked_id"]],
    room_codes: [["conversation_id"], ["code"]],
    room_requests: [["conversation_id", "user_id"]],
    resources: [["object_path"]],
  };
  const CONFLICT_KEY = {
    profiles: ["id"],
    user_keys: ["user_id"],
    conversation_reads: ["conversation_id", "user_id"],
    student_profiles: ["user_id"],
  };

  // ------------------------------------------------------------------ auth
  let session = null;
  const authListeners = new Set();
  const SESSION_KEY = "qa.mock.session";

  function makeSession(user) {
    return {
      access_token: "qa-token",
      token_type: "bearer",
      user: { id: user.id, email: user.email, user_metadata: clone(user.user_metadata) },
    };
  }
  function setSession(s, event) {
    session = s;
    try {
      // Mirror the real client's storage key so src/boot.js's "is someone
      // signed in?" check behaves as it does in production.
      if (s) {
        localStorage.setItem(SESSION_KEY, s.user.id);
        localStorage.setItem("sb-qa-auth-token", "1");
      } else {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem("sb-qa-auth-token");
      }
    } catch {}
    authListeners.forEach((cb) => setTimeout(() => cb(event, s), 0));
  }
  const me = () => session?.user?.id || null;

  // RLS, approximately: you see rows of conversations you belong to.
  function myConvIds() {
    const uid = me();
    return new Set(db.conversation_participants.filter((p) => p.user_id === uid).map((p) => p.conversation_id));
  }
  function roleIn(convId, uid = me()) {
    return db.conversation_participants.find((p) => p.conversation_id === convId && p.user_id === uid)?.role || null;
  }
  const ended = (convId) => {
    const c = db.conversations.find((x) => x.id === convId);
    return !!(c && c.ends_at && Date.parse(c.ends_at) <= Date.now());
  };
  function visible(table, row) {
    const uid = me();
    if (!uid) return false;
    const mine = myConvIds();
    if (OWNED_BY_USER.includes(table)) return row.user_id === uid;
    switch (table) {
      case "messages":
        return mine.has(row.conversation_id) && (!row.expires_at || Date.parse(row.expires_at) > Date.now())
          && !ended(row.conversation_id)
          && !db.blocks.some((b) => b.blocker_id === uid && b.blocked_id === row.user_id);
      case "conversations":
        return mine.has(row.id) && !(row.ends_at && Date.parse(row.ends_at) <= Date.now());
      case "resources":
        return row.owner_id === uid || (row.conversation_id && mine.has(row.conversation_id));
      case "blocks":
        return row.blocker_id === uid;
      case "reports":
        return row.reporter_id === uid;
      case "room_codes":
        return ["owner", "admin"].includes(roleIn(row.conversation_id));
      case "room_requests":
        return row.user_id === uid || ["owner", "admin"].includes(roleIn(row.conversation_id));
      case "conversation_participants":
      case "conversation_reads":
        return mine.has(row.conversation_id);
      case "conversation_keys":
        return row.user_id === uid;
      case "user_keys":
        return row.user_id === uid;
      case "message_reactions": {
        const m = db.messages.find((x) => x.id === row.message_id);
        return !!m && mine.has(m.conversation_id);
      }
      case "call_invites":
        return row.caller_id === uid || row.callee_id === uid;
      default:
        return true;
    }
  }

  // ------------------------------------------------------------- realtime
  const channels = new Set();
  function emitChange(table, eventType, newRow, oldRow) {
    const row = newRow || oldRow;
    if (!row) return;
    // Realtime respects RLS too; DELETE payloads only carry the key.
    if (eventType !== "DELETE" && !visible(table, row)) return;
    for (const ch of channels) {
      if (!ch.subscribed) continue;
      for (const l of ch.listeners) {
        if (l.type !== "postgres_changes") continue;
        const f = l.filter || {};
        if (f.table && f.table !== table) continue;
        if (f.event && f.event !== "*" && f.event !== eventType) continue;
        if (f.filter) {
          const m = /^(\w+)=eq\.(.+)$/.exec(f.filter);
          if (m && String(row[m[1]]) !== m[2]) continue;
        }
        const payload = { eventType, new: eventType === "DELETE" ? {} : clone(newRow), old: eventType === "DELETE" ? { id: oldRow.id } : clone(oldRow || {}) };
        setTimeout(() => l.cb(payload), 10);
      }
    }
  }
  function broadcast(channelName, event, payload) {
    for (const ch of channels) {
      if (ch.name !== channelName || !ch.subscribed) continue;
      ch.listeners
        .filter((l) => l.type === "broadcast" && l.filter?.event === event)
        .forEach((l) => setTimeout(() => l.cb({ event, payload }), 0));
    }
  }

  function createChannel(name) {
    const ch = {
      name,
      topic: `realtime:${name}`,
      listeners: [],
      subscribed: false,
      on(type, filter, cb) {
        this.listeners.push({ type, filter, cb });
        return this;
      },
      subscribe(cb) {
        this.subscribed = true;
        setTimeout(() => {
          cb?.("SUBSCRIBED");
          if (name.startsWith("presence")) {
            this.listeners.filter((l) => l.type === "presence").forEach((l) => l.cb({}));
          }
        }, 20);
        return this;
      },
      presenceState() {
        const out = {};
        (QA.online || []).forEach((u) => {
          const p = db.profiles.find((x) => x.username === u);
          if (p) out[p.id] = [{ online_at: nowIso() }];
        });
        if (me()) out[me()] = [{ online_at: nowIso() }];
        return out;
      },
      async track() {
        return "ok";
      },
      async send() {
        return "ok";
      },
      async unsubscribe() {
        this.subscribed = false;
        channels.delete(this);
      },
    };
    channels.add(ch);
    return ch;
  }

  // ------------------------------------------------------------ query engine
  function parseSelect(str) {
    const cols = [];
    const embeds = [];
    let depth = 0;
    let cur = "";
    for (const ch of String(str || "*")) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        cols.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) cols.push(cur.trim());
    const plain = [];
    for (const c of cols) {
      const m = /^([a-z_]+)(!inner)?\((.*)\)$/s.exec(c);
      if (m) embeds.push({ table: m[1], inner: !!m[2], select: m[3] });
      else plain.push(c);
    }
    return { plain, embeds };
  }

  // The embed relationships this app actually uses.
  function embedFor(table, embedTable, row) {
    if (embedTable === "conversations") return db.conversations.find((c) => c.id === row.conversation_id) || null;
    if (embedTable === "profiles") return db.profiles.find((p) => p.id === (row.user_id ?? row.id)) || null;
    throw new Error(`supabase-mock: unsupported embed ${table} -> ${embedTable}`);
  }

  function project(table, row, selectStr) {
    const { plain, embeds } = parseSelect(selectStr);
    let out = {};
    if (plain.includes("*")) out = clone(row);
    for (const c of plain) if (c !== "*") out[c] = row[c] === undefined ? null : clone(row[c]);
    for (const e of embeds) {
      const target = embedFor(table, e.table, row);
      out[e.table] = target ? project(e.table, target, e.select) : null;
    }
    delete out.username_lc;
    return out;
  }

  function getPath(row, col, table) {
    if (col.includes(".")) {
      const [rel, field] = col.split(".");
      const target = embedFor(table, rel, row);
      return target ? target[field] : undefined;
    }
    return row[col];
  }

  const cmp = (a, b) => (a == null ? -1 : b == null ? 1 : a < b ? -1 : a > b ? 1 : 0);

  function testFilter(row, f, table) {
    const v = getPath(row, f.col, table);
    switch (f.op) {
      case "eq":
        return String(v) === String(f.val);
      case "neq":
        return String(v) !== String(f.val);
      case "in":
        return f.val.map(String).includes(String(v));
      case "lt":
        return Date.parse(v) ? Date.parse(v) < Date.parse(f.val) : v < f.val;
      case "gt":
        return Date.parse(v) ? Date.parse(v) > Date.parse(f.val) : v > f.val;
      case "gte":
        return Date.parse(v) ? Date.parse(v) >= Date.parse(f.val) : v >= f.val;
      case "lte":
        return Date.parse(v) ? Date.parse(v) <= Date.parse(f.val) : v <= f.val;
      case "is":
        return f.val === null ? v == null : v === f.val;
      case "not.is":
        return f.val === null ? v != null : v !== f.val;
      default:
        throw new Error(`supabase-mock: unsupported filter ${f.op}`);
    }
  }

  function uniqueViolation(table, row, staged = []) {
    for (const cols of UNIQUE[table] || []) {
      if (cols.some((c) => row[c] == null)) continue;
      const dup = [...db[table], ...staged].find((r) => cols.every((c) => String(r[c]) === String(row[c])));
      if (dup) {
        return { message: `duplicate key value violates unique constraint "${table}_${cols.join("_")}_key"`, code: "23505" };
      }
    }
    return null;
  }

  function applyDefaults(table, row) {
    if (table === "profiles") row.username_lc = String(row.username || "").toLowerCase();
    if (!("id" in row) && !NO_ID.includes(table)) row.id = uuid();
    if (OWNED_BY_USER.includes(table)) row.user_id = row.user_id || me();
    if ([...OWNED_BY_USER, "resources", "blocks", "reports", "room_codes", "room_requests"].includes(table) && !row.created_at) row.created_at = nowIso();
    if (table === "student_profiles") { row.born_at = row.born_at || nowIso(); row.interests = row.interests || []; }
    if (table === "student_tasks") { row.done_at = row.done_at ?? null; row.due_at = row.due_at ?? null; row.subject = row.subject ?? null; }
    if (table === "student_goals") { row.done_at = row.done_at ?? null; row.weekly_minutes = row.weekly_minutes ?? null; row.subject = row.subject ?? null; }
    if (table === "student_events") { row.repeat_weekly = !!row.repeat_weekly; row.ends_at = row.ends_at ?? null; row.location = row.location ?? null; }
    if (table === "activity_log") row.occurred_on = row.occurred_on || new Date().toISOString().slice(0, 10);
    if (table === "resources") row.owner_id = row.owner_id || me();
    if (table === "blocks") row.blocker_id = row.blocker_id || me();
    if (table === "reports") { row.reporter_id = row.reporter_id || me(); row.status = row.status || "open"; }
    if (table === "room_codes") row.created_by = row.created_by || me();
    if (["messages", "conversations", "call_invites", "message_reactions", "conversation_participants"].includes(table) && !row.created_at) row.created_at = nowIso();
    if (table === "conversations") {
      row.created_by = row.created_by || me();
      row.theme = row.theme ?? null;
      row.disappear_after = row.disappear_after ?? null;
      row.description = row.description ?? null;
      row.kind = row.kind ?? null;
      row.ends_at = row.ends_at ?? null;
      row.posting = row.posting || "everyone";
    }
    if (table === "conversation_participants") {
      const conv = db.conversations.find((c) => c.id === row.conversation_id);
      row.role = row.role || (conv && conv.type === "group" && conv.created_by === row.user_id ? "owner" : "member");
    }
    if (table === "messages") {
      const conv = db.conversations.find((c) => c.id === row.conversation_id);
      const days = conv?.disappear_after ? parseInt(conv.disappear_after, 10) : 0;
      row.expires_at = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
      row.edited_at = row.edited_at ?? null;
      row.reply_to = row.reply_to ?? null;
    }
  }

  // The phase 16 rules a client could actually trip over.
  function insertRule(t, row) {
    const uid = me();
    const deny = (message, code = "42501") => ({ message, code });
    if (OWNED_BY_USER.includes(t) && row.user_id !== uid) return deny("new row violates row-level security policy");
    if (t === "student_goals" && db.student_goals.filter((g) => g.user_id === uid).length >= 24) return deny("You have reached the limit of 24 here. Remove something old first.", "54000");
    if (t === "messages") {
      if (ended(row.conversation_id)) return deny("new row violates row-level security policy");
      const c = db.conversations.find((x) => x.id === row.conversation_id);
      const keyRequest = row.iv == null && row.content === "[[keyrequest]]";
      if (c && c.posting === "hosts" && !["owner", "admin"].includes(roleIn(c.id)) && !keyRequest) return deny("new row violates row-level security policy");
    }
    if (t === "conversation_participants" && row.user_id !== uid && db.blocks.some((b) => b.blocker_id === row.user_id && b.blocked_id === uid)) {
      return deny("This person can't be added.");
    }
    if (t === "conversations" && row.ends_at) {
      if (Date.parse(row.ends_at) <= Date.now()) return deny("A room has to end in the future.", "22023");
      if (Date.parse(row.ends_at) > Date.now() + 60 * 86400000) return deny("A temporary room can last at most 60 days.", "22023");
    }
    if (t === "room_codes" && !["owner", "admin"].includes(roleIn(row.conversation_id))) return deny("new row violates row-level security policy");
    if (t === "resources") {
      const obj = storageMeta.get(`student-resources/${row.object_path}`);
      if (!obj) return deny("Upload the file before adding it to the archive.", "23503");
      if (obj.owner !== uid) return deny("That file was uploaded by someone else.");
      if (row.conversation_id && !myConvIds().has(row.conversation_id)) return deny("new row violates row-level security policy");
      row.size_bytes = obj.size;
      const used = db.resources.filter((r) => r.owner_id === uid).reduce((a, r) => a + r.size_bytes, 0);
      if (used + row.size_bytes > 200 * 1024 * 1024) return deny("Your archive is full (200 MB). Remove something to make room.", "54000");
    }
    if (t === "reports" && row.conversation_id && !myConvIds().has(row.conversation_id)) return deny("new row violates row-level security policy");
    return null;
  }

  class Query {
    constructor(table) {
      if (!(table in db)) throw new Error(`supabase-mock: unknown table ${table}`);
      this.table = table;
      this.op = "select";
      this.selectStr = "*";
      this.returning = false;
      this.filters = [];
      this.orders = [];
      this.limitN = null;
      this.mode = "many";
      this.payload = null;
      this.opts = {};
    }
    select(s = "*") {
      if (this.op === "select") this.selectStr = s;
      else {
        this.returning = true;
        this.selectStr = s;
      }
      return this;
    }
    insert(rows, opts) {
      this.op = "insert";
      this.payload = [].concat(rows);
      this.opts = opts || {};
      return this;
    }
    upsert(rows, opts) {
      this.op = "upsert";
      this.payload = [].concat(rows);
      this.opts = opts || {};
      return this;
    }
    update(patch) {
      this.op = "update";
      this.payload = patch;
      return this;
    }
    delete() {
      this.op = "delete";
      return this;
    }
    eq(col, val) { this.filters.push({ col, op: "eq", val }); return this; }
    neq(col, val) { this.filters.push({ col, op: "neq", val }); return this; }
    in(col, val) { this.filters.push({ col, op: "in", val }); return this; }
    lt(col, val) { this.filters.push({ col, op: "lt", val }); return this; }
    gt(col, val) { this.filters.push({ col, op: "gt", val }); return this; }
    gte(col, val) { this.filters.push({ col, op: "gte", val }); return this; }
    lte(col, val) { this.filters.push({ col, op: "lte", val }); return this; }
    is(col, val) { this.filters.push({ col, op: "is", val }); return this; }
    not(col, op, val) { this.filters.push({ col, op: `not.${op}`, val }); return this; }
    match(obj) { Object.entries(obj).forEach(([c, v]) => this.eq(c, v)); return this; }
    filter(col, op, val) { this.filters.push({ col, op, val }); return this; }
    order(col, { ascending = true } = {}) { this.orders.push({ col, ascending }); return this; }
    limit(n) { this.limitN = n; return this; }
    single() { this.mode = "single"; return this; }
    maybeSingle() { this.mode = "maybe"; return this; }
    then(res, rej) {
      return this.run()
        .then((r) => {
          if (this.op !== "select") persist();
          return r;
        })
        .then(res, rej);
    }
    async run() {
      await ready;
      await sleep(QA.latency ?? 15);
      try {
        return this.finish(this.exec());
      } catch (e) {
        if (String(e.message).startsWith("supabase-mock:")) throw e;
        return { data: null, error: { message: e.message } };
      }
    }
    finish(result) {
      if (result.error) return { data: null, error: result.error };
      let rows = result.rows;
      if (this.mode === "single") {
        if (rows.length !== 1) return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
        return { data: rows[0], error: null };
      }
      if (this.mode === "maybe") return { data: rows[0] || null, error: null };
      return { data: rows, error: null };
    }
    matching() {
      let rows = db[this.table].filter((r) => visible(this.table, r));
      for (const f of this.filters) rows = rows.filter((r) => testFilter(r, f, this.table));
      return rows;
    }
    exec() {
      const t = this.table;
      if (!me() && t !== "profiles") return { error: { message: "not signed in" } };
      if (this.op === "select") {
        // QA.preMigration: behave like a database without supabase-phase15.sql.
        if (QA.preMigration) {
          const missing = parseSelect(this.selectStr).plain.find((c) => ["expires_at", "disappear_after"].includes(c));
          if (missing) return { error: { message: `column ${t}.${missing} does not exist`, code: "42703" } };
        }
        let rows = this.matching();
        // "!inner" embeds drop rows whose relation is missing.
        const { embeds } = parseSelect(this.selectStr);
        for (const e of embeds) if (e.inner) rows = rows.filter((r) => embedFor(t, e.table, r));
        for (const o of [...this.orders].reverse()) {
          rows = rows.slice().sort((a, b) => (o.ascending ? 1 : -1) * cmp(a[o.col], b[o.col]));
        }
        if (this.limitN != null) rows = rows.slice(0, this.limitN);
        return { rows: rows.map((r) => project(t, r, this.selectStr)) };
      }
      if (this.op === "insert" || this.op === "upsert") {
        const out = [];
        const staged = [];
        for (const raw of this.payload) {
          const row = clone(raw);
          if (this.op === "upsert") {
            const key = this.opts.onConflict ? this.opts.onConflict.split(",").map((s) => s.trim()) : CONFLICT_KEY[t] || ["id"];
            const existing = db[t].find((r) => key.every((k) => String(r[k]) === String(row[k])));
            if (existing) {
              Object.assign(existing, row);
              if (t === "profiles") existing.username_lc = String(existing.username || "").toLowerCase();
              emitChange(t, "UPDATE", existing, existing);
              out.push(existing);
              continue;
            }
          }
          applyDefaults(t, row);
          const refused = insertRule(t, row);
          if (refused) return { error: refused };
          const bad = uniqueViolation(t, row, staged);
          if (bad) return { error: bad }; // multi-row inserts are atomic
          staged.push(row);
        }
        for (const row of staged) {
          db[t].push(row);
          out.push(row);
          emitChange(t, "INSERT", row, null);
          if (t === "conversation_participants") {
            const req = db.room_requests.find((r) => r.conversation_id === row.conversation_id && r.user_id === row.user_id);
            if (req) {
              db.room_requests = db.room_requests.filter((r) => r !== req);
              emitChange("room_requests", "DELETE", null, req);
            }
          }
        }
        return { rows: this.returning ? out.map((r) => project(t, r, this.selectStr)) : [] };
      }
      if (this.op === "update") {
        const rows = this.matching();
        for (const r of rows) {
          const before = clone(r);
          Object.assign(r, clone(this.payload));
          if (t === "messages") r.expires_at = before.expires_at; // pinned on edit
          emitChange(t, "UPDATE", r, before);
        }
        return { rows: this.returning ? rows.map((r) => project(t, r, this.selectStr)) : [] };
      }
      if (this.op === "delete") {
        const rows = this.matching();
        if (t === "messages" && rows.some((r) => r.user_id !== me())) return { rows: [] }; // RLS: own only
        db[t] = db[t].filter((r) => !rows.includes(r));
        rows.forEach((r) => emitChange(t, "DELETE", null, r));
        if (t === "messages") {
          const ids = new Set(rows.map((r) => r.id));
          db.message_reactions = db.message_reactions.filter((x) => !ids.has(x.message_id));
        }
        return { rows: this.returning ? rows.map((r) => project(t, r, this.selectStr)) : [] };
      }
      throw new Error(`supabase-mock: unsupported op ${this.op}`);
    }
  }

  // ------------------------------------------------------------------- rpc
  async function rpc(name, args) {
    await ready;
    await sleep(QA.latency ?? 15);
    if (name === "find_profile_by_username") {
      const n = String(args?.name || "").trim().toLowerCase();
      const p = db.profiles.find((x) => x.username_lc === n);
      return { data: p ? [{ id: p.id, username: p.username, public_key: p.public_key || null }] : [], error: null };
    }
    if (name === "delete_my_account") {
      const uid = me();
      db.messages = db.messages.filter((m) => m.user_id !== uid);
      db.conversation_participants = db.conversation_participants.filter((p) => p.user_id !== uid);
      db.profiles = db.profiles.filter((p) => p.id !== uid);
      db.user_keys = db.user_keys.filter((k) => k.user_id !== uid);
      const i = authUsers.findIndex((u) => u.id === uid);
      if (i >= 0) authUsers.splice(i, 1);
      return { data: null, error: null };
    }
    if (name === "request_to_join") {
      const uid = me();
      const code = String(args?.code || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      const rc = db.room_codes.find((r) => r.code === code);
      const conv = rc && db.conversations.find((c) => c.id === rc.conversation_id && !(c.ends_at && Date.parse(c.ends_at) <= Date.now()));
      if (!conv || db.blocks.some((b) => b.blocker_id === conv.created_by && b.blocked_id === uid)) {
        return { data: [{ conversation_id: null, name: null, status: "invalid" }], error: null };
      }
      if (roleIn(conv.id, uid)) return { data: [{ conversation_id: conv.id, name: conv.name, status: "member" }], error: null };
      if (!db.room_requests.some((r) => r.conversation_id === conv.id && r.user_id === uid)) {
        const row = { conversation_id: conv.id, user_id: uid, username: db.profiles.find((p) => p.id === uid)?.username || "someone", created_at: nowIso() };
        db.room_requests.push(row);
        emitChange("room_requests", "INSERT", row, null);
        persist();
      }
      return { data: [{ conversation_id: conv.id, name: conv.name, status: "pending" }], error: null };
    }
    throw new Error(`supabase-mock: unsupported rpc ${name}`);
  }

  // --------------------------------------------------------------- storage
  const storageMeta = new Map(); // "bucket/path" -> { owner, size }
  // The student-resources policies: u/<you>/... or c/<a circle you're in>/...
  function mayUseResourcePath(path) {
    const [scope, id] = String(path).split("/");
    if (scope === "u") return id === me();
    if (scope === "c") return myConvIds().has(id);
    return false;
  }
  // Phase 17: shared files are readable only while listed; uploaders can
  // always read their own; the bucket enforces the quota; hosts may remove.
  function mayReadResourceObject(path) {
    const meta = storageMeta.get(`student-resources/${path}`);
    if (meta?.owner === me()) return true;
    const [scope, id] = String(path).split("/");
    if (scope === "u") return id === me();
    if (scope === "c") return myConvIds().has(id) && db.resources.some((r) => r.object_path === path);
    return false;
  }
  function storageQuotaOk() {
    let bytes = 0;
    let n = 0;
    for (const [k, m] of storageMeta) if (k.startsWith("student-resources/") && m.owner === me()) { bytes += m.size; n++; }
    return bytes < 200 * 1024 * 1024 && n < 1000;
  }
  function mayRemoveResourceObject(path) {
    const meta = storageMeta.get(`student-resources/${path}`);
    if (meta?.owner === me()) return true;
    const [scope, id] = String(path).split("/");
    return scope === "c" && ["owner", "admin"].includes(roleIn(id));
  }
  const storageApi = {
    from(bucket) {
      return {
        async upload(path, blob) {
          await sleep(QA.latency ?? 15);
          if (bucket === "student-resources" && (!mayUseResourcePath(path) || !storageQuotaOk())) {
            return { data: null, error: { message: "new row violates row-level security policy", statusCode: "403" } };
          }
          if (storage.has(`${bucket}/${path}`)) return { data: null, error: { message: "The resource already exists", statusCode: "409" } };
          storage.set(`${bucket}/${path}`, blob);
          storageMeta.set(`${bucket}/${path}`, { owner: me(), size: blob.size });
          return { data: { path }, error: null };
        },
        async download(path) {
          await sleep(QA.latency ?? 15);
          const blob = storage.get(`${bucket}/${path}`);
          if (!blob || (bucket === "student-resources" && !mayReadResourceObject(path))) return { data: null, error: { message: "Object not found", statusCode: "404" } };
          return { data: blob, error: null };
        },
        getPublicUrl(path) {
          return { data: { publicUrl: `${STORAGE_PUBLIC}${bucket}/${path}` } };
        },
        async remove(paths) {
          const gone = paths.filter((p) => bucket === "chat-files" || mayRemoveResourceObject(p));
          gone.forEach((p) => {
            storage.delete(`${bucket}/${p}`);
            storageMeta.delete(`${bucket}/${p}`);
          });
          return { data: gone, error: null };
        },
      };
    },
  };
  // Attachments are fetched by URL; answer those from memory, and make sure
  // nothing in QA can ever reach the real project.
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith(STORAGE_PUBLIC)) {
      const blob = storage.get(url.slice(STORAGE_PUBLIC.length));
      return blob ? new Response(blob, { status: 200 }) : new Response("not found", { status: 404 });
    }
    if (url.startsWith(SUPA)) throw new Error("supabase-mock: blocked a real Supabase request");
    return realFetch(input, init);
  };

  // ---------------------------------------------------------------- client
  const client = {
    auth: {
      async getSession() {
        await ready;
        return { data: { session }, error: null };
      },
      async getUser() {
        return { data: { user: session?.user || null }, error: null };
      },
      onAuthStateChange(cb) {
        authListeners.add(cb);
        return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
      },
      async signInWithPassword({ email, password }) {
        await ready;
        await sleep(200);
        const u = authUsers.find((x) => x.email.toLowerCase() === String(email).toLowerCase());
        if (!u || u.password !== password) return { data: { session: null, user: null }, error: { message: "Invalid login credentials" } };
        const s = makeSession(u);
        setSession(s, "SIGNED_IN");
        return { data: { session: s, user: s.user }, error: null };
      },
      async signUp({ email, password, options }) {
        await ready;
        await sleep(250);
        if (authUsers.some((x) => x.email.toLowerCase() === String(email).toLowerCase())) {
          return { data: { user: null, session: null }, error: { message: "User already registered" } };
        }
        const username = options?.data?.username || email.split("@")[0];
        if (db.profiles.some((p) => p.username_lc === username.toLowerCase())) {
          return { data: { user: null, session: null }, error: { message: "Database error saving new user" } };
        }
        const u = { id: uuid(), email, password, user_metadata: { username } };
        authUsers.push(u);
        const prof = { id: u.id, username, bio: null, avatar_url: null, public_key: null };
        applyDefaults("profiles", prof);
        db.profiles.push(prof);
        if (QA.confirmEmail) {
          pendingOtp.set(email.toLowerCase(), u);
          return { data: { user: { id: u.id, email }, session: null }, error: null };
        }
        const s = makeSession(u);
        setSession(s, "SIGNED_IN");
        persist();
        return { data: { user: s.user, session: s }, error: null };
      },
      async verifyOtp({ email, token }) {
        await sleep(200);
        const u = pendingOtp.get(String(email).toLowerCase());
        if (!u || token !== "123456") return { data: { session: null }, error: { message: "Token has expired or is invalid" } };
        const s = makeSession(u);
        setSession(s, "SIGNED_IN");
        return { data: { session: s, user: s.user }, error: null };
      },
      async resend() {
        await sleep(150);
        return { data: {}, error: null };
      },
      async signOut() {
        setSession(null, "SIGNED_OUT");
        return { error: null };
      },
      async updateUser(patch) {
        const u = authUsers.find((x) => x.id === me());
        if (!u) return { data: { user: null }, error: { message: "not signed in" } };
        if (patch.password) u.password = patch.password;
        if (patch.data) Object.assign(u.user_metadata, patch.data);
        session.user.user_metadata = clone(u.user_metadata);
        return { data: { user: clone(session.user) }, error: null };
      },
      async resetPasswordForEmail() {
        await sleep(150);
        return { data: {}, error: null };
      },
    },
    from: (t) => new Query(t),
    rpc,
    storage: storageApi,
    channel: (name) => createChannel(name),
    removeChannel: (ch) => {
      if (ch) {
        ch.subscribed = false;
        channels.delete(ch);
      }
      return Promise.resolve("ok");
    },
    getChannels: () => [...channels],
  };
  const pendingOtp = new Map();

  // ----------------------------------------------------------- persistence
  // The "server" survives a reload within the same tab, so reload flows
  // (session restore, theme before first paint, app lock) can be tested.
  const SNAPSHOT_KEY = "qa.mock.db";
  let persistTimer = null;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(async () => {
      const keys = {};
      for (const [id, key] of convKeys) {
        keys[id] = [...new Uint8Array(await crypto.subtle.exportKey("raw", key))];
      }
      try {
        sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ db, authUsers, keys }));
      } catch {}
    }, 30);
  }
  async function restoreSnapshot() {
    let snap = null;
    try {
      snap = JSON.parse(sessionStorage.getItem(SNAPSHOT_KEY) || "null");
    } catch {}
    if (!snap) return false;
    Object.assign(db, snap.db);
    authUsers.push(...snap.authUsers);
    for (const [id, raw] of Object.entries(snap.keys || {})) {
      convKeys.set(id, await crypto.subtle.importKey("raw", new Uint8Array(raw), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]));
    }
    return true;
  }

  // ----------------------------------------------------------------- seed
  // Waits for crypto.js (loaded right after this file) so seeded chats are
  // genuinely encrypted and exercise the real decrypt path.
  async function seed() {
    for (let i = 0; i < 200 && !window.PanaloCrypto; i++) await sleep(10);
    const C = window.PanaloCrypto;
    if (await restoreSnapshot()) return restoreSession();
    if (QA.seed === false) return restoreSession();

    const people = [
      { username: "alex", email: "qa@panalo.test", password: "correct-horse-42", bio: "building things, mostly at 2am" },
      { username: "maya", bio: "physics > everything 🔭" },
      { username: "jordan", bio: "drums, dogs, deadlines" },
      { username: "priya", bio: "ask me about chem notes" },
      { username: "sam", bio: null },
    ];
    for (const p of people) {
      const id = uuid();
      const kp = await C.generateUserKeypair();
      const pub = await C.exportPublicKey(kp.publicKey);
      privateKeys.set(p.username, kp.privateKey);
      const prof = { id, username: p.username, bio: p.bio, avatar_url: null, public_key: pub };
      applyDefaults("profiles", prof);
      db.profiles.push(prof);
      p.id = id;
      if (p.email) {
        authUsers.push({ id, email: p.email, password: p.password, user_metadata: { username: p.username } });
        const stored = await C.protectPrivateKey(kp.privateKey, p.password);
        db.user_keys.push({ user_id: id, enc_private_key: stored.encPrivateKey, key_salt: stored.keySalt, key_iv: stored.keyIv, key_iterations: stored.keyIterations });
      }
    }
    const byName = Object.fromEntries(people.map((p) => [p.username, p]));
    const alex = byName.alex;

    async function makeConv({ type, name, members, theme = null, created, timer = null }) {
      const conv = { id: uuid(), type, name, created_at: ago(created), created_by: alex.id, theme, disappear_after: timer, description: null };
      db.conversations.push(conv);
      for (const m of members) {
        db.conversation_participants.push({
          conversation_id: conv.id,
          user_id: byName[m].id,
          role: type === "group" ? (m === "alex" ? "owner" : m === "maya" ? "admin" : "member") : "member",
          created_at: conv.created_at,
        });
      }
      const key = await C.generateConversationKey();
      convKeys.set(conv.id, key);
      for (const m of members) {
        const pub = await C.importPublicKey(db.profiles.find((p) => p.id === byName[m].id).public_key);
        db.conversation_keys.push({ conversation_id: conv.id, user_id: byName[m].id, wrapped_key: await C.wrapConversationKey(key, pub) });
      }
      return conv;
    }
    async function say(conv, who, text, minsAgo, extra = {}) {
      const enc = await C.encryptMessage(text, convKeys.get(conv.id));
      const row = {
        id: uuid(),
        conversation_id: conv.id,
        user_id: byName[who].id,
        username: who,
        content: enc.ciphertext,
        iv: enc.iv,
        file_url: null,
        created_at: ago(minsAgo),
        client_id: uuid(),
        reply_to: extra.replyTo || null,
        edited_at: extra.edited ? ago(minsAgo - 1) : null,
        expires_at: null,
      };
      db.messages.push(row);
      return row;
    }

    const maya = await makeConv({ type: "direct", name: "maya", members: ["alex", "maya"], created: 60 * 24 * 30 });
    await say(maya, "maya", "did you finish the lab writeup?", 60 * 26);
    await say(maya, "alex", "almost — stuck on the error propagation part", 60 * 26 - 3);
    await say(maya, "maya", "ok so you add the relative uncertainties in quadrature, not linearly", 60 * 26 - 5);
    await say(maya, "maya", "sqrt((dx/x)^2 + (dy/y)^2) basically", 60 * 26 - 5);
    await say(maya, "alex", "ohhh that's why my number was so big", 60 * 26 - 9);
    await say(maya, "alex", "thank you!!", 60 * 26 - 9);
    const q = await say(maya, "maya", "also are we still on for the library tomorrow at 4?", 95);
    await say(maya, "alex", "yes! I'll bring the flashcards", 92, { replyTo: q.id });
    await say(maya, "maya", "🔥", 90);
    const long = await say(maya, "maya", "Okay here's the plan for Thursday: we go through chapters 7 and 8 first, then do the past paper under timed conditions, then swap and mark each other's answers. If we still have energy we can do the optics problem set. Sound good?", 40);
    await say(maya, "alex", "sounds perfect. maybe snacks first though 🍪", 38, { edited: true });
    await say(maya, "maya", "obviously", 12);
    db.message_reactions.push({ id: uuid(), message_id: long.id, user_id: alex.id, emoji: "👍", created_at: ago(37) });

    const physics = await makeConv({ type: "group", name: "Physics study group", members: ["alex", "maya", "priya", "sam"], theme: "ocean", created: 60 * 24 * 12 });
    await say(physics, "priya", "notes from today are in the drive", 60 * 5);
    await say(physics, "sam", "legend", 60 * 5 - 2);
    await say(physics, "maya", "@alex can you explain the bit about interference fringes tomorrow?", 25);
    await say(physics, "priya", "same, I got lost around the double slit", 22);

    const jordan = await makeConv({ type: "direct", name: "jordan", members: ["alex", "jordan"], created: 60 * 24 * 20 });
    await say(jordan, "alex", "how did the gig go?", 60 * 24 + 200);
    await say(jordan, "jordan", "SO good. the crowd actually sang along", 60 * 24 + 120);
    await say(jordan, "jordan", "sending you the video later", 60 * 24 + 119);

    const weekend = await makeConv({ type: "group", name: "Weekend plans", members: ["alex", "jordan", "sam"], created: 60 * 24 * 40 });
    await say(weekend, "sam", "hike on saturday?", 60 * 24 * 4);
    await say(weekend, "jordan", "if it doesn't rain 🌧️", 60 * 24 * 4 - 30);

    const samDm = await makeConv({ type: "direct", name: "sam", members: ["alex", "sam"], created: 60 * 24 * 50 });
    await say(samDm, "sam", "thanks for the notes!", 60 * 24 * 9);

    // Read markers: alex has read everything except the newest few.
    const lastRead = (conv, minsAgo) => db.conversation_reads.push({ conversation_id: conv.id, user_id: alex.id, last_read_at: ago(minsAgo) });
    lastRead(maya, 13);
    lastRead(physics, 26);
    lastRead(jordan, 60 * 24 + 150);
    lastRead(weekend, 0);
    lastRead(samDm, 0);
    // Maya has read up to alex's latest.
    db.conversation_reads.push({ conversation_id: maya.id, user_id: byName.maya.id, last_read_at: ago(11) });

    persist();
    restoreSession();
  }
  function restoreSession() {
    try {
      const uid = localStorage.getItem(SESSION_KEY);
      const u = uid && authUsers.find((x) => x.id === uid);
      if (u) session = makeSession(u);
    } catch {}
  }
  const ready = seed();

  // --------------------------------------------------------------- QA hooks
  // Simulate the other side: an incoming (encrypted) message, or typing.
  window.__qa = {
    db,
    ready,
    async receive(convName, fromUser, text) {
      await ready;
      const conv = db.conversations.find((c) => c.name === convName);
      const from = db.profiles.find((p) => p.username === fromUser);
      const key = convKeys.get(conv.id);
      const enc = await window.PanaloCrypto.encryptMessage(text, key);
      const row = { id: uuid(), conversation_id: conv.id, user_id: from.id, username: fromUser, content: enc.ciphertext, iv: enc.iv, file_url: null, created_at: nowIso(), client_id: uuid(), reply_to: null, edited_at: null };
      applyDefaults("messages", row);
      db.messages.push(row);
      emitChange("messages", "INSERT", row, null);
      persist();
      return row.id;
    },
    // Someone else asks to join a room by its code (Panalo Students).
    async knock(fromUser, code) {
      await ready;
      const from = db.profiles.find((p) => p.username === fromUser);
      const rc = db.room_codes.find((r) => r.code === String(code).replace(/[^A-Za-z0-9]/g, "").toUpperCase());
      if (!from || !rc) return false;
      const row = { conversation_id: rc.conversation_id, user_id: from.id, username: fromUser, created_at: nowIso() };
      db.room_requests.push(row);
      emitChange("room_requests", "INSERT", row, null);
      persist();
      return true;
    },
    typing(convName) {
      const conv = db.conversations.find((c) => c.name === convName);
      broadcast(`room:${conv.id}`, "typing", {});
    },
  };

  window.supabase = { createClient: () => client };
})();
