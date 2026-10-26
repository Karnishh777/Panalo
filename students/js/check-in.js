// A subject check-in (v0.2): where the student is, so the plan starts from
// the truth instead of a guess. Offered in Plan for each subject until it's
// done, and any time after to redo or change it.
//
//   1. Past exams: any marks so far (what it was, got, out of). Optional.
//   2. How it's going, one of:
//        a quick check-over: how much school has taught, and how it's going;
//        chapter by chapter (optional): not taught / weak / okay / strong for
//        each, with an optional quick check of a few questions that corrects
//        the rating.
// Saving turns it into topic states (model/diagnose.js) and the plan
// re-plans by itself. Nothing is saved until Save.
import { el, openSheet, reportError, showToast, shortDate } from "./ui.js";
import { store } from "./store.js";
import * as D from "./model/diagnose.js";
import { profile, subjectView, nameOf, colourOf, questionsFor, stateOf, saveTopics, addResult } from "./planner.js";

const FEEL = D.RATINGS.filter((r) => r.id !== "untaught");

function shuffle(a) {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}

function chips(label, options, value, onPick, cls = "") {
  const group = el("div", { class: `chips ${cls}`, role: "radiogroup", "aria-label": label });
  const draw = (v) => {
    for (const c of group.children) c.setAttribute("aria-checked", String(c.dataset.value === String(v)));
  };
  for (const [v, text] of options) {
    group.append(el("button", { type: "button", role: "radio", class: "chip", "aria-checked": "false", "data-value": String(v), text, onClick: () => { draw(v); onPick(v); } }));
  }
  draw(value);
  return Object.assign(group, { set: draw });
}

/** Subjects not checked in yet, in the order they were chosen. */
export function uncheckedSubjects() {
  const now = Date.now();
  return profile().subjects.filter((s) => {
    const v = subjectView(s, now);
    return !v.own && !D.checkedIn(v.list, v.states);
  });
}

/**
 * Open the check-in for a subject. `then` is the subjects still to do after
 * this one (Plan's "check in on all"), each opened in turn.
 */
