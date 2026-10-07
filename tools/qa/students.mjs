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
import { launch, LEAKED_PASSWORD } from "./harness.mjs";
import fs from "node:fs";
import { lastWeek } from "../../students/js/model/chronicle.js";

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
// Date of birth on the sign-up form (phase 22). `age` in whole years.
const fillBirth = async (page, age, prefix = "#signup-birth") => {
  await page.selectOption(`${prefix}-month`, "1");
  await page.fill(`${prefix}-year`, String(new Date().getFullYear() - age - 1));
};
const go = async (page, route, wait = 900) => {
  await page.evaluate((r) => (location.hash = r), route);
  await page.waitForTimeout(wait);
};

let finaleSeen = null; // what the finale showed, the first time it's watched
async function finishBirth(page, { watchFinale = false } = {}) {
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
  if (watchFinale) {
    // Batch 4: your first constellations, your world's name in stars, the fall.
    await page.waitForSelector(".finale", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1600);
    finaleSeen = await page.evaluate(() => ({
      on: !!document.querySelector(".finale"),
      labels: [...document.querySelectorAll(".finale-const text")].map((t) => t.textContent),
      name: !!document.querySelector(".finale-name"),
      caption: document.querySelector(".finale-caption")?.textContent || "",
    }));
    await page.waitForFunction(() => document.querySelector(".birth.falling"), null, { timeout: 8000 }).then(() => (finaleSeen.fell = true)).catch(() => {});
  }
  await page.waitForSelector("#app:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(800);
}

const qa = await launch();
// Batch 2's discovery moments and weekly chronicle are full-screen and would
// land in the middle of the older flows: every page starts with them seen,
// unless a test asks for them (storage: { "panalo.students.prefs": "{}" }).
const ALL_MOMENTS = ["first-focus", "focus-1", "focus-10", "focus-25", "focus-50", "focus-100", "focus-250", "tasks-1", "tasks-10", "tasks-50", "tasks-200", "first-aurora", "streak-7", "first-moon", "pages-1", "pages-7", "pages-30", "pages-100"];
const QUIET = { "panalo.students.prefs": JSON.stringify({ momentsSeen: ALL_MOMENTS, chronicleSeen: lastWeek().key }) };
const openPage = qa.open;
qa.open = (o = {}) => openPage({ ...o, storage: { ...QUIET, ...(o.storage || {}) } });
try {
  // ---- Outside, sign-up, birth ------------------------------------------------
  {
    const page = await qa.open({ viewport: "desktop", path: "students/" });
    await page.waitForTimeout(600);
    check("the landing page is shown to a visitor", await page.isVisible("#landing"));
    check("the landing explains who it is for", /intensely curious/i.test(await page.textContent(".hero")));
    // The slider is in the page from the start, but the demo only starts
    // listening once its globes are built: keep nudging until it answers.
    const demoAnswers = await page
      .waitForFunction(
        () => {
          const i = document.getElementById("wd-focus");
          i.value = "120";
          i.dispatchEvent(new Event("input"));
          return document.getElementById("wd-focus-out").textContent === "120 h";
        },
        null,
        { timeout: 15000, polling: 200 }
      )
      .then(() => true, () => false);
    check("the world demo responds to its sliders", demoAnswers);
    await shot(page, "landing");

    // The gate counts to 100 once and gets out of the way.
    check("the gate shows on first arrival", await page.evaluate(() => document.documentElement.hasAttribute("data-gate")));
    await page.waitForFunction(() => !document.documentElement.hasAttribute("data-gate"), null, { timeout: 5000 }).catch(() => {});
    check("the gate opens by itself", !(await page.evaluate(() => document.documentElement.hasAttribute("data-gate"))));
    // The opening page has the same Look switch (after the gate, which it
    // would otherwise race).
    await page.click("#land-look-open");
    await page.click("#land-look-menu .look-opt-signal");
    await page.waitForTimeout(700);
    check("the landing can switch looks too", (await page.evaluate(() => document.documentElement.dataset.look)) === "signal");
    await page.click("#land-look-open");
    await page.click("#land-look-menu .look-opt-glass");
    await page.waitForTimeout(700);
    // The thread: a star per chapter, each a link; reaching a chapter lights it.
    const thread = await page.evaluate(() => {
      const hrefs = [...document.querySelectorAll(".thread-stars a")].map((a) => a.getAttribute("href"));
      return { ok: hrefs.every((h) => document.querySelector(h)), stars: hrefs.length, chapters: document.querySelectorAll("#landing section[data-chapter]").length };
    });
    check("the thread has a star for every chapter", thread.ok && thread.stars === thread.chapters && thread.stars > 5);
    await page.evaluate(() => document.getElementById("numbers").scrollIntoView());
    await page.waitForTimeout(1800);
    const hudState = await page.evaluate(() => ({
      name: document.querySelector(".hud-name").textContent,
      here: [...document.querySelectorAll(".thread-stars li")].findIndex((li) => li.classList.contains("here")),
      counts: [...document.querySelectorAll("[data-count]")].map((n) => n.textContent),
    }));
    check("the HUD names the chapter you're in and its star is lit", hudState.name === "In numbers" && hudState.here === 3);
    check("the numbers count to their real values", hudState.counts.join() === "06,03,00,00");
    await page.evaluate(() => document.getElementById("faq").scrollIntoView());
    await page.waitForTimeout(900);
    await page.click("#faq details:first-of-type summary");
    check("questions open to their answers", await page.isVisible("#faq details:first-of-type p"));
    const heading = await page.innerText("#faq-title");
    check("decoded headings end as their real words", heading.replace(/\s+/g, " ").trim() === "Questions, answered.");
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(200);

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
    check("a date of birth is required", /month and year of birth/.test(await page.textContent("#auth-message")));
    await fillBirth(page, 11);
    await page.click("#signup-submit");
    await page.waitForTimeout(400);
    check("under 13 can't sign up", /13 and over/.test(await page.textContent("#auth-message")) && !(await page.isVisible("#birth")));
    await fillBirth(page, 24);
    await page.click("#signup-submit");
    await page.waitForTimeout(400);
    check("agreeing to the rules is required", /community rules/.test(await page.textContent("#auth-message")));
    await page.check("#signup-age");
    await page.click("#signup-submit");
    await page.waitForSelector("#birth-skip:not([hidden])", { timeout: 20000 });
    check("the intro is a film, with captions and a title card", (await page.locator("#birth .film-out").count()) === 1 && (await page.locator("#birth .film-caption").count()) === 1 && (await page.locator("#birth .film-title").count()) === 1);
    if (await page.isVisible(".birth-sound")) {
      await page.click(".birth-sound");
      const muted = await page.evaluate(() => ({
        pressed: document.querySelector(".birth-sound").getAttribute("aria-pressed"),
        saved: JSON.parse(localStorage.getItem("panalo.students.prefs") || "{}").introSound,
      }));
      check("the intro's sound can be turned off, and that is remembered", muted.pressed === "false" && muted.saved === false);
    } else check("the intro's sound can be turned off, and that is remembered", false);
    await finishBirth(page, { watchFinale: true });
    check("after the questions, your interests become your first constellations", finaleSeen?.on && finaleSeen.labels.includes("SPACE") && /first constellations/.test(finaleSeen.caption));
    check("…your world's name is written in stars", finaleSeen?.name === true);
    check("…and the camera falls into your world", finaleSeen?.fell === true);
    const letters = await page.evaluate(async () => (await import("/students/js/starwriter.js")).letterPoints("alex", 400, 80).pts.length);
    check("a name can be turned into stars (the title's)", letters > 40 && letters < 400);
    check("the film's pieces are cleared away once it ends", (await page.locator(".film-out, .film-caption, .film-title, .birth-sound").count()) === 0);
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
  // Phase 25: a username works too, but only with the right password.
  await page.fill("#login-email", "@alex");
  await page.fill("#login-password", "not-it");
  await page.click("#login-submit");
  await page.waitForTimeout(400);
  check("a wrong password with a username says so, and reveals nothing", /username and password don't match/.test(await page.textContent("#auth-message")));
  await page.fill("#login-email", "Alex");
  await page.fill("#login-password", "correct-horse-42");
  await page.click("#login-submit");
  await finishBirth(page);
  check("you can log in with your username", await page.isVisible("#app"));
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
  check("the Study Room never prints a stray \"null\"", !/\bnull\b/.test(await page.evaluate(() => document.querySelector(".study").innerText)));
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
  await page.waitForTimeout(600);
  const sky = await page.evaluate(() => ({
    stars: document.querySelectorAll(".sky-map .sky-star").length,
    rows: document.querySelectorAll(".sig-body .sig-row").length,
    unread: [...document.querySelectorAll(".sky-map .sky-star.unread")].every((a) => /unread/.test(a.getAttribute("aria-label"))),
    figures: document.querySelectorAll(".sky-map .sky-cons").length,
  }));
  check("the sky shows every conversation as a star, one constellation per kind", sky.stars > 0 && sky.stars === sky.rows && sky.figures >= 1 && sky.unread);
  await page.click(".sky-star[aria-label^='jordan']", { force: true });
  await page.waitForTimeout(900);
  check("a star opens its conversation", /#\/signals\/.+/.test(await page.evaluate(() => location.hash)) && (await page.isVisible(".thread-head >> text=jordan")));
  await go(page, "#/signals");
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
  // Polled, not broadcast (phase 17): it shows within one poll.
  await page.waitForSelector("dialog >> text=@jordan", { timeout: 9000 }).catch(() => {});
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

  // An error inside a sheet is shown inside the sheet, not under its backdrop.
  await go(page, "#/signals/join", 900);
  await page.fill("dialog .code-input", "BADC0DE9");
  await page.click("dialog .btn-primary");
  await page.waitForTimeout(600);
  check("errors appear inside the open dialog, as an alert", /doesn't open anything/.test(await page.textContent("dialog .sheet-alert").catch(() => "")));
  await page.keyboard.press("Escape");

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
  check("the empty archive says what it is for", await page.isVisible("text=Your shelves are waiting."));
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

  // A PDF: the upload shows progress, and the preview opens the browser's
  // viewer from a signed Storage link (a blob: tab is blank under the CSP).
  await page.click(".s-actions button >> text=Upload");
  await page.setInputFiles("dialog input[type=file]", { name: "past-paper.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%qa\n") });
  await page.evaluate(() => {
    window.__sawMeter = false;
    const m = document.querySelector("dialog .upload-meter");
    new MutationObserver(() => !m.hidden && (window.__sawMeter = true)).observe(m, { attributes: true });
  });
  await page.click("dialog .btn-primary");
  await page.waitForTimeout(1100);
  const meter = await page.evaluate(() => window.__sawMeter);
  check("an upload shows its progress", meter);
  check("the PDF is catalogued", await page.evaluate(() => window.__qa.db.resources.some((r) => r.file_name === "past-paper.pdf")));
  await page.click(".artifact:has-text('past-paper') button >> text=Preview");
  await page.waitForTimeout(700);
  const pdfHref = await page.getAttribute("dialog a.btn-primary", "href").catch(() => "");
  check("a PDF opens from a signed link, not a blob", /\/object\/sign\/student-resources\//.test(pdfHref || ""));
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

  // ---- Looks: Glass (default), Signal, Verse, Odyssey------------------------------------------
  check("the default look is Glass", (await page.evaluate(() => document.documentElement.dataset.look)) === "glass");
  await page.click("#look-open");
  check("the Look button opens a choice of four", (await page.locator("#look-menu .look-opt").count()) === 4);
  await page.click("#look-menu .look-opt-signal");
  await page.waitForTimeout(700);
  check("choosing Signal switches the look", (await page.evaluate(() => document.documentElement.dataset.look)) === "signal");
  check("the look is saved as a preference (it syncs)", (await page.evaluate(() => JSON.parse(localStorage.getItem("panalo.students.prefs")).look)) === "signal");
  check("the Look button names the look", /Signal/.test(await page.getAttribute("#look-open", "aria-label")));
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(300);
  await page.fill(".warp-input", "look: verse");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  check("Warp can change the look", (await page.evaluate(() => document.documentElement.dataset.look)) === "verse");
  await page.evaluate(() => (location.hash = "#/settings"));
  await page.waitForTimeout(900);
  check("Settings offers the four looks, with yours chosen", (await page.locator(".settings-look .look-opt").count()) === 4 && (await page.isChecked(".settings-look .look-opt-verse input")));
  await page.evaluate(() => (location.hash = "#/now"));
  await page.waitForTimeout(900);
  check("Verse lays Now out in orbit (the log's panels around the world)", await page.evaluate(() => getComputedStyle(document.querySelector(".now-log")).display === "contents"));

  // Reload: the session, the world and the data survive.
  await page.reload();
  await page.waitForSelector("#app:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(800);
  check("the session and data survive a reload", /Kepler QA|alex/.test(await page.textContent("#me-menu")) && (await page.evaluate(() => window.__qa.db.focus_sessions.length)) === 1);
  check("the look survives a reload, set before the first paint", (await page.evaluate(() => document.documentElement.dataset.look)) === "verse");
  // Odyssey: the scene behind the app, a camera that moves between pages.
  await page.evaluate(() => sessionStorage.removeItem("panalo.students.ody.seen"));
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(300);
  await page.fill(".warp-input", "look: odyssey");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".ody-stage", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(700);
  const ody = await page.evaluate(() => ({
    stage: !!document.querySelector(".ody-stage"),
    station: document.querySelector(".ody-stage")?.dataset.station,
    caption: document.querySelector(".ody-line")?.textContent || "",
    world: !!document.querySelector(".ody-globe[data-renderer]"),
  }));
  check("Odyssey builds its scene behind the app, with your world in it", ody.stage && ody.world);
  check("Odyssey subtitles the page it stands at", ody.station === "now" && /\./.test(ody.caption));
  await page.evaluate(() => (location.hash = "#/signals"));
  await page.waitForTimeout(250);
  const flight = await page.evaluate(() => ({
    station: document.querySelector(".ody-stage").dataset.station,
    flying: document.body.classList.contains("ody-flying"),
    chapter: [...document.querySelectorAll(".ody-chapter b")].map((b) => b.textContent).join(","),
    caption: document.querySelector(".ody-line").textContent,
  }));
  check("going somewhere flies the camera to that page's station", flight.station === "signals" && flight.flying);
  check("a first visit plays its chapter card", flight.chapter === "Signals");
  check("the subtitle follows the page", /voice|quiet/i.test(flight.caption));
  await page.waitForTimeout(1200);
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(300);
  await page.fill(".warp-input", "look: glass");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  check("leaving Odyssey takes its scene away", !(await page.evaluate(() => !!document.querySelector(".ody-stage, .ody-caption, .ody-grade"))));
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

  // ---- The day as a ritual: dawn, intention, closing the day (phase 24) ----------------
  {
    const d = await qa.open({ viewport: "laptop", path: "students/#login", qa: { dawn: true } });
    await d.evaluate(() => window.__qa.ready);
    await appReady(d);
    await d.fill("#login-email", "qa@panalo.test");
    await d.fill("#login-password", "correct-horse-42");
    await d.click("#login-submit");
    await d.waitForSelector(".dawn", { timeout: 15000 }).catch(() => {});
    check("the first open of the day plays the dawn", await d.isVisible(".dawn"));
    check("the dawn names the day of your world", /Day \d+/.test(await d.textContent(".dawn-title").catch(() => "")));
    check("the dawn says what changed since you were last here", (await d.locator(".dawn-lines li").count()) >= 1);
    await d.waitForTimeout(2800);
    check("the dawn asks one question: an intention, or closing the day", (await d.isVisible("#dawn-intention")) || (await d.isVisible("#dawn-close-day")));
    await shot(d, "dawn");
    const opened = await d.evaluate(() => window.__qa.db.daily_entries.filter((e) => e.opened_at && e.day === new Date().toLocaleDateString("en-CA")).length);
    check("the open is recorded before the dawn plays", opened === 1);
    await d.click(".dawn-skip");
    await d.waitForTimeout(700);
    check("the dawn can be skipped", !(await d.isVisible(".dawn")));
    await d.reload();
    await d.waitForSelector("#app:not([hidden])", { timeout: 15000 });
    await d.waitForTimeout(1200);
    check("it plays once a day, not on every visit", !(await d.isVisible(".dawn")));

    await d.click("#intention-set");
    await d.fill("input[aria-label=\"Today's intention\"]", "Finish the optics problem set");
    await d.click("#intention-save");
    await d.waitForTimeout(500);
    check("an intention is set for today and shown on Now", /Finish the optics problem set/.test(await d.textContent(".intention-text").catch(() => "")));
    await d.click("#intention-done");
    await d.waitForTimeout(400);
    check("the intention can be marked done", await d.evaluate(() => window.__qa.db.daily_entries.some((e) => e.intention_done === "yes")));

    await d.click("#close-day");
    await d.waitForSelector("#checkin-save");
    await d.click("#checkin-save");
    await d.waitForTimeout(300);
    check("closing the day needs only how it felt", await d.isVisible("#checkin-save"));
    await d.click(".chips.scale .chip.tone-drift[data-v='4']");
    await d.click(".chips.scale .chip.tone-focus[data-v='3']");
    await d.click(".checkin-acts [data-kind='read']");
    await d.fill("input[aria-label='One thing you learned']", "Light bends more in glass than in water");
    await d.click("#checkin-save");
    await d.waitForTimeout(700);
    const closed = await d.evaluate(() => {
      const today = new Date().toLocaleDateString("en-CA");
      const e = window.__qa.db.daily_entries.find((x) => x.day === today);
      return { mood: e?.mood, energy: e?.energy, closed: !!e?.closed_at, learned: e?.learned, read: window.__qa.db.activity_log.filter((l) => l.kind === "read" && l.occurred_on === today).reduce((n, l) => n + l.minutes, 0) };
    });
    check("closing the day keeps mood, energy and what you learned", closed.closed && closed.mood === 4 && closed.energy === 3 && /glass/.test(closed.learned || ""));
    check("what you tapped is logged to your world", closed.read === 30);
    check("Now shows the day closed", /Day closed · Good/.test(await d.textContent(".closed-line").catch(() => "")));
    check("today's star is lit in the week", await d.isVisible(".rhythm li.today.lit"));

    await go(d, "#/world/journal", 1000);
    check("the month is drawn in stars, today lit", (await d.isVisible(".month-sky")) && (await d.locator(".sky-star.today.lit").count()) === 1);
    check("the journal keeps the page", /Light bends more in glass/.test(await d.textContent(".journal")));
    check("the first closed day is a discovery", /First page/.test(await d.textContent(".disc-log")));
    await shot(d, "journal");
    await d.keyboard.press("Control+k");
    await d.fill(".warp-input", "close the day");
    check("Warp can close the day", (await d.locator(".warp-list li").count()) >= 1);
    await d.keyboard.press("Escape");
    check("no console errors (the daily ritual)", d.errors.length === 0);
    if (d.errors.length) console.log(d.errors.join("\n"));
    await d.close();

    // Reduced motion: the same card, still.
    const r = await qa.open({ viewport: "mobile", path: "students/#login", qa: { dawn: true }, reducedMotion: "reduce" });
    await r.evaluate(() => window.__qa.ready);
    await appReady(r);
    await r.fill("#login-email", "qa@panalo.test");
    await r.fill("#login-password", "correct-horse-42");
    await r.click("#login-submit");
    await r.waitForSelector(".dawn", { timeout: 15000 }).catch(() => {});
    check("under reduced motion the dawn is a still card", await r.isVisible(".dawn.still"));
    check("…with its question there at once", (await r.isVisible("#dawn-intention")) || (await r.isVisible("#dawn-close-day")));
    await shot(r, "dawn-phone");
    await r.close();
  }

  // ---- Weeks, moments, seasons, time (batch 2) ---------------------------------------------
  {
    const w = await qa.open({ viewport: "laptop", path: "students/#login", qa: { dawn: true }, storage: { "panalo.students.prefs": "{}" } });
    await w.evaluate(() => window.__qa.ready);
    await appReady(w);
    await w.fill("#login-email", "qa@panalo.test");
    await w.fill("#login-password", "correct-horse-42");
    await w.click("#login-submit");
    await w.waitForSelector(".dawn", { timeout: 15000 }).catch(() => {});
    check("the dawn names the season", /Season 1, First Light/.test(await w.textContent(".dawn-date").catch(() => "")));
    await w.click(".dawn-skip");
    await w.waitForSelector(".story", { timeout: 8000 }).catch(() => {});
    check("a new week opens with last week's chronicle", await w.isVisible(".story"));
    check("it starts with the week's number", /Week \d+/.test(await w.textContent(".story-title").catch(() => "")));
    await w.keyboard.press("ArrowRight");
    await w.waitForTimeout(1400);
    check("then last week's focus, counted up", /2 h 45 min|2h 45|165/.test(await w.textContent(".story-stage")));
    check("…with the best day marked", (await w.locator(".story-bars-chart .sb.best").count()) === 1);
    await shot(w, "chronicle-focus");
    await w.keyboard.press("ArrowRight");
    await w.waitForTimeout(500);
    check("then where it went, by subject", /Physics/.test(await w.textContent(".story-stage")) && /Chemistry/.test(await w.textContent(".story-stage")));
    let words = false, world = false;
    for (let k = 0; k < 6; k++) {
      await w.keyboard.press("ArrowRight");
      await w.waitForTimeout(500);
      const t = await w.textContent(".story-stage").catch(() => "");
      if (/Snell's law, finally/.test(t)) words = true;
      if (/Monday/.test(t) && (await w.locator(".story-globe").count()) === 2) { world = true; await shot(w, "chronicle-world"); }
    }
    check("what you wrote down comes back", words);
    check("and your world on Monday beside Sunday", world);
    await w.waitForSelector(".story", { state: "detached", timeout: 8000 }).catch(() => {});
    check("the chronicle ends on its own", !(await w.isVisible(".story")));
    check("it's marked seen (it won't replay)", await w.evaluate(() => !!JSON.parse(localStorage.getItem("panalo.students.prefs") || "{}").chronicleSeen));

    // Closing today is a first page this session... last week's was the first; a
    // moment for a fresh discovery: finishing a first task today isn't one either,
    // so make one: a moon, completed.
    await go(w, "#/world", 1000);
    check("World shows the season", /Season 1 · First Light/.test(await w.textContent(".season-line")));
    await w.click("text=Add a moon");
    await w.click(".sheet .chip >> text=A milestone");
    await w.fill(".sheet input[placeholder^='e.g.']", "Finish the robotics demo");
    await w.click(".sheet .btn-primary");
    await w.waitForTimeout(500);
    await w.click(".moons >> text=Mark done");
    await w.waitForSelector(".moment", { timeout: 8000 }).catch(() => {});
    check("reaching something stops the screen for a moment", await w.isVisible(".moment"));
    check("…named, with what it means", (await w.getAttribute(".moment-title", "aria-label").catch(() => "")) === "A moon, completed" && /robotics demo/.test(await w.textContent(".moment-detail").catch(() => "")));
    await shot(w, "moment");
    await w.waitForTimeout(1000);
    await w.click("#moment-on");
    await w.waitForTimeout(600);
    check("and gets out of the way", !(await w.isVisible(".moment")));
    await w.reload();
    await w.waitForSelector("#app:not([hidden])", { timeout: 15000 });
    await w.waitForTimeout(2500);
    check("each moment plays once", !(await w.isVisible(".moment")) && !(await w.isVisible(".story")));

    await go(w, "#/world", 1000);
    await w.click("#world-timelapse");
    await w.waitForTimeout(600);
    check("your world can be watched growing", await w.isVisible(".timelapse"));
    await w.waitForTimeout(8600);
    check("the time-lapse ends today, with today's totals", /lights?/.test(await w.textContent(".timelapse-stats")) && (await w.inputValue(".timelapse input[type=range]")) === "31");
    await shot(w, "timelapse");
    await w.fill(".timelapse input[type=range]", "0");
    await w.dispatchEvent(".timelapse input[type=range]", "input");
    check("…and scrubbed back to the start", /^0 min/.test(await w.textContent(".timelapse-stats")));
    await w.click(".timelapse-close");
    await w.click("#world-chronicle");
    await w.waitForTimeout(500);
    check("last week can be replayed from World", await w.isVisible(".story"));
    await w.keyboard.press("Escape");
    await w.waitForTimeout(600);
    check("no console errors (batch 2)", w.errors.length === 0);
    if (w.errors.length) console.log(w.errors.join("\n"));
    await w.close();
  }

  // ---- Surface upgrades: calendar, study, drift, archive (batch 3) ----------------------------
  {
    const u = await qa.open({ viewport: "laptop", path: "students/#login", qa: { dawn: true } });
    await u.evaluate(() => window.__qa.ready);
    await appReady(u);
    await u.fill("#login-email", "qa@panalo.test");
    await u.fill("#login-password", "correct-horse-42");
    await u.click("#login-submit");
    await u.waitForSelector(".dawn", { timeout: 15000 }).catch(() => {});
    await u.click(".dawn-skip").catch(() => {});
    await u.waitForTimeout(600);

    // Calendar: a line in plain words becomes an entry.
    await go(u, "#/calendar", 900);
    await u.fill("#quick-add", "Physics test fri 10am");
    await u.waitForTimeout(150);
    check("quick add previews what it understood", /^Exam · .*10:00 — “Physics test”/.test(await u.textContent("#quick-add-preview")));
    await u.press("#quick-add", "Enter");
    await u.waitForTimeout(600);
    const ev = await u.evaluate(() => window.__qa.db.student_events.find((e) => e.title === "Physics test"));
    check("…and adds it, an exam on Friday at ten", ev && ev.kind === "exam" && new Date(ev.starts_at).getDay() === 5 && new Date(ev.starts_at).getHours() === 10);
    check("exams get a countdown", /Physics test/.test(await u.textContent(".countdowns")));
    await u.fill("#quick-add", "Maths class every mon 9-10");
    await u.click(".quick-foot .link-btn");
    await u.waitForTimeout(300);
    check("Details… opens the full form, filled in", (await u.inputValue(".sheet input[placeholder^='e.g. Physics']")) === "Maths class");
    await u.keyboard.press("Escape");
    await shot(u, "calendar-quick");
    await go(u, "#/now", 900);
    check("Now counts down to exams", /Exams ahead/.test(await u.textContent(".now-log")) && /Physics test/.test(await u.textContent(".now-list.exams")));

    // Study: a plan of two blocks; the rest starts itself; how deep was it?
    await go(u, "#/study", 900);
    await u.click("[data-plan='2']");
    check("a plan for today shows the next block", /Block 1 of 2 next/.test(await u.textContent(".study-phase")));
    await u.keyboard.press(" ");
    await u.waitForTimeout(400);
    check("Space starts a block", await u.isVisible("#study-pause"));
    await u.evaluate(() => {
      const t = JSON.parse(localStorage.getItem("panalo.students.timer"));
      t.startedAt -= 26 * 60000;
      t.segmentStart -= 26 * 60000;
      localStorage.setItem("panalo.students.timer", JSON.stringify(t));
      document.dispatchEvent(new CustomEvent("panalo:timer"));
    });
    await u.waitForTimeout(1500);
    check("after a planned block, the rest starts by itself", /Rest/.test(await u.textContent(".study-phase")) && /Block 1 of 2/.test(await u.textContent(".study-notice")));
    await u.click("[data-quality='3']");
    await u.waitForTimeout(400);
    check("a block can be called deep", await u.evaluate(() => window.__qa.db.focus_sessions.some((s) => s.quality === 3)));
    check("this week's focus is broken down by subject", (await u.locator(".subj-bars li").count()) >= 1);
    await shot(u, "study-plan");
    // End the rest early to leave the timer idle for what follows.
    await u.click(".study-controls .btn-quiet").catch(() => {});

    // Drift: make the thing, keep the fact.
    await go(u, "#/drift", 800);
    await u.click(".drift-card >> nth=1 >> button");
    await u.click("#drift-made");
    await u.waitForTimeout(500);
    check("Drift's prompt can be logged in one tap", await u.evaluate(() => window.__qa.db.activity_log.some((l) => l.kind === "create" && l.note === "Drift prompt")));
    await u.click(".drift-card >> nth=0 >> button");
    await u.click(".drift-save");
    await u.waitForTimeout(300);
    check("a fact can be kept", (await u.textContent(".drift-saved summary").catch(() => "")) === "Facts you kept (1)");

    // Archive: "/" jumps to search.
    await go(u, "#/archive", 1200);
    await u.keyboard.press("/");
    check("/ jumps to the archive search", await u.evaluate(() => document.activeElement?.classList.contains("arch-search")));
    check("no console errors (batch 3)", u.errors.length === 0);
    if (u.errors.length) console.log(u.errors.join("\n"));
    await u.close();
  }

  // ---- Auth paths: email code, unlock on a new device, invite links, sign-out ----
  {
    const a = await qa.open({ viewport: "laptop", path: "students/#signup", qa: { confirmEmail: true } });
    await a.evaluate(() => window.__qa.ready);
    await appReady(a);
    await a.fill("#signup-username", "orbit_two");
    await a.fill("#signup-email", "two@panalo.test");
    await a.fill("#signup-password", LEAKED_PASSWORD);
    await fillBirth(a, 30);
    await a.check("#signup-age");
    await a.click("#signup-submit");
    await a.waitForTimeout(600);
    check("a password from a known data breach is refused", /data breach/.test(await a.textContent("#auth-message")) && !(await a.isVisible("#otp-form")));
    await a.fill("#signup-password", "a-long-enough-pass");
    await a.click("#signup-submit");
    await a.waitForSelector("#otp-form:not([hidden])", { timeout: 5000 }).catch(() => {});
    check("with email confirmation on, sign-up asks for the code", await a.isVisible("#otp-form"));
    // Leaving and logging in before entering the code comes back here.
    await a.evaluate(() => (location.hash = "#login"));
    await a.waitForSelector("#login-form:not([hidden])", { timeout: 5000 }).catch(() => {});
    await a.fill("#login-email", "two@panalo.test");
    await a.fill("#login-password", "a-long-enough-pass");
    await a.click("#login-submit");
    await a.waitForSelector("#otp-form:not([hidden])", { timeout: 5000 }).catch(() => {});
    check("logging in before confirming leads back to the code", (await a.isVisible("#otp-form")) && /isn't confirmed/.test(await a.textContent("#auth-message")));
    await a.click("#otp-resend");
    await a.waitForTimeout(500);
    check("a new code can be sent", (await a.evaluate(() => window.__qa.resent || [])).includes("two@panalo.test"));
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
    await b.evaluate(() => (location.hash = "#/study"));
    await b.waitForSelector("#study-start", { timeout: 8000 });
    await b.click("#study-start");
    await b.waitForTimeout(300);
    await b.click("#me-open");
    await b.click("#signout-btn");
    await b.waitForTimeout(800);
    check("signing out returns to the crossing", (await b.isVisible("#login-form")) && !(await b.isVisible("#app")));
    check("a running focus timer doesn't outlive the account that started it", await b.evaluate(() => localStorage.getItem("panalo.students.timer") === null));
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

  // ---- The world renderer: WebGL where it's fast, 2D everywhere else ----------------------
  {
    const probe = (pref) => async (page) => page.evaluate(async () => {
      const { createGlobe } = await import("/students/js/world-render.js");
      const c = document.createElement("canvas");
      c.style.cssText = "width:300px;height:300px;position:fixed;left:0;top:0";
      document.body.append(c);
      const g = createGlobe(c, { seed: "probe" });
      g.setLayers({ land: 0.4, lights: 0.3, aurora: 0.5, clouds: 0.3, ring: 1 }, [{ value: 0.5, done: false }]);
      await new Promise((r) => setTimeout(r, 1500));
      // Something was actually drawn: sample the middle of the planet. A
      // WebGL canvas can only be read in the frame it was drawn, so look
      // across a few frames.
      const copy = document.createElement("canvas");
      copy.width = c.width;
      copy.height = c.height;
      const x = copy.getContext("2d");
      let drawn = false;
      for (let i = 0; i < 90 && !drawn; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        x.clearRect(0, 0, copy.width, copy.height);
        x.drawImage(c, 0, 0);
        const px = x.getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
        drawn = px[3] > 0 && px[0] + px[1] + px[2] > 0;
      }
      g.setMotion({ speed: 3, direction: -1 });
      const m = g.getMotion();
      g.reset();
      const back = g.getMotion();
      const { setLight, getLight } = await import("/students/js/world-light.js");
      setLight({ mode: "night", night: 0.6 });
      const saved = JSON.parse(localStorage.getItem("panalo.students.light") || "{}");
      setLight({ azimuth: 30 });
      const custom = getLight();
      const out = { renderer: g.renderer, drawn, motion: m.speed === 3 && m.direction === -1 && back.speed === 1 && back.direction === 1, light: saved.mode === "night" && saved.night === 0.6 && custom.mode === "custom" && custom.azimuth === 30 };
      g.destroy();
      c.remove();
      return out;
    });
    const gl = await qa.open({ viewport: "laptop", path: "students/", storage: { "panalo.students.gl": "force" } });
    await gl.waitForTimeout(400);
    const a = await probe()(gl);
    check("the world renders with WebGL when it's allowed", a.renderer === "webgl" && a.drawn);
    check("the world's speed and direction can be changed and reset", a.motion);
    check("the light (sun, night side) is chosen and remembered", a.light);
    check("no console errors (WebGL world)", gl.errors.length === 0);
    if (gl.errors.length) console.log(gl.errors.join("\n"));
    await gl.close();
    const flat = await qa.open({ viewport: "laptop", path: "students/", storage: { "panalo.students.gl": "off" } });
    await flat.waitForTimeout(400);
    const b = await probe()(flat);
    check("the world falls back to the 2D renderer", b.renderer === "2d" && b.drawn);
    check("the 2D world has the same speed and direction controls", b.motion);
    check("no console errors (2D world)", flat.errors.length === 0);
    await flat.close();
  }

  // ---- Deleting an account deletes everything ------------------------------------------------
  {
    const d = await qa.open({ viewport: "laptop", path: "students/#signup" });
    await d.evaluate(() => window.__qa.ready);
    await appReady(d);
    await d.fill("#signup-username", "leaving_q");
    await d.fill("#signup-email", "leaving@panalo.test");
    await d.fill("#signup-password", "a-long-enough-pass");
    await fillBirth(d, 40);
    await d.check("#signup-age");
    await d.click("#signup-submit");
    await finishBirth(d);
    const uid = await d.evaluate(() => window.__qa.db.profiles.find((p) => p.username === "leaving_q").id);
    await go(d, "#/archive", 900);
    await d.click(".s-actions button >> text=Upload");
    await d.setInputFiles("dialog input[type=file]", { name: "mine.txt", mimeType: "text/plain", buffer: Buffer.from("mine") });
    await d.click("dialog .btn-primary");
    await d.waitForTimeout(900);
    const before = await d.evaluate((id) => window.__qa.storageKeys().filter((o) => o.owner === id).length, uid);
    await go(d, "#/safety", 900);
    await d.click("text=Delete my account");
    await d.fill("dialog input[type=text]", "leaving_q");
    await d.click("dialog .btn-danger");
    await d.waitForTimeout(1800);
    const after = await d.evaluate((id) => ({
      files: window.__qa.storageKeys().filter((o) => o.owner === id).length,
      rows: window.__qa.db.resources.filter((r) => r.owner_id === id).length,
      profile: window.__qa.db.profiles.some((p) => p.id === id),
      student: (window.__qa.db.student_profiles || []).some((p) => p.user_id === id),
    }), uid);
    check("deleting an account removes its files, archive, world and profile", before === 1 && after.files === 0 && after.rows === 0 && !after.profile && !after.student);
    check("no console errors (account deletion)", d.errors.length === 0);
    if (d.errors.length) console.log(d.errors.join("\n"));
    await d.close();
  }

  // ---- Moderation -------------------------------------------------------------------------
  {
    const p = await qa.open({ viewport: "laptop", path: "students/#/moderate" });
    await p.evaluate(() => window.__qa.ready);
    await appReady(p);
    await p.waitForSelector("#login-form:not([hidden])", { timeout: 5000 }).catch(() => {});
    check("a link inside the app, opened signed out, asks to log in first", (await p.isVisible("#login-form")) && /continue to that page/.test(await p.textContent("#auth-message")));
    await p.fill("#login-email", "qa@panalo.test");
    await p.fill("#login-password", "correct-horse-42");
    await p.click("#login-submit");
    await finishBirth(p);
    await p.waitForTimeout(800);
    check("after logging in (even a first time) it goes where the link pointed", await p.evaluate(() => location.hash === "#/moderate"));
    check("someone who isn't a moderator sees no reports and no menu entry", (await p.isVisible(".mod-door")) && !(await p.isVisible(".mod-card")) && (await p.isHidden("#mod-link")));

    // Something to moderate: maya reported for a message in a shared chat.
    await p.evaluate(async () => {
      const db = window.__qa.db;
      const maya = db.profiles.find((x) => x.username === "maya");
      const conv = db.conversations.find((c) => c.name);
      const msg = { id: crypto.randomUUID(), conversation_id: conv.id, user_id: maya.id, username: "maya", content: "x", iv: null, created_at: new Date().toISOString() };
      db.messages.push(msg);
      db.reports.push({ id: crypto.randomUUID(), reporter_id: db.profiles.find((x) => x.username === "sam")?.id || null, reported_user_id: maya.id, conversation_id: conv.id, message_id: msg.id, reason: "harassment", details: "kept messaging after I asked them to stop", evidence: "the words", status: "open", created_at: new Date().toISOString() });
      window.__qa.makeModerator("alex");
    });
    await go(p, "#/now");
    await go(p, "#/moderate");
    await p.waitForSelector(".mod-card", { timeout: 5000 }).catch(() => {});
    check("a moderator sees the report, with who and what", (await p.isVisible(".mod-card")) && /@maya/.test(await p.textContent(".mod-card")) && /the words/.test(await p.textContent(".mod-card")));
    await p.click(".mod-card button:has-text('Start reviewing')");
    await p.waitForTimeout(400);
    check("a report can be moved to reviewing", /Reviewing/.test(await p.textContent(".mod-card .mod-status")));
    await p.click(".mod-card button:has-text('Remove message')");
    await p.click("dialog[open] .btn-danger");
    await p.waitForTimeout(500);
    check("a reported message can be removed", /already removed/.test(await p.textContent(".mod-card")));
    await p.click(".mod-card button:has-text('Suspend')");
    await p.click("dialog[open] .chip >> text=7 days");
    await p.click("dialog[open] .btn-danger");
    await p.waitForTimeout(500);
    check("the reported account can be suspended", /suspended until/.test(await p.textContent(".mod-card")));
    await p.click("#me-open");
    check("moderators get a Moderation entry with the count waiting", (await p.isVisible("#mod-link")) && (await p.textContent("#mod-link [data-mod-count]")) === "1");
    await p.keyboard.press("Escape");
    await shot(p, "moderation");

    // The passphrase, and taking the role back after losing it.
    await p.fill(".mod-side input[autocomplete=new-password] >> nth=0", "orbit lantern quiet harbour");
    await p.fill(".mod-side input[autocomplete=new-password] >> nth=1", "orbit lantern quiet harbour");
    await p.click(".mod-side button:has-text('Save passphrase')");
    await p.waitForTimeout(300);
    await p.evaluate(() => (window.__qa.moderation().moderators.length = 0));
    await go(p, "#/now");
    await go(p, "#/moderate");
    await p.waitForSelector(".mod-door input", { timeout: 5000 }).catch(() => {});
    await p.fill(".mod-door input", "not it at all, sorry");
    await p.click(".mod-door button[type=submit]");
    await p.waitForTimeout(300);
    check("a wrong passphrase is refused", /isn't the passphrase/.test(await p.textContent(".mod-door")));
    await p.fill(".mod-door input", "orbit lantern quiet harbour");
    await p.click(".mod-door button[type=submit]");
    await p.waitForSelector(".mod-card", { timeout: 5000 }).catch(() => {});
    check("the passphrase makes this account the moderator again", await p.isVisible(".mod-card"));

    // Settings follow the account (phase 21): a change here goes up...
    await go(p, "#/study");
    await p.click(".chip:has-text('Custom')").catch(() => {});
    await p.waitForTimeout(1800);
    const up = await p.evaluate(() => window.__qa.db.student_profiles.find((r) => r.device_state)?.device_state?.prefs?.v?.studyPreset);
    check("a setting changed on this device is saved to the account", up === "custom");
    // ...and a newer change from another device comes down.
    await p.evaluate(() => {
      const row = window.__qa.db.student_profiles.find((r) => r.device_state);
      row.device_state.light = { v: { mode: "night", azimuth: 155, elevation: 12, night: 0.4 }, at: Date.now() + 60000 };
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await p.waitForTimeout(600);
    const down = await p.evaluate(() => JSON.parse(localStorage.getItem("panalo.students.light") || "{}").mode);
    check("a newer change from another device arrives here", down === "night");
    check("no console errors (moderation)", p.errors.length === 0);
    if (p.errors.length) console.log(p.errors.join("\n"));
    await p.close();
  }

  // ---- Under 18: a parent or guardian agrees first (phase 22) ----------------------------
  {
    const t = await qa.open({ viewport: "laptop", path: "students/#signup" });
    await t.evaluate(() => window.__qa.ready);
    await appReady(t);
    await t.fill("#signup-username", "teen_q");
    await t.fill("#signup-email", "teen@panalo.test");
    await t.fill("#signup-password", "a-long-enough-pass");
    await fillBirth(t, 15);
    await t.check("#signup-age");
    await t.click("#signup-submit");
    await t.waitForSelector("#guardian-form:not([hidden])", { timeout: 15000 }).catch(() => {});
    check("a 15-year-old is asked for a parent before anything else", (await t.isVisible("#guardian-form")) && !(await t.isVisible("#birth")) && !(await t.isVisible("#app")));
    const blocked = await t.evaluate(async () => (await window.supabase.createClient("x", "y").from("student_tasks").insert([{ title: "x" }])).error?.message || "");
    check("nothing can be stored for them yet", /parent or guardian/.test(blocked));
    await t.fill("#guardian-email", "teen@panalo.test");
    await t.click("#guardian-submit");
    await t.waitForTimeout(400);
    check("their own email isn't accepted as the parent's", /own email/.test(await t.textContent("#auth-message")));
    await t.fill("#guardian-email", "mum@panalo.test");
    await t.click("#guardian-submit");
    await t.waitForSelector("#guardian-wait:not([hidden])", { timeout: 5000 }).catch(() => {});
    check("the parent is emailed a code, and the student sees they're waiting", (await t.evaluate(() => window.__qa.otpSent || [])).includes("mum@panalo.test") && /Waiting for mum@panalo.test/.test(await t.textContent("#guardian-status")));
    await shot(t, "ask-a-parent");

    // The parent, on the same device: #parent.
    await t.evaluate(() => (location.hash = "#parent"));
    await t.reload();
    await t.evaluate(() => window.__qa.ready);
    await t.waitForSelector("#parent-start-form:not([hidden])", { timeout: 10000 }).catch(() => {});
    check("#parent opens the parent's page, not the app", (await t.isVisible("#parent-start-form")) && !(await t.isVisible("#app")));
    await t.fill("#parent-email", "mum@panalo.test");
    await t.click("#parent-send");
    await t.waitForSelector("#parent-code-form:not([hidden])", { timeout: 5000 }).catch(() => {});
    await t.fill("#parent-code", "000000");
    await t.click("#parent-verify");
    await t.waitForTimeout(400);
    check("a wrong code is refused", /didn't work/.test(await t.textContent("#auth-message")));
    await t.fill("#parent-code", "123456");
    await t.click("#parent-verify");
    await t.waitForSelector(".parent-card", { timeout: 5000 }).catch(() => {});
    check("the parent sees their child's request and what Panalo keeps", (await t.isVisible(".parent-card")) && /@teen_q/.test(await t.textContent(".parent-card")) && /What Panalo keeps/.test(await t.textContent(".parent-card")));
    await t.click(".parent-card .btn-primary");
    await t.waitForTimeout(300);
    check("approving needs their name and all three declarations", /full name/.test(await t.textContent("#auth-message")));
    await t.fill(".parent-card input[autocomplete=name]", "Asha Rao");
    await t.fill(".parent-card input[type=number]", "1980");
    for (const c of await t.$$(".parent-card input[type=checkbox]")) await c.check();
    await shot(t, "parent-approve");
    await t.click(".parent-card .btn-primary");
    await t.waitForTimeout(600);
    check("the parent can approve", /can now use Panalo/.test(await t.textContent("#auth-message")) && (await t.evaluate(() => window.__qa.db.account_age.find((a) => a.parent_email === "mum@panalo.test")?.consent)) === "approved");
    check("and later withdraw (shown once approved)", await t.isVisible(".parent-card.approved .btn-danger"));
    await t.click("#parent-done");
    await t.waitForTimeout(1200);

    // The student logs in again and gets in.
    await t.evaluate(() => (location.hash = "#login"));
    await t.waitForSelector("#login-form:not([hidden])", { timeout: 8000 }).catch(() => {});
    await t.fill("#login-email", "teen@panalo.test");
    await t.fill("#login-password", "a-long-enough-pass");
    await t.click("#login-submit");
    await finishBirth(t);
    check("with a parent's consent, the student gets in", await t.isVisible("#app"));
    check("no console errors (parent consent)", t.errors.length === 0);
    if (t.errors.length) console.log(t.errors.join("\n"));
    await t.close();
  }

  // ---- Reduced motion -----------------------------------------------------------------------
  {
    const r = await qa.open({ viewport: "laptop", path: "students/", reducedMotion: "reduce" });
    await r.waitForTimeout(500);
    const anim = await r.evaluate(() => getComputedStyle(document.querySelector(".ht-line")).animationName);
    check("reduced motion turns the landing animation off", anim === "none");
    check("reduced motion skips the gate", !(await r.evaluate(() => document.documentElement.hasAttribute("data-gate"))) && !(await r.isVisible(".gate")));
    check("reduced motion shows the numbers at once", (await r.$$eval("[data-count]", (n) => n.map((x) => x.textContent))).join() === "06,03,00,00");
    check("no console errors (reduced motion)", r.errors.length === 0);
  }
} finally {
  await qa.close();
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall students checks passed");
process.exitCode = failed ? 1 : 0;
