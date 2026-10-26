// The modulepreload list in students/index.html matches main.js's imports.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const tool = fileURLToPath(new URL("../tools/preload.mjs", import.meta.url));
try {
  execFileSync(process.execPath, [tool, "--check"], { stdio: "pipe" });
  console.log("ok - students/index.html preloads every module main.js imports");
} catch (e) {
  console.error(String(e.stderr || e.message));
  process.exit(1);
}
