// The database, tested as a database.
//
// Every other test file here is pure-function. This one replays the real
// supabase-*.sql files against an in-process Postgres (PGlite) and then acts
// as signed-in users through RLS, the way the app does. It exists because
// the worst bugs this project has shipped were all in SQL that no test could
// see: a migration never run, a consolidated file that could not be re-run,
// and phase 13 moving a helper that two trigger bodies still called by its
// old name -- which silently stopped anyone adding a second person to a chat.
//
// Needs PGlite, installed once:
//   cd tools/sqltest && npm install

let harness;
try {
  harness = await import("../tools/sqltest/harness.mjs");
} catch {
  console.log("SKIPPED: PGlite is not installed. Run `cd tools/sqltest && npm install`.");
  process.exit(0);
}
const { MIGRATIONS, createDb, replay, runFile, createUser, as, attempt } = harness;

let passed = 0;
const failures = [];
const ok = (label, cond, detail = "") => (cond ? passed++ : failures.push(detail ? `${label} (${detail})` : label));

// ---- fixtures -----------------------------------------------------------

async function freshDb() {
  const db = await createDb();
  const r = await replay(db);
  if (!r.ok) throw new Error(`replay failed at ${r.file}: ${r.error}`);
  return db;
}

async function startDirect(db, me, other) {
  return as(db, me, async (tx) => {
    const id = (await tx.query("insert into conversations (type, name) values ('direct', 'dm') returning id")).rows[0].id;
    await tx.query(
      "insert into conversation_participants (conversation_id, user_id) values ($1, $2), ($1, $3)",
      [id, me, other]
    );
    await tx.query(
      "insert into conversation_keys (conversation_id, user_id, wrapped_key) values ($1, $2, 'k'), ($1, $3, 'k')",
      [id, me, other]
    );
    return id;
  });
}

async function startGroup(db, me, others) {
  return as(db, me, async (tx) => {
    const id = (await tx.query("insert into conversations (type, name) values ('group', 'g') returning id")).rows[0].id;
    for (const u of [me, ...others]) {
      await tx.query("insert into conversation_participants (conversation_id, user_id) values ($1, $2)", [id, u]);
    }
    return id;
  });
}

const roleOf = async (db, conv, user) =>
  (await db.query("select role from conversation_participants where conversation_id = $1 and user_id = $2", [conv, user]))
    .rows[0]?.role;

// ---- the migrations themselves -------------------------------------------

async function migrationTests() {
  const db = await createDb();
  const first = await replay(db);
  ok("every migration runs on a fresh project", first.ok, first.error && `${first.file}: ${first.error}`);

  // The SQL Editor gives no undo, so "idempotent" has to be literally true:
  // each file, run again on a database that already has everything.
  for (const f of MIGRATIONS) {
    const r = await runFile(db, f);
    ok(`${f} can be re-run`, r.ok, r.error);
  }
  const all = await runFile(db, "supabase-all.sql");
  ok("supabase-all.sql can be re-run on a live database", all.ok, all.error);

  // Re-running old phases used to recreate the helpers in `public`, exposed
  // at /rest/v1/rpc/ and silently re-pointing live policies at the copies.
  const { rows: helpers } = await db.query(
    `select n.nspname as schema, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.proname in ('is_conversation_member', 'my_conversation_role', 'shares_conversation_with')`
  );
  ok("RLS helpers exist only in `private` after re-runs",
     helpers.length === 3 && helpers.every((h) => h.schema === "private"),
     JSON.stringify(helpers));

  const { rows: pols } = await db.query(
    `select policyname from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'public\\.(is_conversation_member|my_conversation_role|shares_conversation_with)'`
  );
  ok("no policy points at a helper in `public`", pols.length === 0, pols.map((p) => p.policyname).join(", "));

  // The linter floor: exactly the functions the app calls directly stay
  // callable by signed-in users. Anything else is a new exposed endpoint.
  // request_to_join (phase 16) is the third, for the same reason as
  // find_profile_by_username: a join code must find a room you can't see yet.
  const { rows: exposed } = await db.query(
    `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     order by 1`
  );
  // Phase 20's moderation_* functions each check for a moderator first
  // (moderation_claim and moderation_status excepted, by design).
  // Phase 22's age and consent functions check who's asking themselves.
  const EXPECTED_DEFINERS = ["decide_parent_consent", "delete_my_account", "find_profile_by_username", "moderation_claim", "moderation_delete_message",
    "moderation_history", "moderation_reports", "moderation_set_birth", "moderation_set_passphrase", "moderation_set_status", "moderation_status",
    "moderation_suspend", "my_age_status", "my_children_requests", "my_storage_objects", "request_parent_consent", "request_to_join",
    "set_my_birth", "withdraw_parent_consent"];
  ok("only the known SECURITY DEFINER functions are callable by signed-in users",
     JSON.stringify(exposed.map((r) => r.proname)) === JSON.stringify(EXPECTED_DEFINERS),
     exposed.map((r) => r.proname).join(", "));

  const { rows: dupes } = await db.query(
    `select count(*)::int as n from pg_index i where i.indrelid = 'public.profiles'::regclass
     and i.indisunique and pg_get_indexdef(i.indexrelid) ilike '%lower(username%'`
  );
  ok("exactly one unique index on lower(username)", dupes[0].n === 1, `found ${dupes[0].n}`);

  // Phase 19: auth.uid() once per query, and an index under every foreign key.
  const { rows: perRow } = await db.query(
    `select policyname from pg_policies where schemaname = 'public'
       and replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''), '( SELECT auth.uid() AS uid)', '') ~ 'auth\\.uid\\(\\)'`
  );
  ok("no policy calls auth.uid() once per row", perRow.length === 0, perRow.map((p) => p.policyname).join(", "));
  const { rows: doubled } = await db.query(
    `select policyname from pg_policies where schemaname = 'public'
       and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'SELECT \\( SELECT auth'`
  );
  ok("re-running phase 19 doesn't wrap auth.uid() twice", doubled.length === 0, doubled.map((p) => p.policyname).join(", "));
  const { rows: bare } = await db.query(
    `select c.conrelid::regclass::text || '.' || c.conname as fk from pg_constraint c
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace
       and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])`
  );
  ok("every foreign key in public has an index", bare.length === 0, bare.map((r) => r.fk).join(", "));
}

// ---- starting and leaving chats ------------------------------------------

async function chatTests() {
  const db = await freshDb();
  const alice = await createUser(db, "alice");
  const bob = await createUser(db, "bob");
  const carol = await createUser(db, "carol");

  // The regression phase 13 caused: stamp_creator_as_owner called
  // public.my_conversation_role, which no longer existed.
  let dm;
  try {
    dm = await startDirect(db, alice, bob);
  } catch (e) {
    ok("a 1:1 chat with a second person can be created", false, e.message);
    return;
  }
  ok("a 1:1 chat with a second person can be created", !!dm);
  const grp = await startGroup(db, alice, [bob, carol]);
  ok("a group with members can be created", !!grp);
  ok("the creator is stamped as owner", (await roleOf(db, grp, alice)) === "owner");
  ok("everyone else joins as member", (await roleOf(db, grp, bob)) === "member");

  // Role changes go through guard_role_change, the other function that
  // still called the old name.
  const promote = await attempt(db, alice, (tx) =>
    tx.query("update conversation_participants set role = 'admin' where conversation_id = $1 and user_id = $2", [grp, bob])
  );
  ok("an owner can make someone admin", promote.ok, promote.error);

  const selfPromote = await attempt(db, carol, (tx) =>
    tx.query("update conversation_participants set role = 'owner' where conversation_id = $1 and user_id = $2", [grp, carol])
  );
  ok("a member cannot promote themselves",
     !selfPromote.ok || (await roleOf(db, grp, carol)) === "member", selfPromote.error);

  // Leaving hands ownership to someone else. The hand-off is an UPDATE made
  // by a trigger, and the role guard used to refuse it because the person
  // leaving no longer had a role -- so the leave itself failed.
  const dmDelete = await attempt(db, alice, async (tx) => {
    const r = await tx.query("delete from conversation_participants where conversation_id = $1 and user_id = $2", [dm, alice]);
    return r.affectedRows;
  });
  ok("the creator of a 1:1 chat can delete it (delete for me)",
     dmDelete.ok && dmDelete.value === 1, dmDelete.error || `deleted ${dmDelete.value}`);

  const leave = await attempt(db, alice, async (tx) => {
    await tx.query("delete from conversation_participants where conversation_id = $1 and user_id = $2", [grp, alice]);
    // Counted as the database, not as alice: once she has left, RLS rightly
    // hides the group's roster from her.
    await tx.exec("reset role");
    const { rows } = await tx.query(
      "select count(*)::int as n from conversation_participants where conversation_id = $1 and role = 'owner'", [grp]
    );
    return rows[0].n;
  });
  ok("a group owner can leave, and someone else becomes owner",
     leave.ok && leave.value === 1, leave.error || `owners left: ${leave.value}`);
}

