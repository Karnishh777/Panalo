// erase-files — removes the uploaded files of erased accounts (phase 40).
//
// Storage won't let SQL delete files, so erasing an account (deleting it,
// or a parent withdrawing consent) queues the person's files in
// private.file_erasure, and this function removes them through the
// Storage API with the service role, which Supabase gives every Edge
// Function. It only ever removes files already queued, so calling it is
// harmless: the app calls it after an erasure, and a daily schedule
// (supabase-phase40.sql) catches anything missed.
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async () => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let removed = 0;
  let failed = 0;
  for (let round = 0; round < 10; round++) {
    const { data, error } = await sb.rpc("file_erasure_next", { p_limit: 200 });
    if (error) return Response.json({ error: "queue" }, { status: 500 });
    if (!data?.length) break;
    const byBucket = new Map<string, { id: number; name: string }[]>();
    for (const f of data) {
      if (!byBucket.has(f.bucket)) byBucket.set(f.bucket, []);
      byBucket.get(f.bucket)!.push({ id: f.id, name: f.name });
    }
    const done: number[] = [];
    for (const [bucket, files] of byBucket) {
      const { error: e } = await sb.storage.from(bucket).remove(files.map((f) => f.name));
      if (e) failed += files.length;
      else done.push(...files.map((f) => f.id));
    }
    if (done.length) {
      await sb.rpc("file_erasure_done", { p_ids: done });
      removed += done.length;
    }
    if (!done.length) break; // nothing could be removed: try again next time
  }
  return Response.json({ removed, failed });
});
