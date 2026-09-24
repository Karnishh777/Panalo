// Regenerate supabase-all.sql from the individual migration files.
//
//   node tools/build-supabase-all.mjs          write it
//   node tools/build-supabase-all.mjs --check  exit 1 if it is out of date
//
// The consolidated file is a concatenation, never an edit: that is the whole
// promise its header makes. It was assembled by hand once, and the next time
// a phase file changed it would silently have gone stale -- the same "the
// file says one thing, the database another" drift that has bitten this
// project before. The header is kept from the existing file; the sections
// are rebuilt from the sources, in the order tools/sqltest/harness.mjs
// replays them.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(REPO, "supabase-all.sql");
const RULE = "-- " + "#".repeat(76);

const SOURCES = [
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
  "supabase-phase15.sql",
];

async function build() {
  const current = await readFile(OUT, "utf8");
  const firstSection = current.indexOf(`${RULE}\n-- SOURCE FILE:`);
  if (firstSection === -1) throw new Error("supabase-all.sql has no SOURCE FILE sections to anchor on");
  const header = current.slice(0, firstSection);

  const sections = [];
  for (const file of SOURCES) {
    const body = (await readFile(join(REPO, file), "utf8")).replace(/\s+$/, "");
    sections.push(`${RULE}\n-- SOURCE FILE: ${file}\n${RULE}\n\n${body}\n`);
  }
  return { current, next: header + sections.join("\n\n") };
}

const { current, next } = await build();
if (process.argv.includes("--check")) {
  if (current !== next) {
    console.error("supabase-all.sql is out of date. Run: node tools/build-supabase-all.mjs");
    process.exitCode = 1;
  } else {
    console.log("supabase-all.sql is up to date.");
  }
} else {
  await writeFile(OUT, next);
  console.log(`Wrote supabase-all.sql from ${SOURCES.length} files.`);
}