// ---- conversations cannot be taken over -----------------------------------

async function takeoverTests() {
  const db = await freshDb();
  const alice = await createUser(db, "alice");
  const bob = await createUser(db, "bob");
  let dm;
  try {
    dm = await startDirect(db, alice, bob);
  } catch (e) {
    ok("takeover fixtures", false, e.message);
    return;
  }

  // created_by carries power (it can add participants and delete anyone's
  // key rows), and the direct-chat update policy let either member rewrite
  // it -- after which bob could delete alice's key and push her client into
  // sending plaintext.
  await attempt(db, bob, (tx) => tx.query("update conversations set created_by = $1 where id = $2", [bob, dm]));
  const probe = await attempt(db, bob, async (tx) => {
    await tx.query("update conversations set created_by = $1 where id = $2", [bob, dm]);
    const k = await tx.query("delete from conversation_keys where conversation_id = $1 and user_id = $2", [dm, alice]);
    const c = await tx.query("select created_by from conversations where id = $1", [dm]);
    return { keysDeleted: k.affectedRows, creator: c.rows[0].created_by };
  });
  ok("the other member cannot make themselves a chat's creator",
     !probe.ok || probe.value.creator === alice, probe.ok && JSON.stringify(probe.value));
  ok("the other member cannot delete your key row",
     !probe.ok || probe.value.keysDeleted === 0, probe.ok && JSON.stringify(probe.value));

  const typeChange = await attempt(db, bob, async (tx) => {
    await tx.query("update conversations set type = 'group' where id = $1", [dm]);
    return (await tx.query("select type from conversations where id = $1", [dm])).rows[0].type;
  });
  ok("a chat's type cannot be changed after creation", !typeChange.ok || typeChange.value === "direct");

  // Renaming and re-theming still work: pinning identity must not break the
  // updates the app actually makes.
  const theme = await attempt(db, bob, (tx) =>
    tx.query("update conversations set theme = 'ocean' where id = $1", [dm]).then((r) => r.affectedRows)
  );
  ok("members can still change a 1:1 chat's theme", theme.ok && theme.value === 1, theme.error);

  // A read marker is yours, but it must not be movable into a chat you are
  // not in, where it would show you as having read their messages.
  const carol = await createUser(db, "carol");
  const other = await startDirect(db, bob, carol);
  await as(db, alice, (tx) => tx.query("insert into conversation_reads (conversation_id, user_id) values ($1, $2)", [dm, alice]));
  const move = await attempt(db, alice, (tx) =>
    tx.query("update conversation_reads set conversation_id = $1 where conversation_id = $2 and user_id = $3", [other, dm, alice])
      .then((r) => r.affectedRows)
  );
  ok("a read marker cannot be moved into someone else's chat", !move.ok || move.value === 0, move.error);
}

// ---- calls ----------------------------------------------------------------

async function callTests() {
  const db = await freshDb();
  const alice = await createUser(db, "alice");
  const bob = await createUser(db, "bob");
  const stranger = await createUser(db, "stranger");
  try {
    await startDirect(db, alice, bob);
  } catch (e) {
    ok("call fixtures", false, e.message);
    return;
  }

  const friendly = await attempt(db, alice, (tx) =>
    tx.query("insert into call_invites (callee_id, kind, offer_sdp) values ($1, 'voice', 'sdp')", [bob])
  );
  ok("you can call someone you share a chat with", friendly.ok, friendly.error);

  const cold = await attempt(db, stranger, (tx) =>
    tx.query("insert into call_invites (callee_id, kind, offer_sdp) values ($1, 'voice', 'sdp')", [alice])
  );
  ok("you cannot ring a stranger", !cold.ok);
}

// ---- accounts --------------------------------------------------------------

async function accountTests() {
  const db = await freshDb();

  // Signup creates the profile in the same transaction as the account, so a
  // taken name refuses the signup instead of leaving an account with no
  // profile -- which could not chat, be found, or encrypt anything.
  const { rows } = await db.query(
    "insert into auth.users (email, raw_user_meta_data) values ('h@example.test', $1) returning id",
    [JSON.stringify({ username: "Heisenberg" })]
  );
  const prof = await db.query("select username from profiles where id = $1", [rows[0].id]);
  ok("signing up creates the profile", prof.rows[0]?.username === "Heisenberg");

  let refused = false;
  try {
    await db.query(
      "insert into auth.users (email, raw_user_meta_data) values ('h2@example.test', $1)",
      [JSON.stringify({ username: "heisenberg" })]
    );
  } catch {
    refused = true;
  }
  ok("signing up with a taken username is refused", refused);
  const ghosts = await db.query(
    "select count(*)::int as n from auth.users u where not exists (select 1 from profiles p where p.id = u.id)"
  );
  ok("no account exists without a profile", ghosts.rows[0].n === 0, `ghosts: ${ghosts.rows[0].n}`);

  // Deleting your account removes you, not everyone you ever talked to.
  const alice = await createUser(db, "alice");
  const bob = await createUser(db, "bob");
  const carol = await createUser(db, "carol");
  let dm, grp;
  try {
    dm = await startDirect(db, alice, bob);
    grp = await startGroup(db, alice, [bob, carol]);
  } catch (e) {
    ok("account fixtures", false, e.message);
    return;
  }
  await as(db, bob, (tx) =>
    tx.query("insert into messages (conversation_id, content) values ($1, 'bob in dm'), ($2, 'bob in group')", [dm, grp])
  );

  const del = await attempt(db, alice, async (tx) => {
    await tx.query("select public.delete_my_account()");
    await tx.exec("reset role");
    const msgs = await tx.query("select count(*)::int as n from messages where user_id = $1", [bob]);
    const gone = await tx.query("select count(*)::int as n from auth.users where id = $1", [alice]);
    const owner = await tx.query(
      "select count(*)::int as n from conversation_participants where conversation_id = $1 and role = 'owner'", [grp]
    );
    return { bobMessages: msgs.rows[0].n, aliceLeft: gone.rows[0].n, groupOwners: owner.rows[0].n };
  });
  ok("delete_my_account succeeds for someone who started chats", del.ok, del.error);
  ok("deleting an account keeps other people's messages in chats it started",
     del.ok && del.value.bobMessages === 2, del.ok ? `bob's messages left: ${del.value.bobMessages}` : "");
  ok("the deleted account is actually gone", del.ok && del.value.aliceLeft === 0);
  ok("a group whose owner deletes their account gets a new owner", del.ok && del.value.groupOwners === 1);
}

