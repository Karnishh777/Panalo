// Replay PANALO's hand-run migrations against a real Postgres (PGlite, in
// process) and act as signed-in users against the result.
//
// Why this exists: every migration so far was verified by pasting it into the
// production SQL Editor and reading the output. Two of them broke production
// that way -- phase 7 was never run, and supabase-all.sql cannot be re-run
// once phase 13 has been. Neither needed production to be found; both needed
// a database. This is that database.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..", "..");

// The order SETUP.md tells people to run them in.
export const MIGRATIONS = [
  "supabase-setup.sql",
  "supabase-keys.sql",
  "supabase-phase5.sql",
  "supabase-phase6.sql",
  "supabase-phase7.sql",
  "supabase-phase8.sql",
  "supabase-phase9.sql",
  "supabase-phase10.sql",
  "supabase-phase11.sql",
  "supabase-phase12.sql",
  "supabase-phase13.sql",
  "supabase-phase14.sql",
];

export async function createDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(await readFile(join(HERE, "supabase-stub.sql"), "utf8"));
  return db;
}

// Run one file exactly as the SQL Editor does: the whole text in a single
// transaction, so one failing statement rolls back everything before it.
export async function runFile(db, file) {
  const sql = await readFile(join(REPO, file), "utf8");
  try {
    await db.transaction(async (tx) => {
      await tx.exec(sql);
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function replay(db, files = MIGRATIONS) {
  for (const f of files) {
    const r = await runFile(db, f);
    if (!r.ok) return { ok: false, file: f, error: r.error };
  }
  return { ok: true };
}

// A signed-in account with keys, the way the app leaves one after first login.
export async function createUser(db, username) {
  const { rows } = await db.query(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [`${username}@example.test`, JSON.stringify({ username })]
  );
  const id = rows[0].id;
  // A signup trigger may already have made the profile; only fill the gaps.
  await db.query(
    `insert into public.profiles (id, username, public_key) values ($1, $2, $3)
     on conflict (id) do update set public_key = excluded.public_key`,
    [id, username, `pk-${username}`]
  );
  return id;
}

// Run `fn` as `userId` through the same door the app uses: role
// `authenticated`, with the JWT claims PostgREST would set. RLS and triggers
// therefore behave exactly as they do for a real client. Commits on success,
// rolls back if `fn` throws.
export async function as(db, userId, fn) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await tx.exec("set local role authenticated");
    return fn(tx);
  });
}

// Like `as`, but reports the outcome instead of throwing, for asserting on
// refusals. Always rolls back, so a probe never leaves data behind.
export async function attempt(db, userId, fn) {
  const ROLLBACK = "__rollback__";
  let result;
  try {
    await as(db, userId, async (tx) => {
      result = { ok: true, value: await fn(tx) };
      throw new Error(ROLLBACK);
    });
  } catch (e) {
    if (e.message !== ROLLBACK) result = { ok: false, error: e.message };
  }
  return result;
}
