// The leaked-password check (src/password.js), with Have I Been Pwned stubbed.
import test from "node:test";
import assert from "node:assert/strict";
import { breachedPassword } from "../src/password.js";

async function sha1(text) {
  const d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

test("only the first five hash characters leave the device", async () => {
  const hash = await sha1("password123");
  let asked = null;
  globalThis.fetch = async (url, init) => {
    asked = { url, init };
    return new Response(`${hash.slice(5)}:24000\r\nAAAAA:0\r\n`);
  };
  assert.match(await breachedPassword("password123"), /data breach/);
  assert.equal(asked.url, `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
  assert.equal(asked.init.headers["Add-Padding"], "true");
});

test("a password not in the list, and padding rows with a zero count, pass", async () => {
  const hash = await sha1("a very long and unusual phrase 2026");
  globalThis.fetch = async () => new Response(`0000000000000000000000000000000000A:3\r\n${hash.slice(5)}:0\r\n`);
  assert.equal(await breachedPassword("a very long and unusual phrase 2026"), null);
});

test("a network problem never blocks anyone", async () => {
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  assert.equal(await breachedPassword("password123"), null);
  globalThis.fetch = async () => new Response("busy", { status: 503 });
  assert.equal(await breachedPassword("password123"), null);
});