// ---- repairing groups that already have no owner ---------------------------

async function backfillTests() {
  const db = await createDb();
  const before = await replay(db, MIGRATIONS.filter((f) => f !== "supabase-phase14.sql"));
  if (!before.ok) {
    ok("pre-phase-14 replay works", false, before.error);
    return;
  }
  const alice = await createUser(db, "alice");
  const bob = await createUser(db, "bob");
  // Groups left ownerless the way production's were: the rows exist, nobody
  // holds the owner role. Written directly, as the damage already happened.
  const { rows } = await db.query(
    "insert into conversations (type, name, created_by) values ('group', 'orphan', $1) returning id", [alice]
  );
  const orphan = rows[0].id;
  await db.query("alter table conversation_participants disable trigger user");
  await db.query(
    "insert into conversation_participants (conversation_id, user_id, role) values ($1, $2, 'member')", [orphan, bob]
  );
  await db.query("alter table conversation_participants enable trigger user");

  const r = await runFile(db, "supabase-phase14.sql");
  ok("phase 14 applies on a pre-phase-14 database", r.ok, r.error);
  ok("an ownerless group gets an owner from its remaining members", (await roleOf(db, orphan, bob)) === "owner");
}

// ---- phase 13 against every history it has met ----------------------------

// Phase 13 has been "fixed" twice, in opposite directions, by two sessions:
// once dropping the public copy of a helper, once dropping the private one.
// Each broke a real database whose history the other did not expect -- the
// second failed in production because phase 14's policies use the private
// copy. It now drops whichever copy no policy depends on. These build each
// history by hand and check it does the right thing.
async function historyTests() {
  const helperSchemas = async (db) =>
    (await db.query(
      `select n.nspname as s from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where p.proname = 'is_conversation_member' order by 1`
    )).rows.map((r) => r.s).join(",");

  const PUBLIC_COPY = `
    create function public.is_conversation_member(conv uuid) returns boolean
      language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.conversation_participants
                     where conversation_id = conv and user_id = auth.uid()) $$;`;

  // A stray public copy nothing uses: the leftover of an old re-run.
  {
    const db = await freshDb();
    await db.exec(PUBLIC_COPY);
    const r = await runFile(db, "supabase-phase13.sql");
    ok("phase 13 drops an unused public copy", r.ok && (await helperSchemas(db)) === "private", r.error);
  }

  // Both copies in use -- production's state when it ran the other branch's
  // phase 13 after phase 14. Must refuse with a readable message, never drop
  // a helper a policy needs.
  {
    const db = await freshDb();
    await db.exec(`${PUBLIC_COPY}
      drop policy "messages read" on public.messages;
      create policy "messages read" on public.messages for select to authenticated
        using (public.is_conversation_member(conversation_id));`);
    const r = await runFile(db, "supabase-phase13.sql");
    ok("phase 13 refuses, with instructions, when both copies are in use",
       !r.ok && /Re-run supabase-setup\.sql through supabase-phase11\.sql/.test(r.error || ""), r.error);
    ok("... and leaves both copies in place", (await helperSchemas(db)) === "private,public");

    // Following its instructions resolves it: the earlier phases re-point
    // every policy at private, leaving the public copy unused.
    for (const f of ["supabase-setup.sql", "supabase-keys.sql", "supabase-phase5.sql", "supabase-phase6.sql",
                     "supabase-phase7.sql", "supabase-phase8.sql", "supabase-phase9.sql",
                     "supabase-phase10.sql", "supabase-phase11.sql"]) {
      await runFile(db, f);
    }
    const again = await runFile(db, "supabase-phase13.sql");
    ok("... and succeeds once the earlier phases are re-run",
       again.ok && (await helperSchemas(db)) === "private", again.error);
  }
}

// ---- disappearing messages (phase 15) ---------------------------------------

async function disappearTests() {
  const db = await freshDb();
  const alice = await createUser(db, "alice");
  const bob = await createUser(db, "bob");
  const carol = await createUser(db, "carol");
  const dm = await startDirect(db, alice, bob);

  const send = (who, conv, expiresSql = null) =>
    as(db, who, async (tx) =>
      (await tx.query(
        `insert into messages (conversation_id, user_id, username, content, expires_at)
         values ($1, $2, 'x', 'hi', ${expiresSql || "null"}) returning id, expires_at`,
        [conv, who]
      )).rows[0]
    );

  const plain = await send(alice, dm);
  ok("without a timer, messages do not expire", plain.expires_at === null);

  const forged = await send(alice, dm, "now() + interval '100 years'");
  ok("a client cannot choose its own expiry", forged.expires_at === null);

  const silly = await attempt(db, alice, (tx) =>
    tx.query("update conversations set disappear_after = interval '1 second' where id = $1", [dm])
  );
  ok("only the offered timers are accepted", !silly.ok);

  await as(db, bob, (tx) => tx.query("update conversations set disappear_after = interval '7 days' where id = $1", [dm]));
  const setting = (await db.query("select disappear_after::text as t from conversations where id = $1", [dm])).rows[0].t;
  ok("either person in a 1:1 chat can set the timer", setting === "7 days", setting);

  const timed = await send(alice, dm);
  const days = (new Date(timed.expires_at) - Date.now()) / 86400000;
  ok("the database stamps the expiry from the chat's timer", days > 6.9 && days < 7.1, `${days} days`);

  const extend = await attempt(db, alice, async (tx) => {
    await tx.query("update messages set content = 'edited', expires_at = null where id = $1", [timed.id]);
    return (await tx.query("select expires_at from messages where id = $1", [timed.id])).rows[0].expires_at;
  });
  ok("editing a message cannot take it off the timer", extend.ok && extend.value !== null, extend.error);

  // Age the message past its expiry as the database itself, skipping the
  // trigger that would otherwise pin it.
  await db.exec("set session_replication_role = replica");
  await db.query("update messages set expires_at = now() - interval '1 minute' where id = $1", [timed.id]);
  await db.exec("set session_replication_role = origin");

  const seen = await as(db, bob, async (tx) =>
    (await tx.query("select id from messages where conversation_id = $1", [dm])).rows.map((r) => r.id)
  );
  ok("an expired message is hidden before the clean-up runs", !seen.includes(timed.id) && seen.includes(plain.id));

  const callPurge = await attempt(db, alice, (tx) => tx.query("select private.purge_disappeared_messages()"));
  ok("nobody can run the clean-up over the API", !callPurge.ok);

  const removed = (await db.query("select private.purge_disappeared_messages() as n")).rows[0].n;
  const left = (await db.query("select count(*)::int as n from messages where id = $1", [timed.id])).rows[0].n;
  ok("the clean-up deletes expired messages and nothing else", removed === 1 && left === 0, `removed ${removed}`);

  const grp = await startGroup(db, alice, [bob, carol]);
  const byMember = await attempt(db, carol, async (tx) =>
    (await tx.query("update conversations set disappear_after = interval '1 day' where id = $1", [grp])).affectedRows
  );
  ok("an ordinary group member cannot change the timer", !byMember.ok || byMember.value === 0);
  const byOwner = await attempt(db, alice, async (tx) =>
    (await tx.query("update conversations set disappear_after = interval '1 day' where id = $1", [grp])).affectedRows
  );
  ok("a group owner can change the timer", byOwner.ok && byOwner.value === 1, byOwner.error);
}

// ---- Panalo Students (phase 16) -------------------------------------------

