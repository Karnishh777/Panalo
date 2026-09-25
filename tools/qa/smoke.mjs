// Browser smoke test: drives the real UI against the in-memory mock.
//
//   node tools/qa/smoke.mjs            # exits 1 on any failure
//   QA_SHOTS=/tmp/shots node tools/qa/smoke.mjs   # also save screenshots
//
// Needs Playwright + Chromium (preinstalled in the Claude Code cloud image;
// elsewhere: npm i -g playwright && npx playwright install chromium).
import { launch, login } from "./harness.mjs";
import fs from "node:fs";

const SHOTS = process.env.QA_SHOTS;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const check = (label, cond) => {
  console.log(`${cond ? "  ok  " : "  FAIL"} ${label}`);
  if (!cond) failed++;
};
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });

const qa = await launch();
try {
  // ---- Public → login → chat (desktop, light) ----
  {
    const page = await qa.open({ viewport: "desktop" });
    await page.waitForTimeout(500);
    check("landing is shown to a visitor", await page.isVisible("#landing"));
    await shot(page, "landing");
    await page.click(".land-nav-cta a[href='#signup']");
    await page.waitForTimeout(200);
    check("#signup shows the sign-up form", await page.isVisible("#signup-step-1"));
    await page.evaluate(() => window.__qa.ready);
    await page.goto(page.url().split("#")[0] + "#login");
    await page.fill("#login-email", "qa@panalo.test");
    await page.fill("#login-password", "nope");
    await page.press("#login-password", "Enter");
    await page.waitForTimeout(600);
    check("a wrong password is reported", /invalid/i.test(await page.textContent("#auth-message")));
    await login(page);
    check("home renders from real data", /Good|Up late/.test(await page.textContent(".home-greeting")));
    await shot(page, "home");

    await page.click(".conv-item >> nth=0");
    await page.waitForTimeout(1200);
    await page.fill("#message-input", "smoke https://example.com");
    await page.press("#message-input", "Enter");
    await page.waitForTimeout(800);
    const href = await page.$eval("#messages-list .message:last-of-type .message-text a", (a) => a.href).catch(() => null);
    check("Enter sends and links render", href === "https://example.com/");
    const cipher = await page.evaluate(() => window.__qa.db.messages.at(-1));
    check("the sent message is stored encrypted", !!cipher.iv && !cipher.content.includes("smoke"));
    // Scroll up the way a person does (the wheel), not by setting scrollTop.
    await page.hover("#messages-container");
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -600);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__qa.receive("maya", "maya", "incoming"));
    await page.waitForTimeout(700);
    check("new message while scrolled up shows jump-to-latest", await page.isVisible("#jump-latest"));
    await shot(page, "chat");

    await page.focus("#settings-btn");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    check("settings takes focus", await page.evaluate(() => document.getElementById("settings-modal").contains(document.activeElement)));
    await page.click("#theme-mode-options [data-id='dark']");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    check("Escape closes settings and restores focus", await page.evaluate(() => document.activeElement.id === "settings-btn"));
    await page.reload();
    await page.waitForTimeout(100);
    check("dark theme is applied before the app starts", (await page.getAttribute("html", "data-theme")) === "dark");
    await page.waitForSelector("#chat-app:not(.hidden)", { timeout: 15000 });
    check("session restores after reload", true);
    check("no console errors (desktop)", page.errors.length === 0 || (console.log(page.errors), false));
    await page.context().close();
  }

  // ---- App lock can't be escaped ----
  {
    const page = await qa.open({ viewport: "desktop", storage: { "panalo.lock.app": "1" } });
    await page.evaluate(async () => (await import("/src/lock.js")).setPin("app", "2468"));
    await page.reload();
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    check("Escape does not dismiss the app lock", await page.evaluate(() => document.body.classList.contains("app-locked")));
    await page.fill("#pin-input", "2468");
    await page.press("#pin-input", "Enter");
    await page.waitForTimeout(300);
    check("the right PIN opens the app", await page.evaluate(() => !document.body.classList.contains("app-locked")));
    await page.context().close();
  }

  // ---- Phone ----
  {
    const page = await qa.open({ viewport: "mobile", colorScheme: "dark" });
    await login(page);
    check("bottom tab bar is shown", await page.isVisible(".nav-rail"));
    await page.tap(".conv-item >> nth=0");
    await page.waitForTimeout(1500);
    check("chat opens full-screen", await page.evaluate(() => document.getElementById("chat-app").classList.contains("chat-open")));
    check("chat opens at the latest message", !(await page.isVisible("#jump-latest")));
    await shot(page, "mobile-chat");
    await page.tap("#back-btn");
    await page.waitForTimeout(400);
    check("back returns to the list", await page.isVisible("#conversations-list"));
    check("no console errors (mobile)", page.errors.length === 0 || (console.log(page.errors), false));
    await page.context().close();
  }
} finally {
  await qa.close();
}
console.log(failed ? `\n${failed} check(s) failed` : "\nall smoke checks passed");
process.exit(failed ? 1 : 0);