export function openCheckIn(subjectId, { then = [] } = {}) {
  const now = Date.now();
  const s = profile().subjects.find((x) => x.id === subjectId);
  if (!s) return;
  const v = subjectView(s, now);
  const name = nameOf(subjectId);
  const marks = []; // new ones, saved with the rest
  const ratings = {};
  for (const tp of v.list) ratings[tp.id] = D.ratingOf(v.states[tp.id]);
  const rated = Object.values(ratings).filter(Boolean);
  let way = rated.length && new Set(rated).size > 1 ? "chapters" : "over";
  // Starting answers for the check-over, from what is known already.
  const taughtNow = v.list.length ? rated.filter((r) => r !== "untaught").length / v.list.length : 0;
  let taught = rated.length ? D.TAUGHT.reduce((b, [x]) => (Math.abs(x - taughtNow) < Math.abs(b - taughtNow) ? x : b), 0) : null;
  let feel = rated.find((r) => r !== "untaught") || ({ 1: "weak", 2: "okay", 3: "okay", 4: "strong" }[s.level] ?? null);
  let step = 1;

  const stage = el("div", { class: "ci-stage" });
  const back = el("button", { type: "button", class: "btn btn-quiet", id: "ci-back", text: "Back", onClick: () => go(step - 1) });
  const next = el("button", { type: "button", class: "btn btn-primary", id: "ci-next", text: "Next", onClick: () => (step === 1 && !v.own ? go(2) : save()) });
  const steps = el("p", { class: "ci-steps faint small" });
  const sheet = openSheet({
    title: `Check-in · ${name}`,
    lead: "Where you are now, so your plan starts from it. You can change it any time.",
    form: false,
    wide: true,
    body: [steps, stage, el("div", { class: "ci-foot" }, [back, next])],
  });
  sheet.dialog.classList.add("check-in");
  sheet.dialog.style.setProperty("--subj", colourOf(subjectId));

  // ---- 1. past exams ----
  function exams() {
    const old = store.results.filter((r) => r.subject === subjectId).slice(0, 6);
    const list = el("ul", { class: "ci-marks", id: "ci-marks" });
    const drawList = () =>
      list.replaceChildren(
        ...old.map((r) => el("li", {}, [el("span", { text: r.title }), el("small", { class: "faint", text: ` ${shortDate(r.taken_on)}` }), el("b", { class: "num", text: `${Number(r.score)}/${Number(r.out_of)}` })])),
        ...marks.map((m, i) =>
          el("li", { class: "new" }, [
            el("span", { text: m.title }),
            el("b", { class: "num", text: `${m.score}/${m.outOf}` }),
            el("button", { type: "button", class: "link-btn", text: "Remove", "aria-label": `Remove ${m.title}`, onClick: () => { marks.splice(i, 1); drawList(); } }),
          ])
        )
      );
    drawList();
    const title = el("input", { type: "text", class: "input", id: "ci-exam-title", maxlength: "80", placeholder: "Mid-term, Mock Paper 2", "aria-label": "Which exam" });
    const got = el("input", { type: "number", class: "input", id: "ci-exam-got", min: "0", step: "0.5", inputmode: "decimal", placeholder: "Got", "aria-label": "Marks you got" });
    const total = el("input", { type: "number", class: "input", id: "ci-exam-total", min: "1", step: "0.5", inputmode: "decimal", placeholder: "Out of", "aria-label": "Total marks" });
    const add = el("button", {
      type: "button",
      class: "btn btn-ghost btn-sm",
      id: "ci-exam-add",
      text: "Add",
      onClick: () => {
        const g = Number(got.value);
        const t = Number(total.value);
        if (!title.value.trim()) return title.focus();
        if (!(t > 0 && t <= 1000) || got.value === "" || !(g >= 0 && g <= t)) return showToast("The marks should be between 0 and the total."), got.focus();
        marks.push({ title: title.value.trim().slice(0, 80), score: g, outOf: t });
        title.value = got.value = total.value = "";
        drawList();
        title.focus();
      },
    });
    return [
      el("h3", { class: "ci-h", text: "Any exams or tests so far?" }),
      el("p", { class: "faint small", text: "School tests, mocks, past papers: the total and what you got. Skip it if there aren't any yet." }),
      list,
      el("div", { class: "ci-exam-row" }, [title, got, total, add]),
    ];
  }

  // ---- 2. how it's going ----
  function going() {
    const ways = chips("How to answer", [["over", "Quick check-over"], ["chapters", "Chapter by chapter"]], way, (w) => { way = w; draw(); }, "ci-ways");
    const out = el("div", { class: "ci-going" });
    function draw() {
      if (way === "over") {
        out.replaceChildren(
          el("p", { class: "ci-q", text: "How much has school taught so far?" }),
          chips("How much has been taught", D.TAUGHT, taught, (x) => { taught = x; ready(); }, "ci-taught"),
          el("p", { class: "ci-q", text: "And how's it going?" }),
          chips("How it's going", FEEL.map((r) => [r.id, r.label]), feel, (x) => { feel = x; ready(); }, "ci-feel"),
          el("p", { class: "faint small", text: "The taught part, in syllabus order, gets that rating; the rest is planned as new. Chapter by chapter is more exact, if you'd like." })
        );
      } else {
        // Chapters start from the check-over's answer when there's nothing yet.
        if (taught != null && feel) for (const [id, r] of Object.entries(D.checkOver(v.list, { taught, feel }))) ratings[id] ||= r;
        out.replaceChildren(el("ol", { class: "ci-chapters", id: "ci-chapters" }, v.list.map(chapter)));
      }
      ready();
    }
    draw();
    return [el("h3", { class: "ci-h", text: `How's ${name} going?` }), ways, out];
  }

  function chapter(tp) {
    const qs = questionsFor(subjectId, tp.id);
    const box = el("div", { class: "ci-quick", hidden: true });
    const verdict = el("small", { class: "ci-verdict faint" });
    const group = chips(tp.name, D.RATINGS.map((r) => [r.id, r.label]), ratings[tp.id], (x) => { ratings[tp.id] = x; verdict.textContent = ""; quick.hidden = !qs.length || x === "untaught"; ready(); }, "ci-rate");
    const quick = el("button", { type: "button", class: "link-btn ci-quick-btn", text: "Quick check", hidden: !qs.length || !ratings[tp.id] || ratings[tp.id] === "untaught", onClick: () => runQuick() });
    function runQuick() {
      const picked = shuffle(qs).slice(0, 3);
      const answers = [];
      let i = 0;
      box.hidden = false;
      quick.hidden = true;
      const ask = () => {
        const q = picked[i];
        const opts = el("div", { class: "bc-options", role: "group", "aria-label": "Answers" });
        for (const o of shuffle(q.o.map((text, idx) => ({ text, idx })))) {
          opts.append(
            el("button", {
              type: "button",
              class: "bc-option",
              "data-correct": o.idx === q.a ? "1" : null,
              text: o.text,
              onClick: () => {
                answers.push({ correct: o.idx === q.a });
                if (++i < picked.length) return ask();
                const was = ratings[tp.id];
                ratings[tp.id] = D.afterQuickCheck(was, answers);
                group.set(ratings[tp.id]);
                const right = answers.filter((a) => a.correct).length;
                verdict.textContent = `${right} of ${answers.length} right${ratings[tp.id] !== was ? ` · now “${D.RATINGS.find((r) => r.id === ratings[tp.id]).label}”` : ""}`;
                box.hidden = true;
                quick.hidden = false;
                quick.textContent = "Check again";
              },
            })
          );
        }
        box.replaceChildren(el("p", { class: "bc-count faint", text: `Question ${i + 1} of ${picked.length}` }), el("p", { class: "bc-q", text: q.q }), opts);
        opts.firstChild?.focus();
      };
      ask();
    }
    return el("li", { class: "ci-chapter" }, [el("div", { class: "ci-chapter-head" }, [el("span", { class: "ci-name", text: tp.name }), quick, verdict]), group, box]);
  }

  function ready() {
    if (step !== 2) return;
    next.disabled = way === "over" ? !(taught != null && (feel || taught === 0)) : !v.list.every((tp) => ratings[tp.id]);
  }

  function go(n) {
    step = Math.max(1, n);
    const last = v.own || step === 2;
    steps.textContent = v.own ? "" : `Step ${step} of 2`;
    back.hidden = step === 1;
    next.textContent = last ? (then.length ? "Save and next subject" : "Save") : "Next";
    next.disabled = false;
    stage.replaceChildren(...(step === 1 ? exams() : going()));
    ready();
  }

  async function save() {
    next.disabled = true;
    if (!v.own) {
      const final = way === "over" ? D.checkOver(v.list, { taught, feel: feel || "okay" }) : ratings;
      const states = Object.fromEntries(v.list.map((tp, i) => [tp.id, D.rateTopic(stateOf(subjectId, tp.id), final[tp.id], Date.now(), i / v.list.length)]));
      const { error } = await saveTopics(subjectId, states);
      if (error) {
        next.disabled = false;
        return reportError(error, "Couldn't save the check-in. Try again.");
      }
    }
    // Marks after the ratings, so they pull the rated topics towards them.
    for (const m of marks) {
      const { error } = await addResult({ subject: subjectId, title: m.title, takenOn: new Date().toLocaleDateString("en-CA"), score: m.score, outOf: m.outOf, topics: [] });
      if (error) {
        next.disabled = false;
        return reportError(error, "Couldn't save a mark. Try again.");
      }
    }
    sheet.close();
    showToast(`${name} checked in. Your plan has re-planned around it.`, "success");
    const [after, ...rest] = then;
    if (after) openCheckIn(after, { then: rest });
  }

  go(1);
  return sheet;
}

/** A line for a subject card: what the check-in found, roughly. */
export function checkInSummary(v) {
  const counts = { untaught: 0, weak: 0, okay: 0, strong: 0 };
  for (const tp of v.list) {
    const r = D.ratingOf(v.states[tp.id]);
    if (r) counts[r]++;
  }
  const parts = [];
  if (counts.strong) parts.push(`${counts.strong} strong`);
  if (counts.okay) parts.push(`${counts.okay} okay`);
  if (counts.weak) parts.push(`${counts.weak} weak`);
  if (counts.untaught) parts.push(`${counts.untaught} not taught yet`);
  return parts.join(" · ");
}

