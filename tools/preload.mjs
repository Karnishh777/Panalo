// Lists every module students/js/main.js loads up front (its static imports,
// all the way down) as <link rel="modulepreload"> in students/index.html, so
// the browser fetches them all at once instead of one level at a time.
// Modules loaded later with import() are left out on purpose.
//
//   node tools/preload.mjs           rewrite the list
//   node tools/preload.mjs --check   fail if the list is out of date
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = path.join(ROOT, "students/index.html");
const ENTRY = path.join(ROOT, "students/js/main.js");
const START = "<!-- modulepreload: tools/preload.mjs -->";
const END = "<!-- /modulepreload -->";

export function staticGraph(entry) {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s+"(\.{1,2}\/[^"]+)"|^\s*import\s+"(\.{1,2}\/[^"]+)"/gm)) {
      walk(path.resolve(path.dirname(file), m[1] || m[2]));
    }
  };
  walk(entry);
  seen.delete(entry);
  return [...seen];
}

export function block() {
  const dir = path.dirname(PAGE);
  const links = staticGraph(ENTRY)
    .map((f) => path.relative(dir, f).split(path.sep).join("/"))
    .sort()
    .map((href) => `  <link rel="modulepreload" href="${href}">`);
  return [START, ...links, `  ${END}`].join("\n");
}

function render(html) {
  const a = html.indexOf(START);
  const b = html.indexOf(END);
  if (a < 0 || b < 0) throw new Error(`students/index.html needs ${START} … ${END}`);
  return html.slice(0, a) + block() + html.slice(b + END.length);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const html = fs.readFileSync(PAGE, "utf8");
  const next = render(html);
  if (process.argv.includes("--check")) {
    if (next !== html) {
      console.error("students/index.html's modulepreload list is out of date: run node tools/preload.mjs");
      process.exit(1);
    }
    console.log("modulepreload list is up to date");
  } else {
    fs.writeFileSync(PAGE, next);
    console.log("modulepreload list written");
  }
}
