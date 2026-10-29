// Browser smoke test for Panalo Students (students/), against the mock.
//
//   node tools/qa/students.mjs                 # exits 1 on any failure
//   QA_SHOTS=/tmp/shots node tools/qa/students.mjs
//
// Covers the real flows end to end: sign-up and the setup, tasks and a
// focus session reaching the world, the calendar, the private archive,
// privacy and data, and the phone layout. Panalo Students is
// private: nothing in it is shown to anyone else, and the checks say so. Nothing here can reach a real Supabase project
// (see tools/qa/README.md).
import { launch, LEAKED_PASSWORD } from "./harness.mjs";
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
// Date of birth on the sign-up form (phase 22). `age` in whole years.
const fillBirth = async (page, age, prefix = "#signup-birth") => {
  await page.selectOption(`${prefix}-month`, "1");
  await page.fill(`${prefix}-year`, String(new Date().getFullYear() - age - 1));
};
// Where a page actually is, so a wait that times out is diagnosable.
const where = (page) =>
  page.evaluate(() => ({
    hash: location.hash,
    shown: ["landing", "auth", "setup", "app"].filter((id) => !document.getElementById(id).hidden),
    forms: [...document.querySelectorAll(".airlock-form")].filter((f) => !f.hidden).map((f) => f.id),
    message: document.getElementById("auth-message").textContent,
    body: document.body.className,
    busy: [...document.querySelectorAll("button[disabled]")].map((b) => b.id || b.textContent.trim().slice(0, 20)).slice(0, 6),
    fields: ["signup-username", "signup-email", "login-email"].map((id) => `${id}=${JSON.stringify(document.getElementById(id)?.value ?? null)}`),
    fieldLog: window.__fieldLog,
  })).then((w) => ({ ...w, navs: page.navs }));
const go = async (page, route, wait = 900) => {
  await page.evaluate((r) => (location.hash = r), route);
  await page.waitForTimeout(wait);
};

