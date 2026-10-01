// Browser smoke test for Panalo Students (students/), against the mock.
//
//   node tools/qa/students.mjs                 # exits 1 on any failure
//   QA_SHOTS=/tmp/shots node tools/qa/students.mjs
//
// Covers the real flows end to end: sign-up and the birth of a universe,
// tasks and a focus session reaching the world, the calendar, encrypted
// messaging, a room with a door, the archive, blocking and reporting, Drift,
// and the phone layout. Nothing here can reach a real Supabase project
// (see tools/qa/README.md).
import { launch } from "./harness.mjs";
import fs from "node:fs";

const SHOTS = process.env.QA_SHOTS;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const check = (label, cond) => {
  console.log(`${cond ? "  ok  " : "  FAIL"} ${label}`);
  if (!cond) failed++;
};
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/students-${name}.png` });
// The app is interactive once main.js has decided what to show.
const appReady = (page) => page.waitForSelector("body.ready", { timeout: 20000 });
const go = async (page, route, wait = 900) => {
  await page.evaluate((r) => (location.hash = r), route);
  await page.waitForTimeout(wait);
};

async function finishBirth(page) {
  // The sequence may already have reached its questions on a slow machine,
  // where Skip is (correctly) gone. Accept either.
  try {
    await page.waitForSelector("#birth-skip:not([hidden]), #birth-form:not([hidden])", { timeout: 20000 });
  } catch (e) {
    // Say where we actually are, so a failure here is diagnosable.
    console.log("finishBirth: stuck at", await page.evaluate(() => ({
      hash: location.hash,
      shown: ["landing", "auth", "birth", "app"].filter((id) => !document.getElementById(id).hidden),
      forms: [...document.querySelectorAll(".airlock-form")].filter((f) => !f.hidden).map((f) => f.id),
      message: document.getElementById("auth-message").textContent,
      body: document.body.className,
    })), page.errors);
    throw e;
  }
  if (await page.isVisible("#birth-skip")) await page.click("#birth-skip").catch(() => {});
  await page.waitForSelector("#birth-form:not([hidden])");
  await page.fill("#birth-world-name", "Kepler QA");
  await page.click("#birth-form button[type=submit]");
  await page.click("#birth-form .chip >> text=Space");
  await page.click("#birth-form button[type=submit]");
  await page.click("#birth-form button[type=submit]");
  await page.waitForSelector("#app:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(800);
}

const qa = await launch();
try {
  // ---- Outside, sign-up, birth ------------------------------------------------
  {
    const page = await qa.open({ viewport: "desktop", path: "students/" });
    await page.waitForTimeout(600);
    check("the landing page is shown to a visitor", await page.isVisible("#landing"));
    check("the landing explains who it is for", /intensely curious/i.test(await page.textContent(".hero")));
    await page.fill("#wd-focus", "120").catch(() => {});
    await page.dispatchEvent("#wd-focus", "input");
    check("the world demo responds to its sliders", (await page.textContent("#wd-focus-out")) === "120 h");
    await shot(page, "landing");

    await page.click(".land-cta a[href='#signup']");
    await page.waitForTimeout(300);
    check("sign-up is its own place, not the landing", (await page.isVisible("#auth")) && !(await page.isVisible("#landing")));
    await page.evaluate(() => window.__qa.ready);
    await appReady(page);
    await page.fill("#signup-username", "nova_q");
    await page.fill("#signup-email", "nova@panalo.test");
    await page.fill("#signup-password", "a-long-enough-pass");
    await page.click("#signup-submit");
    await page.waitForTimeout(400);
    check("the age and rules confirmation is required", /13 or older/.test(await page.textContent("#auth-message")));
    await page.check("#signup-age");
    await page.click("#signup-submit");
    await finishBirth(page);
    const prof = await page.evaluate(() => window.__qa.db.student_profiles[0]);
    check("the birth saves a named world with interests", prof?.world_name === "Kepler QA" && prof.interests.includes("space"));
    const goal = await page.evaluate(() => window.__qa.db.student_goals[0]);
    check("the first moon is the weekly focus goal", goal?.weekly_minutes === 300);
    check("a new account lands on Now", /Now/.test(await page.title()));
    check("the new account has encryption keys", await page.evaluate(() => window.__qa.db.user_keys.length === 2));
    await page.close();
  }

  // ---- The seeded account: study, world, calendar ----------------------------------
  const page = await qa.open({ viewport: "desktop", path: "students/#login" });
  await page.evaluate(() => window.__qa.ready);
  await appReady(page);
  await page.fill("#login-email", "qa@panalo.test");
  await page.fill("#login-password", "wrong-password");
  await page.click("#login-submit");
  await page.waitForTimeout(500);
  check("a wrong password is reported plainly", /don't match/.test(await page.textContent("#auth-message")));
  await page.fill("#login-password", "correct-horse-42");
  await page.click("#login-submit");
  await finishBirth(page);
  check("Now shows the day orbit", await page.isVisible(".orbit-svg"));
  check("Now shows live unread signals", /unread signal/.test(await page.textContent(".s-sub")));
  await shot(page, "now");

  await go(page, "#/study");
  await page.fill(".task-form input[type=text]", "Finish optics problem set");
  await page.click(".task-form button[type=submit]");
  await page.waitForTimeout(400);
  check("a task can be added", await page.isVisible(".task-list >> text=Finish optics problem set"));
  await page.fill(".study-subject", "Physics");
  await page.click("#study-start");
  await page.waitForTimeout(400);
  check("the focus timer starts", await page.isVisible("#study-pause"));
  // Pretend 26 minutes passed: the timer is timestamps, so moving them back
  // is exactly what a closed laptop looks like.
  await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem("panalo.students.timer"));
    t.startedAt -= 26 * 60000;
    t.segmentStart -= 26 * 60000;
    localStorage.setItem("panalo.students.timer", JSON.stringify(t));
    document.dispatchEvent(new CustomEvent("panalo:timer"));
  });
  await page.waitForTimeout(1200);
  const sessions = await page.evaluate(() => window.__qa.db.focus_sessions);
  check("a finished focus block is recorded once", sessions.length === 1 && sessions[0].focused_minutes === 25 && sessions[0].subject === "Physics");
  check("the session is plausible for the database", Date.parse(sessions[0].ended_at) - Date.parse(sessions[0].started_at) >= 25 * 60000);
  await page.click(".task-list input[type=checkbox]");
  await page.waitForTimeout(400);
  check("a task can be completed", await page.evaluate(() => !!window.__qa.db.student_tasks[0].done_at));
  await shot(page, "study");

  await go(page, "#/world");
  const legend = await page.textContent(".legend");
  check("the world legend shows the focus that grew the land", /25 min/.test(legend));
  check("the world legend counts the finished task as a light", /Lights\s*Tasks finished.*1/s.test(legend));
  await page.click("text=Log an activity");
  await page.click("dialog .chip >> text=Making something");
  await page.fill("dialog input[type=number]", "45");
  await page.click("dialog .btn-primary");
  await page.waitForTimeout(500);
  check("logging an activity lights the aurora", /Aurora\s*Making things, last 30 days\.\s*45 min/.test(await page.textContent(".legend")));
  check("the first session is a discovery", /First session/.test(await page.textContent(".world-lower")));
  await shot(page, "world");

  await go(page, "#/calendar/add", 1200);
  await page.fill("dialog input[placeholder^='e.g. Physics']", "Chemistry lab");
  await page.click("dialog .btn-primary");
  await page.waitForTimeout(500);
  const ev = await page.evaluate(() => window.__qa.db.student_events[0]);
  check("a class can be added to the timetable", ev?.title === "Chemistry lab" && ev.repeat_weekly === true && ev.kind === "class");
  check("it appears on the day", await page.isVisible(".agenda >> text=Chemistry lab"));
  await page.click("[data-view-btn=week]");
  await page.waitForTimeout(300);
  check("the week view shows the timetable", await page.isVisible(".week-ev >> text=Chemistry lab"));
  await shot(page, "calendar");

  // ---- Signals: encrypted messaging, a room with a door, blocking --------------------
  await go(page, "#/signals");
  check("conversations are grouped by what they are for", (await page.textContent(".sig-body")).includes("People"));
  await page.click(".sig-row >> text=maya");
  await page.waitForTimeout(1200);
  check("a thread decrypts and shows its history", await page.isVisible(".msg >> text=error propagation"));
  await page.fill(".composer textarea", "see you at the library 📚");
  await page.press(".composer textarea", "Enter");
  await page.waitForTimeout(900);
  const sent = await page.evaluate(() => window.__qa.db.messages.at(-1));
  check("a message sent from Students is stored encrypted", !!sent.iv && !sent.content.includes("library"));
  check("and shows in the thread", await page.isVisible(".msg.mine >> text=see you at the library"));
  await page.evaluate(() => window.__qa.receive("maya", "maya", "incoming from maya"));
  await page.waitForTimeout(900);
  check("incoming messages arrive live", await page.isVisible(".msg >> text=incoming from maya"));
  await shot(page, "thread");

  await go(page, "#/signals/new", 1000);
  await page.click("dialog .chip >> text=Open a room");
  await page.fill("dialog input[placeholder^='e.g. Model UN']", "Hackathon QA");
  await page.click("dialog .btn-primary");
  await page.waitForTimeout(1600);
  const room = await page.evaluate(() => window.__qa.db.conversations.find((c) => c.name === "Hackathon QA"));
  check("a room is created with an end time", room?.kind === "event" && !!room.ends_at);
  const code = await page.evaluate((id) => window.__qa.db.room_codes.find((r) => r.conversation_id === id)?.code, room?.id);
  check("the room gets a join code", /^[A-HJ-NP-Z2-9]{8}$/.test(code || ""));
  check("the room is encrypted from the start", await page.evaluate((id) => window.__qa.db.conversation_keys.some((k) => k.conversation_id === id), room?.id));
  await page.waitForSelector("dialog .door-code", { timeout: 5000 }).catch(() => {});
  check("the host sees the code", (await page.textContent("dialog .door-code").catch(() => "")).replace("-", "") === code);
  await page.evaluate((c) => window.__qa.knock("jordan", c), code);
  await page.waitForTimeout(900);
  check("someone knocking appears in the waiting room", await page.isVisible("dialog >> text=@jordan"));
  await shot(page, "door");
  await page.click("dialog button >> text=Let in");
  await page.waitForTimeout(1200);
  const admitted = await page.evaluate(({ id }) => {
    const j = window.__qa.db.profiles.find((p) => p.username === "jordan");
    return {
      member: window.__qa.db.conversation_participants.some((p) => p.conversation_id === id && p.user_id === j.id),
      key: window.__qa.db.conversation_keys.some((k) => k.conversation_id === id && k.user_id === j.id),
      waiting: window.__qa.db.room_requests.length,
    };
  }, { id: room?.id });
  check("letting someone in adds them and shares the room's key", admitted.member && admitted.key && admitted.waiting === 0);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  await go(page, "#/signals", 600);
  await page.click(".sig-row >> text=Physics study group");
  await page.waitForTimeout(1200);
  const before = await page.locator(".msg >> text=notes from today").count();
  await page.hover(".msg >> text=notes from today");
  await page.click(".msg:has-text('notes from today') .msg-more");
  await page.click(".menu.pop button >> text=Report this message");
  await page.check("dialog input[type=checkbox]");
  await page.click("dialog .btn-primary");
  await page.waitForTimeout(500);
  const rep = await page.evaluate(() => window.__qa.db.reports[0]);
  check("a message can be reported, with its text if the reporter chooses", rep?.reason === "harassment" && rep.evidence === "notes from today are in the drive" && !!rep.message_id);
  await page.hover(".msg >> text=notes from today");
  await page.click(".msg:has-text('notes from today') .msg-more");
  await page.click(".menu.pop button >> text=Block @priya");
  await page.click("dialog .btn-danger");
  await page.waitForTimeout(1500);
  check("blocking hides their messages", before === 1 && (await page.locator(".msg >> text=notes from today").count()) === 0);
  check("the block is recorded", await page.evaluate(() => window.__qa.db.blocks.length === 1));

  // ---- Archive ------------------------------------------------------------------------
  await go(page, "#/archive", 1000);
  check("the empty archive says what it is for", await page.isVisible("text=The archive is empty."));
  await page.click(".s-actions button >> text=Upload");
  await page.setInputFiles("dialog input[type=file]", { name: "optics-notes.md", mimeType: "text/markdown", buffer: Buffer.from("# Optics\nSnell's law: n1 sin θ1 = n2 sin θ2") });
  await page.fill("dialog input[list]", "Physics");
  await page.click("dialog .btn-primary");
  await page.waitForTimeout(900);
  const res = await page.evaluate(() => window.__qa.db.resources[0]);
  check("a file is uploaded privately", res?.object_path.startsWith("u/") && !res.conversation_id && res.shelf === "Physics");
  check("it is catalogued with its type, size and owner", /optics-notes\.md/.test(await page.textContent(".artifacts")) && /Added by you/.test(await page.textContent(".artifacts")));
  await page.click(".artifact button >> text=Preview");
  await page.waitForTimeout(700);
  check("a text file previews", /Snell's law/.test(await page.textContent("dialog .preview-text").catch(() => "")));
  await shot(page, "archive");
  await page.keyboard.press("Escape");

  // ---- Drift ---------------------------------------------------------------------------
  await go(page, "#/drift", 800);
  await page.click(".drift-card >> nth=0 >> button");
  await page.waitForTimeout(300);
  check("Drift reveals today's fact", (await page.textContent(".drift-fact")).length > 20);
  check("Drift has no feed: exactly three things", (await page.locator(".drift-card").count()) === 3);

  // ---- Warp and safety ------------------------------------------------------------------
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(300);
  await page.fill(".warp-input", "safety");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  check("Warp jumps anywhere by typing", /Safety/.test(await page.title()));
  check("Safety lists the person you blocked", await page.isVisible("text=@priya"));

  // Reload: the session, the world and the data survive.
  await page.reload();
  await page.waitForSelector("#app:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(800);
  check("the session and data survive a reload", /Kepler QA|alex/.test(await page.textContent("#me-menu")) && (await page.evaluate(() => window.__qa.db.focus_sessions.length)) === 1);
  check("no console errors (desktop)", page.errors.length === 0);
  if (page.errors.length) console.log(page.errors.join("\n"));
  await page.close();

  // ---- Phone ------------------------------------------------------------------------------
  {
    const m = await qa.open({ viewport: "mobile", path: "students/#login" });
    await m.evaluate(() => window.__qa.ready);
    await appReady(m);
    await m.fill("#login-email", "qa@panalo.test");
    await m.fill("#login-password", "correct-horse-42");
    await m.click("#login-submit");
    await finishBirth(m);
    check("the phone dock is shown", await m.isVisible(".dock"));
    check("the top navigation gives way to it", !(await m.isVisible(".bar-nav")));
    await m.click(".dock a[data-route=signals]");
    await m.waitForTimeout(900);
    await m.click(".sig-row >> nth=0");
    await m.waitForTimeout(1100);
    check("a thread opens full-screen on a phone", (await m.isVisible(".thread-pane")) && !(await m.isVisible(".sig-list")));
    await m.click(".thread-back");
    await m.waitForTimeout(500);
    check("back returns to the list", await m.isVisible(".sig-list"));
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check("nothing scrolls sideways", !overflow);
    await shot(m, "phone-signals");
    check("no console errors (phone)", m.errors.length === 0);
    if (m.errors.length) console.log(m.errors.join("\n"));
  }

  // ---- Auth paths: email code, unlock on a new device, invite links, sign-out ----
  {
    const a = await qa.open({ viewport: "laptop", path: "students/#signup", qa: { confirmEmail: true } });
    await a.evaluate(() => window.__qa.ready);
    await appReady(a);
    await a.fill("#signup-username", "orbit_two");
    await a.fill("#signup-email", "two@panalo.test");
    await a.fill("#signup-password", "a-long-enough-pass");
    await a.check("#signup-age");
    await a.click("#signup-submit");
    await a.waitForSelector("#otp-form:not([hidden])", { timeout: 5000 }).catch(() => {});
    check("with email confirmation on, sign-up asks for the code", await a.isVisible("#otp-form"));
    await a.fill("#otp-code", "123456");
    await a.click("#otp-submit");
    await a.waitForSelector("#birth:not([hidden])", { timeout: 15000 }).catch(() => {});
    check("the code leads into the birth of a universe", await a.isVisible("#birth"));
    await a.close();

    const b = await qa.open({ viewport: "laptop", path: "students/#login" });
    await b.evaluate(() => window.__qa.ready);
    await appReady(b);
    await b.fill("#login-email", "qa@panalo.test");
    await b.fill("#login-password", "correct-horse-42");
    await b.click("#login-submit");
    await finishBirth(b);
    // A new device: the session is there, the cached private key is not.
    await b.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("panalo-keys"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
    await b.reload();
    await b.waitForSelector("#unlock-form:not([hidden])", { timeout: 15000 }).catch(() => {});
    check("a device without the key asks to unlock, not to sign in again", await b.isVisible("#unlock-form"));
    await b.fill("#unlock-password", "correct-horse-42");
    await b.click("#unlock-submit");
    await b.waitForSelector("#app:not([hidden])", { timeout: 15000 }).catch(() => {});
    check("unlocking opens the universe", await b.isVisible("#app"));
    await b.click("#me-open");
    await b.click("#signout-btn");
    await b.waitForTimeout(800);
    check("signing out returns to the crossing", (await b.isVisible("#login-form")) && !(await b.isVisible("#app")));
    check("signing out locks the key on this device", await b.evaluate(() => new Promise((r) => { const q = indexedDB.open("panalo-keys", 1); q.onsuccess = () => { const g = q.result.transaction("keys").objectStore("keys").count(); g.onsuccess = () => r(g.result === 0); }; q.onerror = () => r(true); })));

    // An invite link opened while signed out survives the sign-in.
    const code = "ABCD2345"; // the sheet only has to arrive pre-filled; the code needn't exist
    await b.goto(`${qa.base}students/#join=${code}`);
    await b.waitForTimeout(600);
    check("an invite link asks you to sign in first", /join that room/.test(await b.textContent("#auth-message")));
    await b.fill("#login-email", "qa@panalo.test");
    await b.fill("#login-password", "correct-horse-42");
    await b.click("#login-submit");
    await b.waitForSelector("dialog .code-input", { timeout: 15000 }).catch(() => {});
    check("after signing in, the join sheet opens with the code filled in", (await b.inputValue("dialog .code-input").catch(() => "")) === code);
    check("no console errors (auth paths)", b.errors.length === 0);
    if (b.errors.length) console.log(b.errors.join("\n"));
    await b.close();
  }

  // ---- Reduced motion -----------------------------------------------------------------------
  {
    const r = await qa.open({ viewport: "laptop", path: "students/", reducedMotion: "reduce" });
    await r.waitForTimeout(500);
    const anim = await r.evaluate(() => getComputedStyle(document.querySelector(".ht-line")).animationName);
    check("reduced motion turns the landing animation off", anim === "none");
    check("no console errors (reduced motion)", r.errors.length === 0);
  }
} finally {
  await qa.close();
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall students checks passed");
process.exitCode = failed ? 1 : 0;