async function studentsTests() {
  const db = await freshDb();
  const alex = await createUser(db, "s_alex");
  const maya = await createUser(db, "s_maya");
  const sam = await createUser(db, "s_sam");

  // -- private study data
  const task = await as(db, alex, async (tx) =>
    (await tx.query("insert into student_tasks (title) values ('Revise optics') returning id")).rows[0].id);
  const seen = await as(db, maya, async (tx) => (await tx.query("select id from student_tasks")).rows.length);
  ok("tasks are private to their owner", seen === 0, `maya saw ${seen}`);
  const forged = await attempt(db, maya, (tx) =>
    tx.query("insert into student_tasks (user_id, title) values ($1, 'x')", [alex]));
  ok("nobody can write a task as someone else", !forged.ok);

  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const honest = await attempt(db, alex, (tx) => tx.query(
    "insert into focus_sessions (started_at, ended_at, planned_minutes, focused_minutes, task_id) values ($1, $2, 25, 25, $3)",
    [iso(now - 26 * 60000), iso(now), task]));
  ok("a real focus session is recorded", honest.ok, honest.error);
  const inflated = await attempt(db, alex, (tx) => tx.query(
    "insert into focus_sessions (started_at, ended_at, planned_minutes, focused_minutes) values ($1, $2, 25, 25)",
    [iso(now - 5 * 60000), iso(now)]));
  ok("focus cannot exceed the time that passed", !inflated.ok);
  const borrowed = await attempt(db, maya, (tx) => tx.query(
    "insert into focus_sessions (started_at, ended_at, planned_minutes, focused_minutes, task_id) values ($1, $2, 25, 1, $3)",
    [iso(now - 5 * 60000), iso(now), task]));
  ok("a session cannot point at someone else's task", !borrowed.ok);

  const goals = await attempt(db, alex, async (tx) => {
    for (let i = 0; i < 25; i++) await tx.query("insert into student_goals (title) values ($1)", [`goal ${i}`]);
  });
  ok("goals are capped per person", !goals.ok && /limit of 24/.test(goals.error || ""), goals.error);

  // -- archive
  const upload = (tx, path, owner, size) => tx.query(
    "insert into storage.objects (bucket_id, name, owner, metadata) values ('student-resources', $1, $2, $3)",
    [path, owner, JSON.stringify({ size })]);
  const ghost = await attempt(db, alex, (tx) => tx.query(
    "insert into resources (title, object_path, file_name, size_bytes) values ('x', $1, 'x.pdf', 10)", [`u/${alex}/nothing`]));
  ok("an archive row needs a real uploaded file", !ghost.ok);

  const mine = `u/${alex}/notes`;
  const res = await as(db, alex, async (tx) => {
    await upload(tx, mine, alex, 1234);
    return (await tx.query(
      "insert into resources (title, object_path, file_name, size_bytes) values ('Notes', $1, 'notes.pdf', 1) returning size_bytes",
      [mine])).rows[0];
  });
  ok("the stored size comes from Storage, not the client", Number(res.size_bytes) === 1234, res.size_bytes);
  const peek = await as(db, maya, async (tx) => ({
    rows: (await tx.query("select id from resources")).rows.length,
    objects: (await tx.query("select id from storage.objects where bucket_id = 'student-resources'")).rows.length,
  }));
  ok("a private archive file is invisible to others", peek.rows === 0 && peek.objects === 0, JSON.stringify(peek));
  const intoMine = await attempt(db, maya, (tx) => upload(tx, `u/${alex}/planted`, maya, 1));
  ok("nobody can upload into someone else's archive", !intoMine.ok);
  const wrongScope = await attempt(db, alex, async (tx) => {
    await upload(tx, `u/${alex}/scoped`, alex, 1);
    await tx.query(
      "insert into resources (title, object_path, file_name, size_bytes, conversation_id) values ('x', $1, 'x', 1, gen_random_uuid())",
      [`u/${alex}/scoped`]);
  });
  ok("a file's path must match who it is shared with", !wrongScope.ok);

  const circle = await startGroup(db, alex, [maya]);
  const shared = `c/${circle}/sheet`;
  await as(db, alex, async (tx) => {
    await upload(tx, shared, alex, 99);
    await tx.query(
      "insert into resources (title, object_path, file_name, size_bytes, conversation_id) values ('Sheet', $1, 'sheet.pdf', 99, $2)",
      [shared, circle]);
  });
  const member = await as(db, maya, async (tx) => ({
    rows: (await tx.query("select id from resources where conversation_id = $1", [circle])).rows.length,
    objects: (await tx.query("select id from storage.objects where name = $1", [shared])).rows.length,
  }));
  ok("circle members can read what was shared into the circle", member.rows === 1 && member.objects === 1, JSON.stringify(member));
  const outsider = await as(db, sam, async (tx) => ({
    rows: (await tx.query("select id from resources")).rows.length,
    objects: (await tx.query("select id from storage.objects where name = $1", [shared])).rows.length,
  }));
  ok("people outside the circle cannot", outsider.rows === 0 && outsider.objects === 0, JSON.stringify(outsider));
  // A host takes a file down: the listing goes, and so does every member's
  // access to the bytes -- not just the row.
  const hostile = `c/${circle}/hostile`;
  await as(db, maya, async (tx) => {
    await upload(tx, hostile, maya, 10);
    await tx.query("insert into resources (title, object_path, file_name, size_bytes, conversation_id) values ('bad', $1, 'bad.png', 10, $2)", [hostile, circle]);
  });
  // Bytes first, then the listing: once the listing is gone, the host can
  // no longer see the object (reads are gated on it), so can't delete it.
  const takedown = await attempt(db, alex, async (tx) => {
    const n = (await tx.query("delete from storage.objects where name = $1", [hostile])).affectedRows;
    await tx.query("delete from resources where object_path = $1", [hostile]);
    return n;
  });
  ok("a host can take a shared file down, bytes included", takedown.ok && takedown.value === 1, takedown.error || takedown.value);
  // And if only the listing goes (an older client), members still lose access.
  await as(db, alex, (tx) => tx.query("delete from resources where object_path = $1", [hostile]));
  const stillVisible = await db.query("select count(*)::int as n from storage.objects where name = $1", [hostile]);
  const memberSees = await as(db, alex, async (tx) => (await tx.query("select id from storage.objects where name = $1", [hostile])).rows.length);
  ok("an unlisted shared file is unreadable to members", stillVisible.rows[0].n === 1 && memberSees === 0, `exists=${stillVisible.rows[0].n} seen=${memberSees}`);
  const uploaderSees = await as(db, maya, async (tx) => (await tx.query("select id from storage.objects where name = $1", [hostile])).rows.length);
  ok("its uploader can still reach their own bytes", uploaderSees === 1);

  const sneak = await attempt(db, sam, (tx) => upload(tx, `c/${circle}/x`, sam, 1));
  ok("outsiders cannot upload into a circle", !sneak.ok);
  const badPath = await attempt(db, sam, (tx) => upload(tx, "c/not-a-uuid/x", sam, 1));
  ok("a malformed path is refused, not an error", !badPath.ok && !/invalid input syntax/.test(badPath.error || ""), badPath.error);

  const full = await attempt(db, maya, async (tx) => {
    for (let i = 0; i < 5; i++) {
      const p = `u/${maya}/big${i}`;
      await upload(tx, p, maya, 50 * 1024 * 1024);
      await tx.query("insert into resources (title, object_path, file_name, size_bytes) values ('b', $1, 'b', 1)", [p]);
    }
  });
  ok("each archive is capped at 200 MB", !full.ok && /archive is full|row-level security/.test(full.error || ""), full.error);

  // -- phase 17: the bucket itself enforces the quota, with or without rows
  const rowless = await attempt(db, sam, async (tx) => {
    for (let i = 0; i < 5; i++) await upload(tx, `u/${sam}/raw${i}`, sam, 50 * 1024 * 1024);
  });
  ok("uploading without creating rows still hits the quota", !rowless.ok && /row-level security/.test(rowless.error || ""), rowless.error);

  // Leaving a circle doesn't lock you out of your own file.
  const leaver = await createUser(db, "s_leaver");
  const circle2 = await startGroup(db, alex, [leaver]);
  const mine2 = `c/${circle2}/mine`;
  await as(db, leaver, async (tx) => {
    await upload(tx, mine2, leaver, 5);
    await tx.query("insert into resources (title, object_path, file_name, size_bytes, conversation_id) values ('m', $1, 'm.pdf', 5, $2)", [mine2, circle2]);
    await tx.query("delete from conversation_participants where conversation_id = $1 and user_id = $2", [circle2, leaver]);
  });
  const keeps = await as(db, leaver, async (tx) => (await tx.query("select id from storage.objects where name = $1", [mine2])).rows.length);
  ok("after leaving a circle you can still download what you shared", keeps === 1);

  // -- blocking
  const dm = await startDirect(db, alex, maya);
  await as(db, alex, (tx) => tx.query("insert into messages (conversation_id, content) values ($1, 'hi')", [dm]));
  await as(db, maya, (tx) => tx.query("insert into blocks (blocked_id) values ($1)", [alex]));
  const mayaSees = await as(db, maya, async (tx) => (await tx.query("select id from messages where conversation_id = $1", [dm])).rows.length);
  const alexSees = await as(db, alex, async (tx) => (await tx.query("select id from messages where conversation_id = $1", [dm])).rows.length);
  ok("a blocked person's messages are hidden from the blocker", mayaSees === 0, `saw ${mayaSees}`);
  ok("the blocked person still sees their own messages", alexSees === 1, `saw ${alexSees}`);
  const readd = await attempt(db, alex, async (tx) => {
    const id = (await tx.query("insert into conversations (type, name) values ('group', 'again') returning id")).rows[0].id;
    await tx.query("insert into conversation_participants (conversation_id, user_id) values ($1, $2), ($1, $3)", [id, alex, maya]);
  });
  ok("someone you blocked cannot add you to a chat", !readd.ok && /can't be added/.test(readd.error || ""), readd.error);
  const blockList = await as(db, alex, async (tx) => (await tx.query("select * from blocks")).rows.length);
  ok("you cannot see who has blocked you", blockList === 0);

  // -- reports
  const rep = await attempt(db, maya, (tx) => tx.query(
    "insert into reports (reported_user_id, conversation_id, reason, evidence) values ($1, $2, 'harassment', 'hi')", [alex, dm]));
  ok("a member can report someone in their chat", rep.ok, rep.error);
  const closed = await attempt(db, maya, (tx) => tx.query(
    "insert into reports (reason, status) values ('spam', 'closed')"));
  ok("a report cannot be filed already closed", !closed.ok);
  const stranger = await attempt(db, sam, (tx) => tx.query(
    "insert into reports (reason, conversation_id) values ('spam', $1)", [dm]));
  ok("you cannot file reports about chats you are not in", !stranger.ok);

  // -- rooms
  const ends = iso(now + 3 * 3600000);
  const room = await as(db, alex, async (tx) => {
    const id = (await tx.query(
      "insert into conversations (type, name, kind, ends_at, posting) values ('group', 'Hackathon', 'event', $1, 'hosts') returning id",
      [ends])).rows[0].id;
    await tx.query("insert into conversation_participants (conversation_id, user_id) values ($1, $2)", [id, alex]);
    await tx.query("insert into room_codes (conversation_id, code) values ($1, 'HACK2345')", [id]);
    return id;
  });
  const longRoom = await attempt(db, alex, (tx) => tx.query(
    "insert into conversations (type, name, ends_at) values ('group', 'forever', now() + interval '400 days')"));
  ok("a temporary room cannot last more than 60 days", !longRoom.ok);
  const dmEnds = await attempt(db, alex, (tx) => tx.query(
    "insert into conversations (type, name, ends_at) values ('direct', 'dm', now() + interval '1 day')"));
  ok("only groups can end", !dmEnds.ok);

  const codes = await as(db, sam, async (tx) => (await tx.query("select * from room_codes")).rows.length);
  ok("join codes are not listable", codes === 0);
  const bad = await as(db, sam, async (tx) => (await tx.query("select * from request_to_join('NOPE2345')")).rows[0]);
  ok("an unknown code reveals nothing", bad.status === "invalid" && bad.name === null, JSON.stringify(bad));
  const asked = await as(db, sam, async (tx) => (await tx.query("select * from request_to_join(' hack-2345 ')")).rows[0]);
  ok("a code lets you ask to join", asked.status === "pending" && asked.name === "Hackathon", JSON.stringify(asked));
  const early = await as(db, sam, async (tx) => (await tx.query("select id from messages where conversation_id = $1", [room])).rows.length
    + (await tx.query("select id from conversations where id = $1", [room])).rows.length);
  ok("asking is not being in", early === 0);
  const hostSees = await as(db, alex, async (tx) => (await tx.query("select username from room_requests where conversation_id = $1", [room])).rows);
  ok("the host sees who is waiting", hostSees.length === 1 && hostSees[0].username === "s_sam", JSON.stringify(hostSees));
  const othersSee = await as(db, maya, async (tx) => (await tx.query("select * from room_requests")).rows.length);
  ok("nobody else sees the waiting room", othersSee === 0);

  await as(db, alex, (tx) => tx.query("insert into conversation_participants (conversation_id, user_id) values ($1, $2)", [room, sam]));
  const left = await db.query("select count(*)::int as n from room_requests where conversation_id = $1", [room]);
  ok("letting someone in clears their request", left.rows[0].n === 0);
  const again = await as(db, sam, async (tx) => (await tx.query("select status from request_to_join('HACK2345')")).rows[0].status);
  ok("a member asking again is told they are in", again === "member", again);

  const pub = await db.query("select count(*)::int as n from pg_publication_tables where tablename = 'room_requests'");
  ok("the waiting room is not broadcast over realtime", pub.rows[0].n === 0);
  const guesses = await attempt(db, maya, async (tx) => {
    for (let i = 0; i < 31; i++) await tx.query("select * from request_to_join($1)", [`ZZZZ${String(2000 + i)}`]);
  });
  ok("guessing join codes is rate-limited", !guesses.ok && /Too many join attempts/.test(guesses.error || ""), guesses.error);
  const hushDm = await attempt(db, alex, (tx) => tx.query("update conversations set posting = 'hosts' where id = $1", [dm]));
  ok("a 1:1 chat cannot be made hosts-only", !hushDm.ok);

  const memberPost = await attempt(db, sam, (tx) => tx.query("insert into messages (conversation_id, content) values ($1, 'hi all')", [room]));
  ok("in a hosts-only room members cannot post", !memberPost.ok);
  const keyAsk = await attempt(db, sam, (tx) => tx.query("insert into messages (conversation_id, content) values ($1, '[[keyrequest]]')", [room]));
  ok("but can still ask for the room's key", keyAsk.ok, keyAsk.error);
  const hostPost = await attempt(db, alex, (tx) => tx.query("insert into messages (conversation_id, content) values ($1, 'Welcome!')", [room]));
  ok("hosts can post", hostPost.ok, hostPost.error);

  await as(db, alex, (tx) => tx.query("insert into messages (conversation_id, content) values ($1, 'Welcome!')", [room]));
  await db.query("update conversations set ends_at = now() - interval '1 minute' where id = $1", [room]);
  const after = await as(db, alex, async (tx) => ({
    conv: (await tx.query("select id from conversations where id = $1", [room])).rows.length,
    msgs: (await tx.query("select id from messages where conversation_id = $1", [room])).rows.length,
  }));
  ok("an ended room is hidden from its members", after.conv === 0 && after.msgs === 0, JSON.stringify(after));
  const late = await attempt(db, alex, (tx) => tx.query("insert into messages (conversation_id, content) values ($1, 'late')", [room]));
  ok("nobody can post into an ended room", !late.ok);
  const lateJoin = await as(db, maya, async (tx) => (await tx.query("select status from request_to_join('HACK2345')")).rows[0].status);
  ok("an ended room's code stops working", lateJoin === "invalid", lateJoin);
  await db.query("update conversations set ends_at = now() - interval '2 days' where id = $1", [room]);
  await db.query("select private.purge_ended_rooms()");
  const gone = await db.query("select count(*)::int as n from conversations where id = $1", [room]);
  ok("ended rooms are deleted a day later", gone.rows[0].n === 0);

  // -- phase 18: archive rows on R2 are keyed by their uploader
  const r2Own = await attempt(db, alex, (tx) =>
    tx.query("insert into resources (title, object_path, file_name, size_bytes) values ('R2', $1, 'r2.pdf', 4096) returning size_bytes", [`o/${alex}/u/${crypto.randomUUID()}`]));
  ok("an archive row may point at the uploader's own R2 file", r2Own.ok && r2Own.value.rows[0].size_bytes === 4096, r2Own.error);
  const r2Theirs = await attempt(db, alex, (tx) =>
    tx.query("insert into resources (title, object_path, file_name, size_bytes) values ('R2', $1, 'r2.pdf', 1)", [`o/${maya}/u/${crypto.randomUUID()}`]));
  ok("but never at someone else's", !r2Theirs.ok);
  const r2Shared = await attempt(db, alex, (tx) =>
    tx.query("insert into resources (title, object_path, file_name, size_bytes, conversation_id) values ('R2 shared', $1, 's.pdf', 10, $2)", [`o/${alex}/c/${circle}/${crypto.randomUUID()}`, circle]));
  ok("an R2 file can be shared into a circle the uploader is in", r2Shared.ok, r2Shared.error);
  const r2Big = await attempt(db, alex, (tx) =>
    tx.query("insert into resources (title, object_path, file_name, size_bytes) values ('huge', $1, 'h.bin', 60000000)", [`o/${alex}/u/${crypto.randomUUID()}`]));
  ok("R2 rows keep the 50 MB cap", !r2Big.ok);

  // -- phase 18: listing your own Storage files, for deletion
  const listed = await as(db, alex, async (tx) => (await tx.query("select bucket, name from public.my_storage_objects()")).rows);
  const othersListed = await as(db, maya, async (tx) => (await tx.query("select name from public.my_storage_objects() where name like $1", [`u/${alex}/%`])).rows.length);
  ok("my_storage_objects lists my files and only mine", listed.length > 0 && listed.every((r) => r.bucket && r.name) && othersListed === 0, JSON.stringify({ n: listed.length, othersListed }));

  // -- deleting an account with all of the above
  const solo = await startGroup(db, alex, []);
  const del = await attempt(db, alex, async (tx) => {
    await tx.query("select public.delete_my_account()");
    await tx.exec("reset role");
    return (await tx.query(
      `select (select count(*)::int from conversations where id = $1) as solo,
              (select count(*)::int from conversations where id = $2) as circle,
              (select count(*)::int from resources where owner_id = $3) as files,
              (select count(*)::int from messages where user_id = $3) as msgs,
              (select count(*)::int from profiles where id = $3) as profile`,
      [solo, circle, alex])).rows[0];
  });
  ok("delete_my_account works for someone with study data, files and rooms", del.ok, del.error);
  const L = del.value || {};
  ok("deleting an account removes conversations only they were in, and everything of theirs", L.solo === 0 && L.files === 0 && L.msgs === 0 && L.profile === 0, JSON.stringify(L));
  ok("but keeps conversations other people are still in", L.circle === 1, JSON.stringify(L));
}

// ---- moderation (phase 20) -------------------------------------------------

async function moderationTests() {
  const db = await freshDb();
  const mod = await createUser(db, "m_mod");
  const bad = await createUser(db, "m_bad");
  const kind = await createUser(db, "m_kind");
  const conv = await startGroup(db, kind, [bad]);
  const msg = await as(db, bad, async (tx) =>
    (await tx.query("insert into messages (conversation_id, content) values ($1, 'mean words') returning id", [conv])).rows[0].id);
  const report = await as(db, kind, async (tx) =>
    (await tx.query("insert into reports (reported_user_id, conversation_id, message_id, reason, evidence) values ($1, $2, $3, 'harassment', 'mean words') returning id",
      [bad, conv, msg])).rows[0].id);

  const status = await attempt(db, kind, async (tx) => (await tx.query("select * from moderation_status()")).rows[0]);
  ok("an ordinary account is not a moderator, and nothing can be claimed yet", status.ok && !status.value.is_moderator && !status.value.passphrase_set, status.error);
  const peek = await attempt(db, kind, (tx) => tx.query("select * from moderation_reports()"));
  ok("non-moderators can't read reports", !peek.ok && /moderator/.test(peek.error));
  const direct = await attempt(db, kind, (tx) => tx.query("select * from private.moderators"));
  ok("the moderator list isn't readable from the API", !direct.ok);
  const early = await attempt(db, kind, async (tx) => (await tx.query("select moderation_claim('anything at all') as ok")).rows[0].ok);
  ok("without a passphrase set, claiming fails", early.ok && early.value === false, early.error);

  await db.query("insert into private.moderators (user_id) values ($1)", [mod]);
  const list = await attempt(db, mod, async (tx) => (await tx.query("select * from moderation_reports()")).rows);
  const row = list.value?.[0] || {};
  ok("a moderator sees the report with names and context", list.ok && row.id === report && row.reporter_username === "m_kind" && row.reported_username === "m_bad" && row.message_exists === true, list.error);

  await as(db, mod, (tx) => tx.query("select moderation_set_status($1, 'reviewing', 'looking into it')", [report]));
  const set = (await db.query("select status, moderator_note, handled_at from reports where id = $1", [report])).rows[0];
  ok("a moderator can change a report's status with a note", set.status === "reviewing" && set.moderator_note === "looking into it" && set.handled_at);

  await as(db, mod, (tx) => tx.query("select moderation_delete_message($1, $2)", [msg, report]));
  ok("a moderator can remove a reported message", (await db.query("select count(*)::int as n from messages where id = $1", [msg])).rows[0].n === 0);

  await db.query("insert into auth.sessions (user_id) values ($1)", [bad]);
  await as(db, mod, (tx) => tx.query("select moderation_suspend($1, 7, $2, 'harassment')", [bad, report]));
  const sus = (await db.query("select (select banned_until from auth.users where id = $1) > now() + interval '6 days' as banned, (select count(*)::int from auth.sessions where user_id = $1) as sessions", [bad])).rows[0];
  ok("suspending sets a ban and signs them out everywhere", sus.banned && sus.sessions === 0, JSON.stringify(sus));
  const self = await attempt(db, mod, (tx) => tx.query("select moderation_suspend($1, 1)", [mod]));
  ok("a moderator can't suspend themself", !self.ok);
  const notMod = await attempt(db, kind, (tx) => tx.query("select moderation_suspend($1, 1)", [bad]));
  ok("only moderators can suspend", !notMod.ok);

  const shortPass = await attempt(db, mod, (tx) => tx.query("select moderation_set_passphrase('short')"));
  ok("a short passphrase is refused", !shortPass.ok);
  await as(db, mod, (tx) => tx.query("select moderation_set_passphrase('orbit lantern quiet harbour')"));
  const stored = (await db.query("select hash from private.moderator_passphrase")).rows[0]?.hash || "";
  ok("the passphrase is stored only as a bcrypt hash", stored.startsWith("$2") && !stored.includes("orbit"));

  // The moderator's account is deleted: the role goes with it...
  await as(db, mod, (tx) => tx.query("select delete_my_account()"));
  ok("deleting the moderator's account removes the role", (await db.query("select count(*)::int as n from private.moderators")).rows[0].n === 0);
  // ...and a new account takes it back with the passphrase.
  const fresh = await createUser(db, "m_fresh");
  const wrong = await as(db, fresh, async (tx) => (await tx.query("select moderation_claim('not the passphrase') as ok")).rows[0].ok);
  ok("a wrong passphrase claims nothing", wrong === false);
  const right = await as(db, fresh, async (tx) => (await tx.query("select moderation_claim('orbit lantern quiet harbour') as ok")).rows[0].ok);
  const now = await as(db, fresh, async (tx) => (await tx.query("select * from moderation_status()")).rows[0]);
  ok("the right passphrase makes the new account a moderator", right === true && now.is_moderator === true);
  const hist = await as(db, fresh, async (tx) => (await tx.query("select action from moderation_history()")).rows.map((r) => r.action));
  ok("every moderator action is in the history", ["claimed-role", "set-passphrase", "suspend", "delete-message", "status:reviewing"].every((a) => hist.includes(a)), hist.join(","));

  const guesser = await createUser(db, "m_guess");
  for (let i = 0; i < 5; i++) await as(db, guesser, (tx) => tx.query("select moderation_claim('guess " + i + "')"));
  const sixth = await attempt(db, guesser, (tx) => tx.query("select moderation_claim('orbit lantern quiet harbour')"));
  ok("guessing is limited to 5 an hour", !sixth.ok && /Too many/.test(sixth.error));
}

// ---- settings that follow you (phase 21) -----------------------------------

async function deviceStateTests() {
  const db = await freshDb();
  const a = await createUser(db, "d_a");
  const b = await createUser(db, "d_b");
  for (const u of [a, b]) await as(db, u, (tx) => tx.query("insert into student_profiles (world_name) values ('W')"));
  const put = (u, section, v, at) => as(db, u, async (tx) => (await tx.query("select merge_device_state($1, $2::jsonb, $3) as s", [section, JSON.stringify(v), at])).rows[0].s);
  await put(a, "prefs", { studyPreset: "50" }, 2000);
  await put(a, "light", { mode: "night" }, 2000);
  const older = await put(a, "prefs", { studyPreset: "25" }, 1000);
  const st = (await db.query("select device_state from student_profiles where user_id = $1", [a])).rows[0].device_state;
  ok("a newer setting is kept; an older write from another tab is ignored", st.prefs.v.studyPreset === "50" && st.light.v.mode === "night" && older === null, JSON.stringify(st));
  await put(a, "timer", null, 3000);
  const t = (await db.query("select device_state -> 'timer' as t from student_profiles where user_id = $1", [a])).rows[0].t;
  ok("a stopped timer is recorded as stopped", t && t.v === null && Number(t.at) === 3000, JSON.stringify(t));
  const bogus = await attempt(db, a, async (tx) => (await tx.query("select merge_device_state('anything', '1'::jsonb, 5000) as s")).rows[0].s);
  ok("only the known sections can be written", bogus.ok && bogus.value === null, bogus.error);
  const theirs = (await db.query("select device_state from student_profiles where user_id = $1", [b])).rows[0].device_state;
  ok("nobody writes anyone else's settings", Object.keys(theirs).length === 0);
  const big = await attempt(db, a, (tx) => tx.query("select merge_device_state('prefs', $1::jsonb, 9000)", [JSON.stringify({ x: "y".repeat(40000) })]));
  ok("settings stay small", !big.ok);

  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const row = [iso(now - 26 * 60000), iso(now)];
  await as(db, a, (tx) => tx.query("insert into focus_sessions (started_at, ended_at, planned_minutes, focused_minutes) values ($1, $2, 25, 25)", row));
  const twice = await attempt(db, a, (tx) => tx.query("insert into focus_sessions (started_at, ended_at, planned_minutes, focused_minutes) values ($1, $2, 25, 25)", row));
  ok("the same focus block can't be recorded twice (two devices)", !twice.ok && /duplicate|unique/i.test(twice.error));
}

// ---- age and a parent's consent (phase 22) ---------------------------------

// As `as`, with the email and sign-in method a real Supabase token carries.
async function asWith(db, userId, claims, fn) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated", ...claims })]);
    await tx.exec("set local role authenticated");
    return fn(tx);
  });
}
async function attemptWith(db, userId, claims, fn) {
  try {
    const value = await asWith(db, userId, claims, async (tx) => {
      const v = await fn(tx);
      throw Object.assign(new Error("__rollback__"), { v });
    });
    return { ok: true, value };
  } catch (e) {
    return e.message === "__rollback__" ? { ok: true, value: e.v } : { ok: false, error: e.message };
  }
}

