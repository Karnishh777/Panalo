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

  // The linter floor: exactly the two functions the app calls directly stay
  // callable by signed-in users. Anything else is a new exposed endpoint.
  const { rows: exposed } = await db.query(
    `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     order by 1`
  );
  ok("only delete_my_account and find_profile_by_username are callable SECURITY DEFINER functions",
     JSON.stringify(exposed.map((r) => r.proname)) === JSON.stringify(["delete_my_account", "find_profile_by_username"]),
     exposed.map((r) => r.proname).join(", "));

  const { rows: dupes } = await db.query(
    `select count(*)::int as n from pg_index i where i.indrelid = 'public.profiles'::regclass
     and i.indisunique and pg_get_indexdef(i.indexrelid) ilike '%lower(username%'`
  );
  ok("exactly one unique index on lower(username)", dupes[0].n === 1, `found ${dupes[0].n}`);
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

async function main() {
  const sections = [migrationTests, chatTests, takeoverTests, callTests, accountTests, backfillTests, historyTests, disappearTests];
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