// The setup (v0.2): board, year, subjects, then Next through the rest.
async function finishSetup(page, { board = "Cambridge", stage = "AS", subjects = ["Physics", "Chemistry"] } = {}) {
  try {
    await page.waitForSelector("#setup:not([hidden]) #setup-form[data-step]", { timeout: 20000 });
  } catch (e) {
    // Say where we actually are, so a failure here is diagnosable.
    console.log("finishSetup: stuck at", await where(page), await page.evaluate(() => ({
      hash: location.hash,
      shown: ["landing", "auth", "setup", "app"].filter((id) => !document.getElementById(id).hidden),
      forms: [...document.querySelectorAll(".airlock-form")].filter((f) => !f.hidden).map((f) => f.id),
      message: document.getElementById("auth-message").textContent,
      body: document.body.className,
    })), page.errors);
    throw e;
  }
  const next = () => page.click("#setup-form button[type=submit]");
  const step = () => page.getAttribute("#setup-form", "data-step");
  await page.click(`#setup-form .setup-choice:has-text("${board}")`);
  await next();
  if ((await step()) === "stage") {
    await page.click(`#setup-form .setup-choice:has-text("${stage}")`);
    await next();
  }
  for (const name of subjects) await page.click(`#setup-form .setup-subjects .chip:has-text("${name}") >> nth=0`);
  await next();
  for (let i = 0; i < 12 && (await page.isVisible("#setup")); i++) {
    await next();
    await page.waitForTimeout(60);
  }
  await page.waitForSelector("#app:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(800);
}

const qa = await launch();
// Discovery moments are full-screen and would land in the middle of the
// older flows: every page starts with them seen,
// unless a test asks for them (storage: { "panalo.students.prefs": "{}" }).
const ALL_MOMENTS = ["first-focus", "focus-1", "focus-10", "focus-25", "focus-50", "focus-100", "focus-250", "tasks-1", "tasks-10", "tasks-50", "tasks-200", "first-aurora", "first-paper", "streak-7", "first-moon", "pages-1", "pages-7", "pages-30", "pages-100"];
const QUIET = { "panalo.students.prefs": JSON.stringify({ momentsSeen: ALL_MOMENTS }) };
const openPage = qa.open;
qa.open = (o = {}) => openPage({ ...o, storage: { ...QUIET, ...(o.storage || {}) } });
try {
  // ---- Outside, sign-up, the setup ----------------------------------------------
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

    check("no 0-to-100 gate holds the landing", !(await page.$(".gate")) && !(await page.evaluate(() => document.documentElement.hasAttribute("data-gate"))));
    // One look now: Panalo Night, with no switch to show.
    check("the landing opens in the Night look", (await page.evaluate(() => document.documentElement.dataset.look)) === "night");
    check("…with no look switch (there's one look)", !(await page.isVisible("#land-look-open")));
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
      want: [...document.querySelectorAll("#landing section[data-chapter]")].findIndex((x) => x.id === "numbers"),
    }));
    check("the HUD names the chapter you're in and its star is lit", hudState.name === "In numbers" && hudState.here === hudState.want && hudState.want > 2);
    check("the numbers count to their real values", hudState.counts.join() === "06,90,00,00");
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
    check("under 13 can't sign up", /13 and over/.test(await page.textContent("#auth-message")) && !(await page.isVisible("#setup")));
    await fillBirth(page, 24);
    await page.click("#signup-submit");
    await page.waitForTimeout(400);
    check("agreeing to the rules is required", /agree to the rules/.test(await page.textContent("#auth-message")));
    await page.check("#signup-age");
    await page.click("#signup-submit");
    await page.waitForSelector("#setup:not([hidden]) #setup-form[data-step]", { timeout: 20000 });
    check("a new account goes straight to the setup: no film, no gate", (await page.getAttribute("#setup-form", "data-step")) === "board" && !(await page.$(".film-out")));
    await page.click("#setup-form button[type=submit]");
    await page.waitForTimeout(200);
    check("the setup says what's missing instead of moving on", (await page.getAttribute("#setup-form", "data-step")) === "board" && /Choose your board/.test(await page.textContent(".toast").catch(() => "")));
    await page.click('#setup-form .setup-choice:has-text("Cambridge")');
    await page.click("#setup-form button[type=submit]");
    const stages = await page.locator("#setup-form .setup-choice b").allTextContents();
    check("Cambridge asks for the year: Grade 9, Grade 10, AS, A2", stages.join() === "Grade 9,Grade 10,AS,A2", stages.join());
    await page.click('#setup-form .setup-choice:has-text("AS")');
    await page.click("#setup-form button[type=submit]");
    const offered = await page.locator("#setup-form .setup-subjects .chip").allTextContents();
    check("AS offers its subjects with their syllabus codes", offered.some((t) => /Physics\s*9702/.test(t)) && offered.some((t) => /Psychology/.test(t)));
    await page.click('#setup-form .setup-subjects .chip:has-text("Physics")');
    await page.click('#setup-form .setup-subjects .chip:has-text("Chemistry")');
    await page.click("#setup-form button[type=submit]");
    await page.click('#setup-form .setup-level:has-text("Physics") .chip:has-text("Struggling")');
    await page.selectOption('#setup-form .setup-level:has-text("Chemistry") select', "b");
    await shot(page, "setup-levels");
    while ((await page.getAttribute("#setup-form", "data-step")) !== "tuition") {
      await page.click("#setup-form button[type=submit]");
      await page.waitForTimeout(60);
    }
    // The rest of the week: football on Tuesdays and Thursdays, 17:00-18:30.
    await page.click("#setup-add-activity");
    await page.fill('.setup-activity input[type="text"]', "Football");
    await page.click('.setup-activity .chip:has-text("Tue")');
    await page.click('.setup-activity .chip:has-text("Thu")');
    await page.fill("#setup-act-0-start", "17:00");
    await page.fill("#setup-act-0-end", "18:30");
    await page.click("#setup-form button[type=submit]");
    await page.waitForTimeout(80);
    check("the setup asks about sport, art and coaching at set times", (await page.getAttribute("#setup-form", "data-step")) === "exams");
    const soon = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
    await page.fill("#setup-exam-date", soon);
    await page.click("#setup-form .setup-exam-add button");
    check("an exam can be added in the setup", (await page.locator(".setup-exams li").count()) === 1);
    await page.click("#setup-form button[type=submit]");
    await page.waitForSelector("#app:not([hidden])", { timeout: 15000 });
    await page.waitForTimeout(800);
    const prof = await page.evaluate(() => window.__qa.db.student_profiles[0]);
    check("the setup saves the study profile", prof?.board === "cambridge" && prof.stage === "as" && prof.subjects.length === 2 && !!prof.setup_at, JSON.stringify(prof));
    check("…with how each subject is going", prof?.subjects.find((x) => x.id === "phy")?.level === 1 && prof?.subjects.find((x) => x.id === "chem")?.grade === "b");
    check("…and the school day", prof?.school_start === "08:10" && prof?.school_days.length === 5);
    check("…and the rest of the week", prof?.activities?.[0]?.name === "Football" && prof.activities[0].days.join() === "2,4" && prof.activities[0].start === "17:00", JSON.stringify(prof?.activities));
    check("an exam from the setup is on the calendar", await page.evaluate(() => window.__qa.db.student_events.some((e) => e.kind === "exam" && /Physics test/.test(e.title))));
    check("a new account lands on its plan, to check in on each subject", /Plan/.test(await page.title()) && (await page.isVisible("#plan-checkin")));
    check("the new account has encryption keys", await page.evaluate(() => window.__qa.db.user_keys.length === 2));

    // ---- The plan (v0.2) ----
    await go(page, "#/now");
    await page.waitForSelector(".now-log .plan-today, .now-log .panel-head h2:has-text(\"Today's plan\")", { timeout: 10000 }).catch(() => {});
    check("Now shows today's plan", /Today's plan/.test(await page.textContent(".now-log")));
    await go(page, "#/plan");
    await page.waitForSelector(":is(.pl-stage, .pl-hero) #plan-start", { timeout: 10000 });
    check("the plan leads with the next block", await page.isVisible("#plan-start"));
    check("the plan shows today, and other days when asked", (await page.locator(".pl-day").count()) === 1 && (await page.locator(".pl-day-chip").count()) === 6);
    await page.click(".pl-day-chip >> nth=1");
    check("…one day at a time", (await page.locator(".pl-day").count()) === 2);
    await page.click("#plan-days-all");
    check("…or the whole week", (await page.locator(".pl-day").count()) === 7 && /Only today/.test(await page.textContent("#plan-days-all")));
    check("each subject is a map of its topics, grey until met", (await page.locator(".pl-subject").count()) === 2 && (await page.locator(".pl-topic:not(.met)").count()) > 10);
    check("a new student's first block is a quick check", /Quick check/.test(await page.textContent(":is(.pl-stage, .pl-hero)")));
    check("the exam from the setup shows on its subject", /Exam in \d+ days/.test(await page.textContent(".pl-subjects")));
    await shot(page, "plan");
    await page.click("#plan-start");
    await page.waitForSelector(".block-check .bc-option", { timeout: 8000 });
    let asked = 0;
    for (let i = 0; i < 6 && (await page.isVisible(".block-check .bc-option:not(:disabled)")); i++) {
      await page.click(".block-check .bc-option[data-correct]");
      asked++;
      check(i === 0 ? "each answer is explained straight away" : "…every time", (await page.textContent(".bc-feedback")).length > 12);
      await page.click("#bc-next");
      await page.waitForTimeout(80);
    }
    await page.waitForSelector("#bc-done", { timeout: 8000 });
    check("a quick check asks a few questions and scores them", asked >= 2 && new RegExp(`${asked} of ${asked}`).test(await page.textContent(".block-check")));
    check("…and says what happens next", /You know this one/.test(await page.textContent(".bc-summary")));
    const topic = await page.evaluate(() => window.__qa.db.student_topics[0]);
    check("the check is saved to the topic", topic?.subject && topic.covered === 1 && topic.stability > 0, JSON.stringify(topic));
    check("the check counts as focus, on its topic", await page.evaluate(() => window.__qa.db.focus_sessions.some((s) => s.topic && s.completed)));
    await page.click("#bc-done");
    await page.waitForTimeout(300);
    check("the topic it checked is coloured in", (await page.locator(".pl-topics .pl-topic.met").count()) === 1);
    if (await page.isVisible("#plan-unsure")) {
      await page.click("#plan-unsure");
      await page.waitForSelector(".deck-card:not(.peek)");
      const first = await page.textContent(".deck-card:not(.peek) .deck-title");
      await page.click("#deck-skip");
      check("'Not now' shows the next option", (await page.textContent(".deck-card:not(.peek) .deck-title")) !== first);
      await page.click("#deck-pick");
      check("picking one counts down, and can be stopped", /Starting in 3/.test(await page.textContent(".deck-count")));
      await page.click("#deck-cancel");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    }
    await page.click("#plan-add-result");
    await page.fill("#res-title", "Mock, Paper 1");
    await page.fill("#res-score", "18");
    await page.fill("#res-out", "40");
    await page.click(".res-topics .res-topic input >> nth=0");
    const marked = await page.getAttribute(".res-topics .res-topic input >> nth=0", "value");
    const thetaOf = () => page.evaluate((id) => window.__qa.db.student_topics.find((t) => t.subject === "phy" && t.topic === id)?.theta ?? null, marked);
    const before = await thetaOf();
    await page.click(".sheet-foot .btn-primary");
    await page.waitForTimeout(400);
    check("a result can be added", await page.evaluate(() => window.__qa.db.student_results.some((r) => r.title === "Mock, Paper 1" && Number(r.score) === 18)));
    check("…and it shows on the plan", /Mock, Paper 1/.test(await page.textContent(".pl-results")));
    const after = await thetaOf();
    check("a poor mark lowers the topics it covered", after != null && (before == null ? after < 0 : after < before), `${before} → ${after}`);

    // ---- Check-in: past marks, then a check-over or chapter by chapter ----
    await page.click("#plan-checkin-start");
    await page.waitForSelector(".check-in #ci-exam-title");
    check("the check-in starts with past exams", /Check-in · Physics/.test(await page.textContent(".check-in h2")));
    await page.fill("#ci-exam-title", "Mid-term");
    await page.fill("#ci-exam-got", "41");
    await page.fill("#ci-exam-total", "50");
    await page.click("#ci-exam-add");
    check("…a mark can be added (total and got)", /Mid-term\s*41\/50/.test(await page.textContent("#ci-marks")));
    await page.click("#ci-next");
    await page.click('.ci-taught .chip[data-value="0.5"]');
    await page.click('.ci-feel .chip[data-value="weak"]');
    check("a quick check-over is enough to save", !(await page.isDisabled("#ci-next")));
    await page.click('.ci-ways .chip[data-value="chapters"]');
    const chapters = await page.locator(".ci-chapter").count();
    check("chapter by chapter is optional, and starts from the check-over", chapters > 5 && (await page.locator('.ci-chapter .chip[data-value="untaught"][aria-checked="true"]').count()) > 0 && !(await page.isDisabled("#ci-next")));
    await page.click('.ci-chapter >> nth=0 >> .chip[data-value="okay"]');
    await page.click(".ci-chapter >> nth=0 >> .ci-quick-btn");
    for (let i = 0; i < 3 && (await page.isVisible(".ci-chapter >> nth=0 >> .bc-option")); i++) await page.click(".ci-chapter >> nth=0 >> .bc-option[data-correct]");
    check("…with an optional quick check that corrects the rating", /3 of 3 right/.test(await page.textContent(".ci-chapter >> nth=0 >> .ci-verdict")) && (await page.getAttribute('.ci-chapter >> nth=0 >> .chip[aria-checked="true"]', "data-value")) === "strong");
    await page.click("#ci-next");
    await page.waitForSelector(".check-in h2:has-text('Chemistry')", { timeout: 15000 }).catch(() => {});
    check("checking in on all goes on to the next subject", /Chemistry/.test(await page.textContent(".check-in h2")));
    await page.click("#ci-next");
    await page.click('.ci-taught .chip[data-value="1"]');
    await page.click('.ci-feel .chip[data-value="strong"]');
    await page.click("#ci-next");
    await page.waitForTimeout(600);
    const phy = await page.evaluate(() => window.__qa.db.student_topics.filter((t) => t.subject === "phy"));
    check("the check-in is saved to every topic", phy.length >= chapters && phy.some((t) => Number(t.covered) === 0) && phy.some((t) => Number(t.covered) === 1));
    check("…the exam mark with it", await page.evaluate(() => window.__qa.db.student_results.some((r) => r.title === "Mid-term" && r.subject === "phy" && Number(r.out_of) === 50)));
    check("once every subject is checked in, the card goes", !(await page.isVisible("#plan-checkin")) && /not taught yet/.test(await page.textContent(".pl-subjects")));
    check("untaught chapters get learn blocks", /Learn/.test(await page.textContent(".pl-week")));
    check("a check-in can be redone any time", (await page.locator(".pl-checkin [data-checkin]").count()) === 2);

    // ---- Papers: which ones, when; exam-style questions; past-paper marks ----
    const subj = await page.evaluate(() => window.__qa.db.student_profiles.find((r) => r.setup_at)?.subjects || []);
    check("the setup chose each subject's usual papers", subj.find((x) => x.id === "phy")?.papers?.join() === "1,2,3" && subj.find((x) => x.id === "chem")?.papers?.join() === "1,2,3", JSON.stringify(subj));
    await page.click('[data-papers="phy"]');
    await page.waitForSelector(".papers-sheet #pp-date-2");
    await page.click('.papers-sheet .pp-paper[data-paper="3"]');
    await page.click('.papers-sheet .pp-series .chip >> nth=1');
    await page.fill("#pp-date-2", "2027-03-04");
    await page.click("#pp-save");
    await page.waitForTimeout(500);
    const phySaved = await page.evaluate(() => window.__qa.db.student_profiles.find((r) => r.setup_at).subjects.find((x) => x.id === "phy"));
    check("a subject's papers, series and dates can be changed", phySaved.papers.join() === "1,2" && /^20\d\d-(fm|mj|on)$/.test(phySaved.series) && phySaved.dates?.["2"] === "2027-03-04", JSON.stringify(phySaved));
    check("…and the subject says when its paper is", /Paper 2 (in \d+ days|today|tomorrow)/.test(await page.textContent('.pl-subject:has([data-papers="phy"]) .pl-papers-line')));
    await page.click('[data-questions="phy"]');
    await page.waitForSelector(".exam-questions .xq-item");
    const twoMark = await page.click('.xq-marks .chip[data-value="1"]').then(() => page.locator(".xq-item").count());
    check("exam-style questions can be picked by their marks", twoMark > 0 && (await page.$$eval(".xq-item .xq-meta b", (b) => b.every((x) => /\[[12]\]/.test(x.textContent)))));
    await page.click('.xq-marks .chip[data-value="all"]');
    await page.click('.xq-item:has-text("circuit")');
    await page.waitForFunction(() => document.querySelector(".xq-fig img")?.naturalWidth > 0, null, { timeout: 5000 }).catch(() => {});
    check("a question can show its diagram", await page.isVisible(".xq-fig img"));
    check("the examiners' advice is beside the question", (await page.locator(".xq-tips li").count()) > 0);
    // Mark a photo: Pan (stubbed here) ticks the points it saw; the student can change them.
    let markBody = null;
    await page.route("**/api/mark", async (route) => {
      markBody = JSON.parse(route.request().postData() || "{}");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ legible: true, points: [{ earned: true, note: "Correct equation" }, { earned: true, note: "Substituted" }, { earned: false, note: "Unit missing" }, { earned: false, note: "" }], examiner: "Clear working; the unit was left off the answer.", next: "Always finish with a unit." }) });
    });
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await page.setInputFiles("#xq-photo", { name: "answer.png", mimeType: "image/png", buffer: png });
    await page.waitForSelector(".xq-verdict:not([hidden])", { timeout: 5000 }).catch(() => {});
    check("a photo of the answer is marked against the scheme", markBody?.scheme?.length === 4 && /^[A-Za-z0-9+/]+=*$/.test(markBody.image || "") && markBody.tips?.length > 0, JSON.stringify(markBody)?.slice(0, 200));
    check("…its marks are ticked, with an examiner's comment", (await page.isChecked("#xq-pt-0")) && (await page.isChecked("#xq-pt-1")) && !(await page.isChecked("#xq-pt-2")) && /unit was left off/.test(await page.textContent(".xq-verdict")));
    await page.unroute("**/api/mark");
    check("the mark scheme lists each mark", (await page.locator(".xq-points li").count()) === 4);
    await page.check("#xq-pt-2");
    await page.click("#xq-save");
    await page.waitForTimeout(500);
    const dc = await page.evaluate(() => window.__qa.db.student_topics.find((t) => t.subject === "phy" && t.topic === "10"));
    check("marking yourself moves the topic", dc && Number(dc.covered) === 1 && dc.stability > 0, JSON.stringify(dc));
    const qlog = await page.evaluate(() => window.__qa.db.activity_log.find((l) => l.kind === "questions"));
    check("…and the marks are kept for the world", qlog?.marks === 3 && qlog?.out_of === 4 && qlog.minutes === 6, JSON.stringify(qlog));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.click('[data-pastpaper="phy"]');
    await page.waitForSelector("#pp-got");
    await page.selectOption("#pp-paper", "2");
    await page.fill("#pp-which", "Feb/Mar 2025, 22");
    await page.fill("#pp-got", "45");
    await page.click("#pp-marks-save");
    await page.waitForTimeout(600);
    check("a past paper's marks are saved, on its paper", await page.evaluate(() => window.__qa.db.student_results.some((r) => r.subject === "phy" && r.title === "Paper 2 · Feb/Mar 2025, 22" && Number(r.out_of) === 60 && Number(r.score) === 45)));
    // Customize (phase 32): tell Pan, or set it yourself. Pan's function
    // isn't served here, so the app understands the sentence itself.
    const rulesOf = () => page.evaluate(() => window.__qa.db.student_profiles.find((r) => r.setup_at)?.plan_rules || {});
    await page.click("#plan-customize");
    await page.waitForSelector("dialog.customize[open] #cz-text", { timeout: 5000 }).catch(() => {});
    check("the plan can be customized: tell Pan, or set it yourself", (await page.isVisible("#cz-text")) && (await page.isVisible("#cz-day-0")));
    await page.fill("#cz-text", "Sundays off and more physics");
    await page.click("#cz-ask");
    await page.waitForSelector("#cz-apply", { timeout: 8000 }).catch(() => {});
    check("Pan shows what it will change before changing it", /Sundays off/.test(await page.textContent("#cz-preview")) && /Physics: more/.test(await page.textContent("#cz-preview")) && !(await rulesOf()).off);
    await page.click("#cz-apply");
    await page.waitForTimeout(500);
    let rules = await rulesOf();
    check("…and applies it when asked", rules.off?.includes(0) && rules.weight?.phy === 1.5, JSON.stringify(rules));
    await page.selectOption("#cz-day-6", "60");
    await page.waitForTimeout(400);
    rules = await rulesOf();
    check("a day can be capped by hand", rules.minutes?.[6] === 60, JSON.stringify(rules));
    check("your changes are listed, each undoable", (await page.locator("#cz-list li").count()) >= 3);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const sunday = await page.evaluate(() => document.querySelector('.pl-day[data-weekday="0"]')?.textContent || "");
    check("the week follows them: Sunday is a day off", /day off/.test(sunday) && /Your changes/.test(await page.textContent("#plan-own")), sunday.slice(0, 80));
    await page.click(".pl-day:not(.today):not(.off) .pl-more");
    await page.waitForSelector("#blk-skip", { timeout: 5000 }).catch(() => {});
    check("a block can be skipped or pulled into today", (await page.isVisible("#blk-skip")) && (await page.isVisible("#blk-today")));
    await page.click("#blk-skip");
    await page.waitForTimeout(400);
    check("…and skipping it is saved", (await rulesOf()).skips?.length === 1);
    // A busy day: one tap takes today off, and the plan says so.
    await page.click("#plan-busy-today");
    await page.waitForTimeout(400);
    check("busy today? one tap takes it off", (await rulesOf()).dates?.[await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })]?.off === true && /day off/.test(await page.textContent(".pl-day.today .pl-day-head")));
    // Football is on Tuesdays and Thursdays; at least one of them isn't today.
    const footballDay = await page.evaluate(() => [...document.querySelectorAll('.pl-day:not(.today):is([data-weekday="2"], [data-weekday="4"]) .pl-day-head')].map((h) => h.textContent).join(" | "));
    check("football's times are kept clear", /taken/.test(footballDay), footballDay);
    await page.click("#plan-customize");
    await page.waitForSelector("#cz-one-date", { timeout: 5000 }).catch(() => {});
    const crashDay = await page.evaluate(() => { const d = new Date(Date.now() + 2 * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
    await page.fill("#cz-one-date", crashDay);
    await page.selectOption("#cz-one-what", "crash");
    await page.click("#cz-one-add");
    await page.waitForTimeout(400);
    check("a day can be made a crash day", (await rulesOf()).dates?.[crashDay]?.crash === true);
    await page.waitForSelector("#cz-reset", { timeout: 5000 }).catch(() => {});
    await page.click("#cz-reset");
    await page.waitForTimeout(400);
    rules = await rulesOf();
    check("reset puts the plan back as the planner made it", !rules.off?.length && !Object.keys(rules.weight || {}).length && !rules.skips?.length, JSON.stringify(rules));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await go(page, `#/study/block=${encodeURIComponent("chem~1~learn~25")}`);
    await page.waitForSelector("#study-pause", { timeout: 8000 }).catch(() => {});
    check("a planned block starts in the Study Room, saying what it is", (await page.isVisible("#study-pause")) && /Learn/.test(await page.textContent(".study-block")) && (await page.inputValue(".study-subject")) === "Chemistry");
    await shot(page, "study-block");
    await page.click(".study-controls .btn-quiet");
    await page.waitForTimeout(300);
    await page.close();
  }

  // ---- The seeded account: study, world, calendar ----------------------------------
  const page = await qa.open({ viewport: "desktop", path: "students/#login" });
  await page.evaluate(() => window.__qa.ready);
  await appReady(page);
  await page.fill("#login-email", "qa@panalo.test");
  await page.fill("#login-password", "wrong-password");
  await page.click("#login-submit");
  await page.waitForFunction(() => /\S/.test(document.querySelector("#auth-message")?.textContent || ""), null, { timeout: 8000 }).catch(() => {});
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
  await finishSetup(page);
  check("you can log in with your username", await page.isVisible("#app"));
  await go(page, "#/now");
  check("Now shows the day orbit", await page.isVisible(".orbit-svg"));
  check("Panalo Students is private: no chat, no Signals, nothing from other people", !(await page.isVisible("a[data-route=signals]")) && !(await page.textContent(".now-log")).includes("Signals"));
  check("Now leads with the next step, one tap from a focus block", (await page.isVisible(".now-step")) && /Next step/.test(await page.textContent(".now-step")));
  check("Panalo is calm by default: no drifting decoration", (await page.evaluate(() => document.documentElement.dataset.effects)) === "calm" && !(await page.isVisible(".fx-ambient")));
  const order = await page.evaluate(() => [...document.querySelectorAll(".now-log .panel-head h2")].map((h) => h.textContent));
  check("the work comes first on Now", order.indexOf("Due soon") > -1 && order.indexOf("Due soon") < order.findIndex((h) => !/Today|Now|Next|Focus|Due/.test(h)));
  await shot(page, "now");
  // Left alone, Now fades to just the world; any movement brings it back.
  await page.evaluate(() => (window.__qa.idleMs = 400));
  await page.mouse.move(5, 5);
  await page.waitForTimeout(900);
  check("left alone, Now fades to just your world", await page.evaluate(() => document.querySelector(".now")?.classList.contains("is-idle")));
  await page.mouse.move(40, 40);
  await page.waitForTimeout(50);
  check("…and any movement brings it back", await page.evaluate(() => !document.querySelector(".now").classList.contains("is-idle")));
  await page.evaluate(() => (window.__qa.idleMs = 0));

  await go(page, "#/study");
  await page.fill(".task-form input[type=text]", "Finish optics problem set");
  await page.click(".task-form button[type=submit]");
  await page.waitForTimeout(400);
  check("a task can be added", await page.isVisible(".task-list >> text=Finish optics problem set"));
  await page.fill(".study-subject", "Physics");
  await page.click("#study-start");
  await page.waitForTimeout(400);
  check("the focus timer starts", await page.isVisible("#study-pause"));
  // The focus shield: elsewhere in the app, the block still comes first.
  await go(page, "#/now");
  const shield = await page.evaluate(() => ({
    focusing: document.documentElement.classList.contains("focusing"),
    line: ((l) => (l && getComputedStyle(l).display !== "none" ? l.textContent : ""))(document.querySelector(".focus-line")),
    step: document.querySelector(".now-step")?.textContent || "",
  }));
  check("while focusing, other pages show one quiet line back to the block", shield.focusing && /Focusing on Physics/.test(shield.line) && /min left/.test(shield.line));
  check("…and Now's next step is the block itself", /Focusing/.test(shield.step) && /Back to it/.test(shield.step));
  await go(page, "#/study");
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
  check("only studying grows the world: no activity logging", !(await page.isVisible("text=Log an activity")) && /Only studying grows it/.test(await page.textContent(".world .s-sub")));
  check("the legend explains each feature as study", /Forests\s*Chapters covered/.test(legend) && /Aurora\s*Marks earned/.test(legend) && /Atmosphere\s*Past papers/.test(legend));
  check("the first session is a discovery", /First session/.test(await page.textContent(".world-lower")));
  await shot(page, "world");

  check("the world shows no one else: no friends, no cities", !(await page.isVisible("#friends-globe")) && (await page.locator(".beacon").count()) === 0);

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

  // ---- Nothing social: an old link to Signals or a room lands on Now --------------------
  await go(page, "#/signals/join", 900);
  check("an old link to Signals or a room opens Now instead", (await page.evaluate(() => document.body.dataset.view)) === "now" && !(await page.isVisible("dialog[open]")));

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
  check("it is catalogued with its type, size and date", /optics-notes\.md/.test(await page.textContent(".artifacts")) && /Added /.test(await page.textContent(".artifacts")));
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

  // ---- Warp and privacy -----------------------------------------------------------------
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(300);
  await page.fill(".warp-input", "privacy");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  check("Warp jumps anywhere by typing", /Privacy/.test(await page.title()) && /Yours, and only yours/.test(await page.textContent("[data-surface=safety] h1")));
  check("Privacy & data has no blocking or reports: there's nobody to block", !(await page.isVisible("[data-surface=safety] >> text=Blocked")) && !(await page.isVisible("[data-surface=safety] >> text=Reports you've sent")));

  // ---- The look: Panalo Night (Glass, Signal and Verse are retired) ---------------
  check("the look is Panalo Night", (await page.evaluate(() => document.documentElement.dataset.look)) === "night");
  check("there's no look switch in the bar (one look)", !(await page.isVisible("#look-open")));
  await page.evaluate(() => (location.hash = "#/settings"));
  await page.waitForTimeout(900);
  check("Settings has no look picker while there's one look", (await page.locator(".settings-look").count()) === 0);
  const livelyBox = page.locator("label.setting", { hasText: "Lively effects" }).locator("input");
  check("Lively effects are off until you turn them on", !(await livelyBox.isChecked()));
  // Wait for the effect, not the checkbox. The switch sits low on the page,
  // where the yearly rules card and toasts appear: bring it to the middle
  // first, and if a click still goes astray, say what was under it.
  const effectsBecome = (v) => page.waitForFunction((x) => document.documentElement.dataset.effects === x, v, { timeout: 3000 }).then(() => true, () => false);
  const flipLively = async () => {
    const box = page.locator("label.setting", { hasText: "Lively effects" }).locator("input");
    await box.evaluate((b) => b.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(300);
    await box.click();
  };
  const whatsThere = () => page.evaluate(() => {
    const b = [...document.querySelectorAll("label.setting")].find((l) => /Lively/.test(l.textContent))?.querySelector("input");
    const r = b?.getBoundingClientRect();
    const hit = r && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return `checked=${b?.checked} effects=${document.documentElement.dataset.effects} under=${hit ? `${hit.tagName}.${hit.className}` : "none"}`;
  });
  await flipLively();
  const on = await effectsBecome("lively");
  check("turning on lively effects applies at once", on);
  if (!on) console.log("  lively switch:", await whatsThere());
  await flipLively();
  const off = await effectsBecome("calm");
  check("and turning them off makes Panalo still again", off);
  if (!off) console.log("  lively switch:", await whatsThere());
  await page.evaluate(() => (location.hash = "#/now"));
  await page.waitForTimeout(900);
  check("Today opens on the climb: the photo, with a ring for today's plan", await page.isVisible(".today-hero .climb-ring") && /Today's\s*climb/.test(await page.textContent(".today-hero h2")));
  check("…and the ember wallpaper is gone", await page.evaluate(() => [...document.querySelectorAll(".wall")].every((w) => getComputedStyle(w).display === "none")));

  // Reload: the session, the world and the data survive.
  await page.reload();
  await page.waitForSelector("#app:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(800);
  check("the session and data survive a reload", /Kepler QA|alex/.test(await page.textContent("#me-menu")) && (await page.evaluate(() => window.__qa.db.focus_sessions.length)) === 1);
  check("Night is set before the first paint after a reload", (await page.evaluate(() => document.documentElement.dataset.look)) === "night");
  // A retired look saved before the redesign opens as Night.
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("panalo.students.prefs") || "{}");
    localStorage.setItem("panalo.students.prefs", JSON.stringify({ ...p, look: "verse" }));
  });
  await page.reload();
  await page.waitForSelector("#app:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(600);
  check("a saved Verse look opens as Night", (await page.evaluate(() => document.documentElement.dataset.look)) === "night");
  // Details: the nav's marker sits under the page you're on, and moves with you.
  await page.evaluate(() => (location.hash = "#/calendar"));
  await page.waitForTimeout(900);
  const ink = await page.evaluate(() => {
    const i = document.querySelector(".bar-nav .nav-ink.on");
    const a = document.querySelector('.bar-nav [aria-current="page"]');
    if (!i || !a) return null;
    const ib = i.getBoundingClientRect(), ab = a.getBoundingClientRect();
    return { dx: Math.abs(ib.left - ab.left), dw: Math.abs(ib.width - ab.width) };
  });
  check("the nav's marker glides to the page you're on", !!ink && ink.dx < 3 && ink.dw < 3);
  check("the bar's clock has a colon a look can blink", await page.evaluate(() => !!document.querySelector("#bar-clock .clock-colon")));
  check("a line under the bar shows how far down the page you are", await page.evaluate(() => !!document.querySelector(".read-line")));

  // Section features.
  await page.evaluate(() => (location.hash = "#/now"));
  await page.waitForTimeout(900);
  await page.fill(".capture-input", "Chemistry worksheet tomorrow");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  const captured = await page.evaluate(() => window.__qa.db.student_tasks.find((t) => t.title === "Chemistry worksheet"));
  check("Now captures a task in one line, its date read from the words", !!captured && !!captured.due_at && new Date(captured.due_at).getDate() === new Date(Date.now() + 86400000).getDate());
  await page.evaluate(() => (location.hash = "#/study"));
  await page.waitForTimeout(900);
  check("the Study Room's tasks are a numbered checklist you can reorder", await page.evaluate(() => !!document.querySelector("ol.task-list.marks-numbers .task-mark") && !!document.querySelector(".task-tools .seg")));
  await page.click('.seg-btn[aria-label="Bulleted"]');
  check("the checklist can switch to bullets", await page.evaluate(() => document.querySelector(".task-list:not(.done-list) .task-mark")?.textContent === "•"));
  await page.click('.seg-btn[aria-label="Numbered"]');
  await page.evaluate(() => (location.hash = "#/calendar"));
  await page.waitForTimeout(900);
  await page.click('[data-view-btn="month"]');
  check("Calendar has a month view", (await page.locator(".month-day").count()) === 42);
  await page.click('[data-view-btn="day"]');
  // Nothing anywhere prints a stray null, undefined or NaN.
  const stray = [];
  for (const r of ["now", "plan", "study", "world", "calendar", "archive", "safety", "settings"]) {
    await page.evaluate((r) => (location.hash = `#/${r}`), r);
    await page.waitForTimeout(700);
    const t = await page.evaluate((r) => document.querySelector(`.surface[data-surface="${r}"]`)?.innerText || "", r);
    if (/\b(null|undefined|NaN)\b/.test(t)) stray.push(r);
  }
  check(`no page prints a stray null, undefined or NaN${stray.length ? ` (${stray.join(", ")})` : ""}`, !stray.length);
  // The 12-hour clock applies everywhere: plan, Now's orbit, Settings.
  await go(page, "#/settings");
  await page.locator('label.setting:has-text("12-hour clock") input').check();
  await page.waitForTimeout(300);
  const ampm = /\d (am|pm)/;
  check("the 12-hour clock shows on the study profile", ampm.test(await page.textContent(".surface[data-surface=settings]")));
  await go(page, "#/plan");
  await page.waitForSelector(":is(.pl-stage, .pl-hero)", { timeout: 10000 }).catch(() => {});
  check("…on the plan", ampm.test(await page.textContent(".surface[data-surface=plan]")) && !/\b\d\d:\d\d\b(?! ?[ap]m)/.test(await page.textContent(":is(.pl-stage, .pl-hero)")));
  await go(page, "#/now");
  check("…and on Now's day orbit", (await page.locator(".orbit-label").allTextContents()).includes("6 am"));
  await go(page, "#/settings");
  await page.locator('label.setting:has-text("12-hour clock") input').uncheck();
  await page.waitForTimeout(300);
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
    await finishSetup(m);
    check("the phone dock is shown", await m.isVisible(".dock"));
    check("the top navigation gives way to it", !(await m.isVisible(".bar-nav")));
    await m.click(".dock a[data-route=calendar]");
    await m.waitForTimeout(900);
    check("the dock goes to Calendar", (await m.evaluate(() => document.body.dataset.view)) === "calendar");
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check("nothing scrolls sideways", !overflow);
    await shot(m, "phone-calendar");
    await m.click(".dock a[data-route=plan]");
    await m.waitForSelector(":is(.pl-stage, .pl-hero)", { timeout: 10000 }).catch(() => {});
    check("the dock goes to Plan", (await m.evaluate(() => document.body.dataset.view)) === "plan" && (await m.isVisible(":is(.pl-stage, .pl-hero)")));
    check("the plan fits a phone: nothing scrolls sideways", !(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
    await m.waitForTimeout(900);
    await shot(m, "phone-plan");
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
    await d.waitForSelector(".dawn", { timeout: 15000 }).catch(async () => console.log("dawn: not shown", await where(d), d.errors));
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
    await d.fill("input[aria-label='One thing you learned']", "Light bends more in glass than in water");
    await d.click("#checkin-save");
    await d.waitForTimeout(700);
    const closed = await d.evaluate(() => {
      const today = new Date().toLocaleDateString("en-CA");
      const e = window.__qa.db.daily_entries.find((x) => x.day === today);
      return { mood: e?.mood, energy: e?.energy, closed: !!e?.closed_at, learned: e?.learned, read: window.__qa.db.activity_log.filter((l) => l.kind === "read" && l.occurred_on === today).reduce((n, l) => n + l.minutes, 0) };
    });
    check("closing the day keeps mood, energy and what you learned", closed.closed && closed.mood === 4 && closed.energy === 3 && /glass/.test(closed.learned || ""));
    check("closing the day logs nothing to the world (only studying grows it)", closed.read === 0 && !(await d.isVisible(".checkin-acts")));
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

  // ---- The dawn and moments (batch 2) -------------------------------------------------------
  {
    const w = await qa.open({ viewport: "laptop", path: "students/#login", qa: { dawn: true }, storage: { "panalo.students.prefs": "{}" } });
    await w.evaluate(() => window.__qa.ready);
    await appReady(w);
    await w.fill("#login-email", "qa@panalo.test");
    await w.fill("#login-password", "correct-horse-42");
    await w.click("#login-submit");
    await w.waitForSelector(".dawn", { timeout: 15000 }).catch(async () => console.log("dawn (2): not shown", await where(w), w.errors));
    check("the dawn shows today's date, and no seasons", /\d/.test(await w.textContent(".dawn-date").catch(() => "")) && !/Season/.test(await w.textContent(".dawn-date").catch(() => "")));
    await w.click(".dawn-skip");
    await w.waitForTimeout(800);
    check("no weekly film follows the dawn", !(await w.$(".story")));

    // Closing today is a first page this session... last week's was the first; a
    // moment for a fresh discovery: finishing a first task today isn't one either,
    // so make one: a moon, completed.
    await go(w, "#/world", 1000);
    check("World has no seasons, time-lapse or chronicle", !(await w.$(".season-line")) && !(await w.$("#world-timelapse")) && !(await w.$("#world-chronicle")));
    await w.click("text=Add a moon");
    await w.click(".sheet .chip >> text=A milestone");
    await w.fill(".sheet input[placeholder^='e.g.']", "Finish the robotics demo");
    await w.click(".sheet .btn-primary");
    await w.waitForTimeout(500);
    // Centre it first: scrolled only "into view", it can land under the
    // fixed bar or the rules card, and the panel is still sliding in.
    await w.evaluate(() => [...document.querySelectorAll(".moons button, .moons a")].find((b) => /Mark done/.test(b.textContent))?.scrollIntoView({ block: "center" }));
    await w.waitForTimeout(800);
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
    check("each moment plays once", !(await w.isVisible(".moment")));

    check("no console errors (batch 2)", w.errors.length === 0);
    if (w.errors.length) console.log(w.errors.join("\n"));
    await w.close();
  }

  // ---- Surface upgrades: calendar, study, archive (batch 3) ----------------------------------
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
    // An address that already has an account gets no code: say so, and
    // send them to log in instead of waiting for an email that never comes.
    await a.fill("#signup-email", "qa@panalo.test");
    await a.click("#signup-submit");
    await a.waitForSelector("#login-form:not([hidden])", { timeout: 5000 }).catch(() => {});
    check("signing up with a registered email points to log in, not a code", (await a.isVisible("#login-form")) && !(await a.isVisible("#otp-form")) && /already has a Panalo account/.test(await a.textContent("#auth-message")) && (await a.inputValue("#login-email")) === "qa@panalo.test");
    await a.evaluate(() => (location.hash = "#signup"));
    await a.waitForSelector("#signup-form:not([hidden])", { timeout: 5000 }).catch(() => {});
    await a.fill("#signup-email", "two@panalo.test");
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
    await a.fill("#otp-code", "654321");
    await a.click("#otp-submit");
    await a.waitForTimeout(500);
    check("a wrong code is explained plainly", /wrong or has expired/.test(await a.textContent("#auth-message")));
    await a.fill("#otp-code", "123 456");
    await a.click("#otp-submit");
    await a.waitForSelector("#setup:not([hidden])", { timeout: 15000 }).catch(() => {});
    check("the code leads into the setup (pasted with a space)", await a.isVisible("#setup"));
    await a.close();

    const b = await qa.open({ viewport: "laptop", path: "students/#login" });
    await b.evaluate(() => window.__qa.ready);
    await appReady(b);
    await b.fill("#login-email", "qa@panalo.test");
    await b.fill("#login-password", "correct-horse-42");
    await b.click("#login-submit");
    await finishSetup(b);
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

    // An old invite link is just the landing now: there are no rooms.
    await b.goto(`${qa.base}students/#join=ABCD2345`);
    await b.waitForTimeout(600);
    check("an old invite link opens the landing, not a room", (await b.isVisible("#landing")) && !/room/.test(await b.textContent("#auth-message")));
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

  // ---- With Panalo Chat's service worker in control ---------------------------------------------
  // Chat registers ../sw.js for the whole site, so it can control Students
  // too. The site's CSP applies to the worker: anything it fetches from
  // another origin (the Supabase library on the CDN) is refused, and the
  // page gets nothing. So the worker leaves other origins alone, and a
  // reload under it starts the app as normal.
  {
    const sw = await qa.open({ viewport: "laptop", path: "", serviceWorkers: "allow" });
    await sw.evaluate(() => navigator.serviceWorker.ready);
    await sw.goto(new URL("students/", sw.url()).href);
    await sw.reload();
    await sw.waitForTimeout(1500);
    const s = await sw.evaluate(() => ({ controlled: !!navigator.serviceWorker.controller, started: document.querySelectorAll(".thread-stars li").length > 0 && !!document.querySelector("#hero-globe")?.dataset.renderer }));
    check("under the service worker, a reload starts Students as normal", s.controlled && s.started);
    await sw.close();
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
    await finishSetup(d);
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
    await finishSetup(p);
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

  // ---- Other subjects: added by name and code; Pan finds the syllabus (phase 35) ----------
  {
    const o = await qa.open({ viewport: "laptop", path: "students/#signup" });
    await o.evaluate(() => window.__qa.ready);
    await appReady(o);
    let asked = null;
    await o.route("**/api/pan-subject", async (route) => {
      asked = JSON.parse(route.request().postData() || "{}");
      if (/history/i.test(asked.name)) return route.fulfill({ status: 501, contentType: "application/json", body: '{"error":"pan-not-configured"}' });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ known: true, name: "Marine Science", code: "9693", board: "Cambridge International AS & A Level", note: "Found it.", topics: [{ name: "Scientific method", stage: "as" }, { name: "Marine ecosystems and biodiversity", stage: "as" }, { name: "Fisheries for the future", stage: "a2" }] }) });
    });
    await o.fill("#signup-username", "other_q");
    await o.fill("#signup-email", "other@panalo.test");
    await o.fill("#signup-password", "a-long-enough-pass");
    await fillBirth(o, 17);
    await o.check("#signup-age");
    await o.click("#signup-submit");
    await o.waitForSelector("#setup:not([hidden]) #setup-form[data-step]", { timeout: 20000 });
    await o.click('#setup-form .setup-choice:has-text("Cambridge")');
    await o.click("#setup-form button[type=submit]");
    await o.click('#setup-form .setup-choice:has-text("AS")');
    await o.click("#setup-form button[type=submit]");
    await o.click('#setup-form .setup-subjects .chip:has-text("Physics") >> nth=0');
    await o.click("#setup-other");
    check("subjects have an Other subject choice", await o.isVisible("#other-name"));
    await o.fill("#other-name", "Further Mathematics");
    await o.click("#other-add");
    check("a listed subject typed as Other points back to the list", (await o.locator(".setup-custom [data-custom]").count()) === 0 && /in the list above/.test(await o.textContent("#toast-region, .toasts, body")));
    await o.fill("#other-name", "Marine Sci");
    await o.fill("#other-code", "9693");
    await o.click("#other-add");
    await o.waitForSelector('.setup-custom [data-custom] >> text=topics', { timeout: 8000 }).catch(() => {});
    check("Pan is asked with the subject, its code and the year", asked?.name === "Marine Sci" && asked?.code === "9693" && /AS/.test(asked?.year || ""), JSON.stringify(asked));
    check("…and says what it found", /Pan found .*9693.*3 topics/.test(await o.textContent(".other-status")) && /3 topics/.test(await o.textContent(".setup-custom")));
    await o.fill("#other-name", "World History");
    await o.click("#other-add");
    await o.waitForTimeout(500);
    check("without Pan, the subject is still added, as your own work", (await o.locator(".setup-custom [data-custom]").count()) === 2 && /own work/.test(await o.textContent(".other-status")));
    for (let i = 0; i < 14 && (await o.isVisible("#setup")); i++) {
      await o.click("#setup-form button[type=submit]", { timeout: 3000 }).catch(() => {});
      await o.waitForTimeout(60);
    }
    await o.waitForSelector("#app:not([hidden])", { timeout: 15000 });
    const row = await o.evaluate(() => window.__qa.db.student_profiles.find((r) => r.setup_at));
    const fm = row.subjects.find((x) => x.custom && x.code === "9693");
    check("other subjects are saved with their name and code", fm?.name === "Marine Sci" && row.subjects.some((x) => x.custom && x.name === "World History"), JSON.stringify(row.subjects));
    check("…and Pan's syllabus with them", row.custom_syllabi?.[fm?.id]?.topics?.length === 3);
    await go(o, "#/plan", 1200);
    const card = `.pl-subject:has([data-syllabus="${fm.id}"])`;
    check("the plan works through the other subject's topics", (await o.locator(`${card} .pl-topic`).count()) === 2 && /Pan found/.test(await o.textContent(`${card} .pl-papers-line`)));
    check("an other subject without topics is your own work", /own work/.test(await o.textContent('.pl-subject:has-text("World History")')));
    await o.click(`[data-syllabus="${fm.id}"]`);
    await o.waitForSelector("#cs-topics input");
    await o.fill("#cs-topics li:nth-child(2) input", "Marine ecosystems");
    await o.click("#cs-add");
    await o.fill("#cs-topics li:last-child input", "Matrices");
    await o.click("#cs-save");
    await o.waitForTimeout(500);
    const after = await o.evaluate((id) => window.__qa.db.student_profiles.find((r) => r.setup_at).custom_syllabi[id].topics, fm.id);
    check("its topics can be checked and changed, keeping their ids", after.length === 4 && after[1].id === "c2" && after[1].name === "Marine ecosystems" && after[3].name === "Matrices", JSON.stringify(after));
    check("no console errors (other subjects)", o.errors.length === 0);
    if (o.errors.length) console.log(o.errors.join("\n"));
    await o.close();
  }

  // ---- A boarder: study times, weekends, and the journey (phase 36) ----------------------
  {
    const b = await qa.open({ viewport: "laptop", path: "students/#signup" });
    await b.evaluate(() => window.__qa.ready);
    await appReady(b);
    await b.fill("#signup-username", "board_q");
    await b.fill("#signup-email", "board@panalo.test");
    await b.fill("#signup-password", "a-long-enough-pass");
    await fillBirth(b, 17);
    await b.check("#signup-age");
    await b.click("#signup-submit");
    await b.waitForSelector("#setup:not([hidden]) #setup-form[data-step]", { timeout: 20000 });
    await b.click('#setup-form .setup-choice:has-text("Cambridge")');
    await b.click("#setup-form button[type=submit]");
    await b.click('#setup-form .setup-choice:has-text("AS")');
    await b.click("#setup-form button[type=submit]");
    await b.click('#setup-form .setup-subjects .chip:has-text("Physics") >> nth=0');
    for (let i = 0; i < 10 && (await b.getAttribute("#setup-form", "data-step")) !== "boarding"; i++) {
      await b.click("#setup-form button[type=submit]");
      await b.waitForTimeout(60);
    }
    await b.click('#setup-form .setup-choice:has-text("Boarder")');
    check("boarders give every study time the school keeps", (await b.locator(".setup-prep").count()) === 1 && (await b.isVisible("#setup-add-prep")));
    await b.click("#setup-add-prep");
    await b.fill("#setup-prep-1-start", "20:30");
    await b.fill("#setup-prep-1-end", "21:15");
    await b.click('#setup-form .setup-choice:has-text("It changes")');
    check("…and how weekends go, with the journey home", await b.isVisible('#setup-form .setup-sub:has-text("Travel home")'));
    for (let i = 0; i < 14 && (await b.isVisible("#setup")); i++) {
      await b.click("#setup-form button[type=submit]", { timeout: 3000 }).catch(() => {});
      await b.waitForTimeout(60);
    }
    await b.waitForSelector("#app:not([hidden])", { timeout: 15000 });
    const row = await b.evaluate(() => window.__qa.db.student_profiles.find((r) => r.setup_at));
    check("study times and weekends are saved", row.boarding && row.prep_slots?.length === 2 && row.prep_slots[1].start === "20:30" && row.weekend_plan === "ask" && row.home_travel_minutes === 60 && row.prep_start === row.prep_slots[0].start, JSON.stringify([row.prep_slots, row.weekend_plan]));
    await go(b, "#/plan", 1200);
    check("the plan counts all of the study times", /all of your prep and study times/.test(await b.textContent(".plan-body .s-sub")));
    check("a boarder is asked about the coming weekend", (await b.isVisible("#plan-weekend.ask")) && /hostel or going home/.test(await b.textContent("#plan-weekend")));
    await b.click('#plan-weekend [data-where="home"]');
    await b.waitForTimeout(400);
    const away = await b.evaluate(() => window.__qa.db.student_profiles.find((r) => r.setup_at).plan_rules?.away || {});
    check("…and going home is kept for that weekend", Object.values(away).includes("home") && !(await b.isVisible("#plan-weekend.ask")), JSON.stringify(away));

    // The journey: download, start again, bring back.
    await go(b, "#/settings");
    check("Settings has your journey", await b.isVisible("#journey-panel"));
    const [dl] = await Promise.all([b.waitForEvent("download"), b.click("#journey-download")]);
    const file = await dl.path();
    const sealed = JSON.parse(await (await import("node:fs/promises")).readFile(file, "utf8"));
    check("a journey downloads, sealed to the account", sealed.kind === "panalo-journey" && typeof sealed.journey === "string" && sealed.seal && sealed.account === row.user_id);
    await b.click("#journey-reset");
    await b.click("#journey-reset-go");
    check("starting again needs it typed", await b.isVisible("#journey-reset-word"));
    await b.fill("#journey-reset-word", "start again");
    await b.click("#journey-reset-go");
    await b.waitForSelector("#setup:not([hidden]) #setup-form[data-step]", { timeout: 15000 }).catch(() => {});
    check("starting again clears the journey and runs the setup", (await b.isVisible("#setup")) && (await b.evaluate(() => !window.__qa.db.student_profiles.some((r) => r.setup_at))));
    await b.evaluate(() => (location.hash = "#/settings"));
    // A journey that isn't this account's, and one that was changed, are refused.
    const other = JSON.stringify({ ...sealed, account: "00000000-0000-4000-8000-000000000000" });
    const changed = JSON.stringify({ ...sealed, journey: sealed.journey.replace('"version":1', '"version":1,"x":1') });
    check("the journey file is checked before anything changes", await b.evaluate(async ([o, s]) => {
      const m = await import("/students/js/journey.js");
      const me = window.__qa.db.student_profiles[0] && JSON.parse(s).account;
      return !!m.readJourneyFile(o, me).error && !m.readJourneyFile("not json", me).journey && !!m.readJourneyFile(s, me).journey;
    }, [other, JSON.stringify(sealed)]));
    const importOn = async (text) => {
      await b.evaluate(() => import("/students/js/journey.js").then((m) => m.openImport()));
      await b.setInputFiles("#journey-file", { name: "journey.json", mimeType: "application/json", buffer: Buffer.from(text) });
      await b.waitForTimeout(200);
      await b.click("#journey-import-go");
      await b.waitForTimeout(400);
    };
    await importOn(changed);
    check("a changed journey is refused", /changed after it was downloaded/.test(await b.textContent(".sheet .sheet-body")));
    await b.keyboard.press("Escape");
    await importOn(JSON.stringify(sealed));
    await b.waitForTimeout(900);
    await b.evaluate(() => window.__qa.ready).catch(() => {});
    const back = await b.evaluate(() => window.__qa.db.student_profiles.find((r) => r.setup_at));
    check("the same account brings its journey back", back?.prep_slots?.length === 2 && back?.weekend_plan === "ask", JSON.stringify(back?.prep_slots));
    const errorsBefore = b.errors.slice();
    check("no console errors (boarder and journey)", errorsBefore.length === 0);
    // A part that fails to load (a tab opened before a new version went
    // live) reloads the page once, then says so with a Retry.
    await b.route("**/js/surfaces/calendar.js", (r) => r.abort());
    const navsBefore = b.navs.length;
    await b.evaluate(() => (location.hash = "#/calendar"));
    await b.waitForSelector("section[data-surface=calendar] .empty", { timeout: 15000 }).catch(() => {});
    check("a part that won't load reloads once, then offers Retry", b.navs.length > navsBefore && /didn't load/.test(await b.textContent("section[data-surface=calendar]").catch(() => "")), JSON.stringify(b.navs.slice(navsBefore)));
    if (errorsBefore.length) console.log(errorsBefore.join("\n"));
    await b.close();
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
    await t.waitForSelector("#guardian-form:not([hidden])", { timeout: 15000 }).catch(async () => console.log("guardian: not shown", await where(t), t.errors));
    check("a 15-year-old is asked for a parent before anything else", (await t.isVisible("#guardian-form")) && !(await t.isVisible("#setup")) && !(await t.isVisible("#app")));
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
    await t.waitForFunction(() => /\S/.test(document.querySelector("#auth-message")?.textContent || ""), null, { timeout: 8000 }).catch(() => {});
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
    await finishSetup(t);
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
    check("reduced motion shows the numbers at once", (await r.$$eval("[data-count]", (n) => n.map((x) => x.textContent))).join() === "06,90,00,00");
    check("no console errors (reduced motion)", r.errors.length === 0);
  }
} finally {
  await qa.close();
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall students checks passed");
process.exitCode = failed ? 1 : 0;