async function consentTests() {
  const db = await freshDb();
  const year = new Date().getFullYear();
  const adult = await createUser(db, "c_adult");
  const teen = await createUser(db, "c_teen");
  const kid = await createUser(db, "c_kid");
  const mum = await createUser(db, "c_mum");
  const stranger = await createUser(db, "c_stranger");
  const birth = (u, y, m = 1) => as(db, u, async (tx) => (await tx.query("select set_my_birth($1, $2) as r", [y, m])).rows[0].r);
  const task = (u) => attempt(db, u, (tx) => tx.query("insert into student_tasks (title) values ('x')"));

  ok("an adult's date of birth needs nothing more", (await birth(adult, year - 30)) === "adult");
  ok("adults can use Panalo", (await task(adult)).ok);
  const again = await attempt(db, adult, (tx) => tx.query("select set_my_birth($1, 1)", [year - 15]));
  ok("a date of birth can't be changed by its owner (no becoming 18 by editing)", !again.ok);
  ok("13 to 17 needs a parent", (await birth(teen, year - 15)) === "needs_consent");
  ok("under 13 isn't allowed", (await birth(kid, year - 11)) === "under13");

  ok("nothing is stored for a student without a parent's consent", !(await task(teen)).ok);
  const conv = await startGroup(db, adult, [stranger]);
  const added = await attempt(db, adult, (tx) => tx.query("insert into conversation_participants (conversation_id, user_id) values ($1, $2)", [conv, teen]));
  ok("they can't be added to conversations either", !added.ok);
  const rep = await attempt(db, teen, (tx) => tx.query("insert into reports (reason) values ('safety')"));
  ok("but they can still report (safety first)", rep.ok, rep.error);
  ok("the under-13 can't use it at all", !(await task(kid)).ok);

  const ownMail = await attempt(db, teen, (tx) => tx.query("select request_parent_consent('c_teen@example.test')"));
  ok("a student can't name themselves as the parent", !ownMail.ok);
  await as(db, teen, (tx) => tx.query("select request_parent_consent('C_Mum@Example.test')"));
  const status = await as(db, teen, async (tx) => (await tx.query("select * from my_age_status()")).rows[0]);
  ok("the student sees they're waiting, with the parent named", status.minor && status.consent === "pending" && status.parent_email === "c_mum@example.test", JSON.stringify(status));

  const now = Math.floor(Date.now() / 1000);
  const byCode = { email: "c_mum@example.test", amr: [{ method: "otp", timestamp: now }] };
  const byPassword = { email: "c_mum@example.test", amr: [{ method: "password", timestamp: now }] };
  const seen = await asWith(db, mum, byCode, async (tx) => (await tx.query("select * from my_children_requests()")).rows);
  ok("the parent sees the request", seen.length === 1 && seen[0].child_username === "c_teen" && seen[0].verified === true, JSON.stringify(seen));
  const pw = await attemptWith(db, mum, byPassword, (tx) => tx.query("select decide_parent_consent($1, true, 'Asha Rao', 'parent', $2)", [teen, year - 45]));
  ok("deciding needs a fresh sign-in by emailed code, not just a password", !pw.ok);
  const strangerTry = await attemptWith(db, stranger, { email: "c_stranger@example.test", amr: byCode.amr }, (tx) => tx.query("select decide_parent_consent($1, true, 'X Y', 'parent', $2)", [teen, year - 40]));
  ok("nobody else can decide", !strangerTry.ok);
  const young = await attemptWith(db, mum, byCode, (tx) => tx.query("select decide_parent_consent($1, true, 'Asha Rao', 'parent', $2)", [teen, year - 16]));
  ok("the parent must be 18 or over", !young.ok);
  const noName = await attemptWith(db, mum, byCode, (tx) => tx.query("select decide_parent_consent($1, true, ' ', 'parent', $2)", [teen, year - 45]));
  ok("the parent must give their name", !noName.ok);
  await asWith(db, mum, byCode, (tx) => tx.query("select decide_parent_consent($1, true, 'Asha Rao', 'parent', $2)", [teen, year - 45]));
  ok("with consent, the student can use Panalo", (await task(teen)).ok);
  const rec = (await db.query("select parent_name, relation, decision from private.parental_consents where child_id = $1", [teen])).rows[0];
  ok("the consent is recorded", rec && rec.parent_name === "Asha Rao" && rec.decision === "approved", JSON.stringify(rec));

  await asWith(db, mum, byCode, (tx) => tx.query("select withdraw_parent_consent($1)", [teen]));
  const gone = (await db.query("select (select count(*)::int from auth.users where id = $1) as u, (select count(*)::int from private.deleted_registrations where user_id = $1) as r", [teen])).rows[0];
  ok("withdrawing consent deletes the student's account, keeping only registration details", gone.u === 0 && gone.r === 1, JSON.stringify(gone));

  await as(db, adult, (tx) => tx.query("select delete_my_account()"));
  const kept = (await db.query("select email, username from private.deleted_registrations where user_id = $1", [adult])).rows[0];
  ok("deleting an account keeps email and username for 180 days", kept && kept.username === "c_adult" && kept.email === "c_adult@example.test", JSON.stringify(kept));
  await db.query("update private.deleted_registrations set deleted_at = now() - interval '181 days' where user_id = $1", [adult]);
  const purged = (await db.query("select private.purge_deleted_registrations() as n")).rows[0].n;
  ok("and erases them after 180 days", purged === 1 && (await db.query("select count(*)::int as n from private.deleted_registrations where user_id = $1", [adult])).rows[0].n === 0);
  const peek = await attempt(db, mum, (tx) => tx.query("select * from private.deleted_registrations"));
  ok("kept registration details aren't readable from the API", !peek.ok);
}

