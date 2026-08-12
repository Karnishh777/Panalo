// Regenerates stickers/manifest.json by scanning the stickers/ folder.
//
// Static hosting can't list a directory, so the app reads this manifest
// instead. Run it whenever you add or remove sticker files:
//
//   node tools/build-stickers.mjs
//
// Subfolders become categories; loose files land in "Mine".
import { readdir, writeFile, stat } from "node:fs/promises";
import { join, extname, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const STICKERS_DIR = join(ROOT, "stickers");
const ALLOWED = new Set([".webp", ".png", ".gif", ".svg", ".jpg", ".jpeg"]);
const MAX_RECOMMENDED_BYTES = 150 * 1024;

// "good-morning.webp" → "Good morning"
function prettyName(file) {
  return basename(file, extname(file))
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

async function walk(dir, category, out, warnings) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, entry.name, out, warnings);
      continue;
    }
    const ext = extname(entry.name).toLowerCase();
    if (!ALLOWED.has(ext)) continue;

    const rel = relative(STICKERS_DIR, full).split(/[\\/]/).join("/");
    const { size } = await stat(full);
    if (size > MAX_RECOMMENDED_BYTES) {
      warnings.push(`${rel} is ${(size / 1024).toFixed(0)} KB — consider shrinking it (target <150 KB).`);
    }
    out.push({ file: rel, name: prettyName(entry.name), cat: category, bytes: size });
  }
}

const stickers = [];
const warnings = [];
await walk(STICKERS_DIR, "Mine", stickers, warnings);
stickers.sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));

await writeFile(
  join(STICKERS_DIR, "manifest.json"),
  JSON.stringify({ generated: new Date().toISOString(), stickers }, null, 2) + "\n"
);

const totalKb = stickers.reduce((n, s) => n + s.bytes, 0) / 1024;
const cats = [...new Set(stickers.map((s) => s.cat))];
console.log(`✅ ${stickers.length} sticker(s) across ${cats.length} categor(y/ies): ${cats.join(", ") || "—"}`);
console.log(`   total ${totalKb.toFixed(0)} KB · written to stickers/manifest.json`);
warnings.forEach((w) => console.warn(`⚠️  ${w}`));
if (!stickers.length) {
  console.log("   (drop images into stickers/<Category>/ and run this again — see stickers/README.md)");
}
