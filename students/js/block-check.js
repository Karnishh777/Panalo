// The check that closes a block (v0.2): a few questions from the topic's
// bank, each answered with its explanation straight away (retrieval with
// feedback, the best-supported study method there is). Then, for a learn
// block, how much of the topic is now covered; for a subject without a
// bank, how it went. What it learned is saved to the topic, and the plan
// re-plans by itself.
//
// Quick checks and reviews are only questions, so they open here directly;
// learn and practice blocks come here when their focus block ends.
import { el, openSheet, reportError, showToast } from "./ui.js";
import { store, api } from "./store.js";
import * as L from "./model/learner.js";
import * as P from "./model/plan.js";
import { questionsFor, topicName, nameOf, stateOf, saveTopic, savePace, colourOf, currentPlan } from "./planner.js";
import { artImg } from "./art.js";
import { createPan } from "./motion-art.js";
import { openPastPaper, openPaperMarks } from "./paper-sheets.js";

const COUNT = { check: 5, review: 3, practice: 3, learn: 3 };
const COVERED = [[0.25, "A quarter"], [0.5, "Half"], [0.75, "Most of it"], [1, "All of it"]];
const RATINGS = [[1, "Hard going"], [2, "Okay"], [3, "Good"], [4, "Easy"]];

function shuffle(a) {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}