// Phase 23: security logs copied in by the GitHub Action, kept 180 days.
async function logTests() {
  const db = await freshDb();
  const u = await createUser(db, "l_user");
  const now = Date.now();
  const batch = [
    { id: "a1", timestamp: now * 1000, event_message: "POST | 200 | 203.0.113.9 | /rest/v1/messages" },
    { id: "a2", timestamp: new Date(now - 1000).toISOString(), event_message: "GET | 401 | 203.0.113.9 | /auth/v1/user" },
    { timestamp: now * 1000, event_message: "no id: skipped" },
    // The current log API: text in UTC without a zone, and its own source.
    { id: "a3", timestamp: "2026-10-05T10:31:24.940000", source: "auth_logs", event_message: "login" },
  ];
  const n1 = (await db.query("select private.store_logs($1::jsonb, 'edge_logs') as n", [JSON.stringify(batch)])).rows[0].n;
  ok("a batch of logs is stored", n1 === 3, String(n1));
  const a3 = (await db.query("select source, at = '2026-10-05 10:31:24.94+00'::timestamptz as utc from private.access_logs where id = 'a3'")).rows[0];
  ok("a row keeps its own source, and a zoneless time is read as UTC", a3 && a3.source === "auth_logs" && a3.utc, JSON.stringify(a3));
  const n2 = (await db.query("select private.store_logs($1::jsonb, 'edge_logs') as n", [JSON.stringify(batch)])).rows[0].n;
  ok("copying the same logs again adds nothing", n2 === 0, String(n2));
  const at = (await db.query("select abs(extract(epoch from at) * 1000 - $1) < 5 as close from private.access_logs where id = 'a1'", [now])).rows[0];
  ok("microsecond timestamps are read correctly", at && at.close);
  await db.query("update private.access_logs set at = now() - interval '181 days' where id = 'a2'");
  const purged = (await db.query("select private.purge_access_logs() as n")).rows[0].n;
  ok("logs older than 180 days are erased", purged === 1 && (await db.query("select count(*)::int as n from private.access_logs")).rows[0].n === 2);
  const peek = await attempt(db, u, (tx) => tx.query("select * from private.access_logs"));
  ok("logs aren't readable from the API", !peek.ok);
  const write = await attempt(db, u, (tx) => tx.query("select private.store_logs('[]'::jsonb, 'edge_logs')"));
  ok("nobody signed in can add logs", !write.ok);
}

