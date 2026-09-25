// Browser QA harness: serves the repo as static files and drives it in
// Chromium with the in-memory Supabase mock (tools/qa/supabase-mock.js)
// standing in for the real project.
//
// The mock is injected by intercepting the supabase-js CDN request -- the
// app itself is unchanged and never references the mock. Every request to a
// real *.supabase.co host is aborted, so a QA run cannot touch production.
//
//   import { launch } from "./tools/qa/harness.mjs";
//   const qa = await launch();
//   const page = await qa.open({ viewport: "mobile", colorScheme: "dark" });
//
// Playwright is resolved from the project if installed, else from the global
// npm root (it is preinstalled globally in the Claude Code cloud image).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MOCK = path.join(ROOT, "tools/qa/supabase-mock.js");

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require("playwright");
  } catch {
    const globalRoot = execSync("npm root -g").toString().trim();
    return require(path.join(globalRoot, "playwright"));
  }
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    // Same fallback as Cloudflare Pages' SPA mode.
    if (!fs.existsSync(file)) file = path.join(ROOT, "index.html");
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1280, height: 780 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
  "mobile-landscape": { width: 844, height: 390 },
  small: { width: 360, height: 700 },
};

export async function launch({ headless = true } = {}) {
  const { chromium } = loadPlaywright();
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ headless });

  async function open({ viewport = "desktop", colorScheme = "light", reducedMotion = "no-preference", qa = {}, path: p = "", storage = null } = {}) {
    const vp = VIEWPORTS[viewport] || viewport;
    const context = await browser.newContext({
      viewport: vp,
      colorScheme,
      reducedMotion,
      hasTouch: vp.width < 900,
      isMobile: vp.width < 600,
      deviceScaleFactor: 1,
      serviceWorkers: "block",
    });
    await context.addInitScript((cfg) => {
      window.__PANALO_QA__ = cfg;
    }, { online: ["maya"], ...qa });
    if (storage) {
      await context.addInitScript((entries) => {
        if (sessionStorage.getItem("qa.seeded")) return;
        sessionStorage.setItem("qa.seeded", "1");
        for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
      }, storage);
    }
    await context.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2", (route) =>
      route.fulfill({ status: 200, contentType: "text/javascript", body: fs.readFileSync(MOCK, "utf8") })
    );
    await context.route(/supabase\.co/, (route) => route.abort());
    // Fonts are cosmetic; don't let a slow network stall a run.
    await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
      process.env.QA_FONTS ? route.continue() : route.abort()
    );

    const page = await context.newPage();
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(m.text())) {
        page.errors.push(`console: ${m.text()}`);
      }
    });
    await page.goto(base + p);
    return page;
  }

  async function close() {
    await browser.close();
    server.close();
  }

  return { open, close, base };
}

// Log in through the real form with the seeded account.
export async function login(page, { email = "qa@panalo.test", password = "correct-horse-42" } = {}) {
  await page.evaluate(() => window.__qa.ready);
  await page.goto(page.url().split("#")[0] + "#login");
  await page.fill("#login-email", email);
  await page.fill("#login-password", password);
  await page.click("#login-btn");
  await page.waitForSelector("#chat-app:not(.hidden)", { timeout: 15000 });
  await page.waitForSelector(".conv-item", { timeout: 15000 });
}