const dayName = (ms) => {
  const d = new Date(ms);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today.getTime()) / 86400000);
  if (diff <= 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/**
 * Open the check for a block.
 * @param {object} block  { kind, subject, topic, minutes }
 * @param {object} [o]
 * @param {number} [o.minutes]   focus minutes already recorded for it (learn/practice)
 * @param {string} [o.sessionId] the focus session it closes, to note coverage on
 * @param {Function} [o.onDone]
 */
export function openBlockCheck(block, { minutes = 0, sessionId = null, onDone } = {}) {
  // A timed past paper ends in its marks, not a few questions.
  if (block.kind === "paper") return openPaperMarks(block.subject, String(block.topic).replace(/^paper-/, ""));
  const started = Date.now();
  const own = block.topic === "*";
  const questions = own ? [] : shuffle(questionsFor(block.subject, block.topic)).slice(0, COUNT[block.kind] || 3);
  const answers = [];
  let covered = null;
  let rating = null;
  let i = 0;
  const tone = colourOf(block.subject);

  const stage = el("div", { class: "bc-stage", "aria-live": "polite" });
  const sheet = openSheet({
    title: `${P.KINDS[block.kind]?.label || "Check"} · ${nameOf(block.subject)}`,
    lead: topicName(block.subject, block.topic),
    form: false,
    wide: true,
    body: [stage],
  });
  sheet.dialog.classList.add("block-check");
  sheet.dialog.style.setProperty("--subj", tone);

  function question() {
    const q = questions[i];
    const order = shuffle(q.o.map((text, idx) => ({ text, idx })));
    const opts = el("div", { class: "bc-options", role: "group", "aria-label": "Answers" });
    const feedback = el("div", { class: "bc-feedback" });
    const next = el("button", { type: "button", class: "btn btn-primary", id: "bc-next", text: i + 1 < questions.length ? "Next question" : "Continue", hidden: true, onClick: () => (++i < questions.length ? question() : after()) });
    for (const o of order) {
      opts.append(
        el("button", {
          type: "button",
          class: "bc-option",
          "data-correct": o.idx === q.a ? "1" : null,
          text: o.text,
          onClick: (e) => {
            const right = o.idx === q.a;
            answers.push({ correct: right, options: q.o.length });
            for (const b of opts.children) {
              b.disabled = true;
              if (b.dataset.correct) b.classList.add("is-right");
            }
            if (!right) e.currentTarget.classList.add("is-wrong");
            feedback.replaceChildren(el("b", { text: right ? "Right." : `Not quite. It's “${q.o[q.a]}”.` }), " ", q.why);
            next.hidden = false;
            next.focus();
          },
        })
      );
    }
    stage.replaceChildren(
      el("p", { class: "bc-count faint", text: `Question ${i + 1} of ${questions.length}` }),
      el("p", { class: "bc-q", text: q.q }),
      opts,
      feedback,
      el("div", { class: "bc-foot" }, [next])
    );
    opts.firstChild?.focus();
  }

  function chips(label, list, onPick) {
    const group = el("div", { class: "chips", role: "radiogroup", "aria-label": label });
    for (const [v, text] of list) {
      group.append(el("button", { type: "button", role: "radio", class: "chip", "aria-checked": "false", "data-value": String(v), text, onClick: (e) => { for (const c of group.children) c.setAttribute("aria-checked", String(c === e.currentTarget)); onPick(v); } }));
    }
    return group;
  }

  function after() {
    const save = el("button", { type: "button", class: "btn btn-primary", id: "bc-save", text: "Save", onClick: () => finish(save) });
    const right = answers.filter((a) => a.correct).length;
    const parts = [];
    if (answers.length) parts.push(el("p", { class: "bc-score" }, [el("b", { class: "num", text: `${right} of ${answers.length}` }), " right."]));
    if (block.kind === "learn") {
      const cur = stateOf(block.subject, block.topic).covered;
      save.disabled = true;
      parts.push(
        el("p", { class: "bc-ask", text: "How much of this topic have you now covered?" }),
        chips("How much is covered", COVERED.filter(([v]) => v > cur), (v) => { covered = v; save.disabled = false; })
      );
    } else if (own) {
      save.disabled = true;
      parts.push(el("p", { class: "bc-ask", text: "How did it go?" }), chips("How it went", RATINGS, (v) => { rating = v; save.disabled = false; }));
    }
    if (!parts.length || (answers.length && block.kind !== "learn" && !own)) return finish(save, parts);
    stage.replaceChildren(...parts, el("div", { class: "bc-foot" }, [save]));
  }

  async function finish(btn, lead = []) {
    if (btn) btn.disabled = true;
    const now = Date.now();
    const spent = minutes || Math.max(1, Math.round((now - started) / 60000));
    const before = stateOf(block.subject, block.topic);
    const t = P.afterBlock(before, { kind: block.kind, answers, covered, rating, minutes: spent, now });
    if (!store.progressMissing) {
      const { error } = await saveTopic(block.subject, block.topic, t);
      if (error) {
        if (btn) btn.disabled = false;
        return reportError(error, "Couldn't save how it went. Try again.");
      }
      if (block.kind === "learn" && covered != null && covered > before.covered) {
        const r = await savePace(block.subject, { minutes: spent, covered: covered - before.covered });
        if (r.error) console.error(r.error);
      }
      // Questions-only blocks count as focus too.
      if (!minutes) {
        const row = { started_at: new Date(started).toISOString(), ended_at: new Date(Math.max(now, started + spent * 60000)).toISOString(), planned_minutes: block.minutes || spent, focused_minutes: spent, completed: true, subject: nameOf(block.subject).slice(0, 40), topic: block.topic };
        const r = await api.addSession(row);
        if (r.error) console.error(r.error);
      } else if (sessionId && covered != null) {
        const r = await api.updateSession(sessionId, { covered: Math.round(covered * 100) });
        if (r.error) console.error(r.error);
      }
    } else {
      showToast("Your progress can't be saved here yet.");
    }
    summary(before, t, lead);
  }

  function summary(before, t, lead) {
    const lines = [];
    if (block.kind === "check") {
      lines.push(t.covered >= 1 ? "You know this one. It will come back for a short review before it fades." : "Worth learning properly. It's in your plan now.");
    } else if (block.kind === "learn") {
      lines.push(t.covered >= 1 ? "Topic covered. Its reviews start now." : `About ${Math.round(t.covered * 100)}% covered. The rest is planned.`);
    }
    const due = L.dueAt(t, { now: Date.now() });
    if (due) lines.push(`Next review: ${dayName(due)}.`);
    const next = P.nextBlock(currentPlan());
    const nextBtn =
      next && !(next.subject === block.subject && next.topic === block.topic)
        ? el("button", { type: "button", class: "btn btn-quiet", id: "bc-next-block", text: `Next: ${nameOf(next.subject)} · ${P.KINDS[next.kind].label}`, onClick: () => { sheet.close(); startBlock(next); } })
        : null;
    // Pan cheers a good check and thinks along with a hard one.
    const right = answers.filter((a) => a.correct).length;
    const good = answers.length ? right / answers.length >= 0.67 : (rating || 3) >= 3 || t.covered >= 1;
    stage.replaceChildren(
      artImg(good ? "pan-cheer" : "pan-think", { cls: `pan bc-pan${good ? " cheer" : ""}` }) ||
        Object.assign(createPan({ size: 130, pose: good ? "cheer" : "think", label: good ? "Pan, cheering" : "Pan, thinking" }).canvas, { className: "pan pan-live bc-pan" }),
      ...lead,
      el("div", { class: "bc-summary" }, lines.map((l) => el("p", { text: l }))),
      el("div", { class: "bc-foot" }, [nextBtn, el("button", { type: "button", class: "btn btn-primary", id: "bc-done", text: "Done", onClick: () => sheet.close() })])
    );
    onDone?.(t);
    stage.querySelector("#bc-done")?.focus();
  }

  if (questions.length) question();
  else after();
  return sheet;
}

/**
 * Start a block from anywhere: questions-only blocks open their check;
 * the others go to the Study Room with a focus block set up for them.
 */
export function startBlock(block) {
  if (block.kind === "paper") return openPastPaper(block);
  if (block.kind === "check" || block.kind === "review") {
    if (block.topic !== "*" && questionsFor(block.subject, block.topic).length) return openBlockCheck(block);
  }
  location.hash = `#/study/block=${encodeURIComponent([block.subject, block.topic, block.kind, block.minutes].join("~"))}`;
}