// Phase 24: one entry per person per day, private.
async function dailyTests() {
  const db = await freshDb();
  const year = new Date().getFullYear();
  const me = await createUser(db, "d_me");
  const other = await createUser(db, "d_other");
  const teen = await createUser(db, "d_teen");
  await as(db, teen, (tx) => tx.query("select set_my_birth($1, 1)", [year - 15]));
  const up = (u, sql, args = []) => attempt(db, u, (tx) => tx.query(sql, args));

  await as(db, me, (tx) => tx.query("insert into daily_entries (day, opened_at, intention) values (current_date, now(), 'Finish the essay')"));
  const closed = await as(db, me, async (tx) =>
    (await tx.query("insert into daily_entries (day, mood, energy, learned, intention_done, closed_at) values (current_date, 4, 3, 'Mitochondria', 'yes', now()) on conflict (user_id, day) do update set mood = excluded.mood, energy = excluded.energy, learned = excluded.learned, intention_done = excluded.intention_done, closed_at = excluded.closed_at returning intention, mood, closed_at is not null as closed")).rows[0]
  );
  ok("closing the day updates the morning's entry, keeping the intention", closed.intention === "Finish the essay" && closed.mood === 4 && closed.closed, JSON.stringify(closed));
  const count = await as(db, me, async (tx) => (await tx.query("select count(*)::int as n from daily_entries")).rows[0].n);
  ok("one entry per day", count === 1, String(count));
  const peek = await as(db, other, async (tx) => (await tx.query("select count(*)::int as n from daily_entries")).rows[0].n);
  ok("nobody else can read your days", peek === 0);
  const forge = await up(other, "insert into daily_entries (user_id, day) values ($1, current_date - 1)", [me]);
  ok("nobody can write a day for you", !forge.ok);
  ok("mood is 1 to 5", !(await up(me, "insert into daily_entries (day, mood) values (current_date - 1, 6)")).ok);
  ok("intention outcome is yes, partly or no", !(await up(me, "insert into daily_entries (day, intention_done) values (current_date - 1, 'maybe')")).ok);
  ok("no entries far in the future", !(await up(me, "insert into daily_entries (day) values (current_date + 30)")).ok);
  ok("a student waiting for a parent can't keep a journal yet", !(await up(teen, "insert into daily_entries (day) values (current_date)")).ok);
}

async function main() {
  const sections = [migrationTests, chatTests, takeoverTests, callTests, accountTests, backfillTests, historyTests, disappearTests, studentsTests, moderationTests, deviceStateTests, consentTests, logTests, dailyTests];
  for (const run of sections) {
    try {
      await run();
    } catch (e) {
      failures.push(`${run.name} crashed: ${e.message}`);
    }
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("Test run crashed:", e);
  process.exitCode = 1;
});
