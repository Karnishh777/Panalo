// Papers (v0.2): which papers a student sits in each subject, in which
// series, on which dates (model/papers.js); and past papers, timed in the
// Study Room and marked with the scheme, whose marks feed the plan.
import { el, openSheet, reportError, showToast } from "./ui.js";
import * as PP from "./model/papers.js";
import { stageOf } from "./model/subjects.js";
import { profile, nameOf, syllabi, savePapers, addResult, colourOf } from "./planner.js";

const fmtMin = (m) => (m == null ? "" : m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}` : `${m} min`);
const isoDay = (ms) => new Date(ms).toLocaleDateString("en-CA");

/** One line about a paper: kind, length, marks. */
export function paperFacts(p) {
  return [PP.KIND_LABEL[p.kind], fmtMin(p.minutes), p.marks ? `${p.marks} marks` : ""].filter(Boolean).join(" · ");
}

/** Chips to choose papers (several) for a subject at a stage. */
export function paperChooser(code, stageId, chosen, onChange) {
  const level = stageOf(stageId)?.level;
  const list = PP.papersForLevel(code, level);
  const box = el("div", { class: "chips pp-papers", role: "group", "aria-label": "Papers" });
  const draw = () =>
    box.replaceChildren(
      ...list.map((p) =>
        el("button", {
          type: "button",
          class: "chip pp-paper",
          "aria-pressed": String(chosen.includes(p.id)),
          "data-paper": p.id,
          onClick: () => {
            const i = chosen.indexOf(p.id);
            if (i >= 0) chosen.splice(i, 1);
            else chosen.push(p.id);
            chosen.sort();
            draw();
            onChange?.(chosen);
          },
        }, [el("b", { text: `Paper ${p.id}` }), el("span", { text: ` ${p.name}` }), el("small", { class: "faint", text: paperFacts(p) })])
      )
    );
  draw();
  return box;
}

/** Chips for the next exam series. */
export function seriesChooser(value, onChange) {
  const box = el("div", { class: "chips pp-series", role: "radiogroup", "aria-label": "Exam series" });
  const keys = PP.upcomingSeries();
  if (value && !keys.includes(value)) keys.unshift(value);
  const draw = (v) => {
    box.replaceChildren(
      ...keys.map((k) => el("button", { type: "button", role: "radio", class: "chip", "data-series": k, "aria-checked": String(k === v), text: PP.seriesLabel(k), onClick: () => (draw(k), onChange(k)) }))
    );
  };
  draw(value);
  return box;
}

/** Papers, series and dates for one subject. */
export function openPapers(subjectId) {
  const s = profile().subjects.find((x) => x.id === subjectId);
  const code = syllabi()[subjectId]?.code;
  if (!s || !PP.papersOf(code).length) return showToast("Papers aren't listed for this subject yet.");
  const level = stageOf(profile().stage)?.level;
  const chosen = (s.papers?.length ? s.papers : PP.defaultPapers(code, level)).slice();
  let series = s.series || null;
  const dates = { ...(s.dates || {}) };
  const datesBox = el("div", { class: "pp-dates" });
  const drawDates = () =>
    datesBox.replaceChildren(
      ...chosen.map((id) => {
        const p = PP.paperOf(code, id);
        const input = el("input", { type: "date", class: "input", id: `pp-date-${id}`, value: dates[id] || "", "aria-label": `Paper ${id} date` });
        input.addEventListener("change", () => (input.value ? (dates[id] = input.value) : delete dates[id]));
        return el("label", { class: "pp-date" }, [el("span", { text: `Paper ${id} · ${p?.name || ""}` }), input]);
      })
    );
  drawDates();
  const note = PP.SYLLABUS_PAPERS[code]?.note;
  const sheet = openSheet({
    title: `Papers · ${nameOf(subjectId)}${code ? ` ${code}` : ""}`,
    lead: "The papers you're sitting and when. The plan studies only what they examine, and counts down to each one.",
    form: false,
    wide: true,
    body: [
      el("p", { class: "pp-h", text: "Your papers" }),
      note ? el("p", { class: "faint small", text: note }) : null,
      paperChooser(code, profile().stage, chosen, drawDates),
      el("p", { class: "pp-h", text: "Exam series" }),
      seriesChooser(series, (k) => (series = k)),
      el("p", { class: "pp-h", text: "Dates (optional)" }),
      el("p", { class: "faint small", text: "From your timetable. Until you add them, the plan aims for the start of the series, so it's never late." }),
      datesBox,
    ].filter(Boolean),
    actions: [
      { label: "Cancel", kind: "btn-quiet" },
      {
        label: "Save",
        kind: "btn-primary",
        id: "pp-save",
        onClick: async (btn) => {
          if (!chosen.length) return showToast("Choose at least one paper."), false;
          btn.disabled = true;
          const { error } = await savePapers(subjectId, { papers: chosen.slice(), series: series || undefined, dates: Object.fromEntries(Object.entries(dates).filter(([k]) => chosen.includes(k))) });
          btn.disabled = false;
          if (error) return reportError(error, "Couldn't save your papers."), false;
          showToast("Saved. Your plan follows your papers now.", "success");
        },
      },
    ],
  });
  sheet.dialog.classList.add("papers-sheet");
  sheet.dialog.style.setProperty("--subj", colourOf(subjectId));
  return sheet;
}

/** A line for the subject card: "Papers 1 and 5 · Paper 1 in 34 days". */
export function papersLine(v, now = Date.now()) {
  if (!v.papers?.length) return "";
  const ids = v.papers.map((p) => p.id);
  const s = profile().subjects.find((x) => x.id === v.id);
  // A countdown only for a paper with its own date; otherwise the series.
  const dated = v.papers.filter((p) => s?.dates?.[p.id] && p.at >= now - 43200000).sort((a, b) => a.at - b.at)[0];
  const days = dated ? Math.ceil((dated.at - now) / 86400000) : null;
  const when = dated ? (days <= 0 ? `Paper ${dated.id} today` : days === 1 ? `Paper ${dated.id} tomorrow` : `Paper ${dated.id} in ${days} days`) : PP.seriesLabel(s?.series);
  return [`Paper${ids.length > 1 ? "s" : ""} ${ids.length > 1 ? `${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]}` : ids[0]}`, when].filter(Boolean).join(" · ");
}

// ---- Past papers ----------------------------------------------------------------------------

/** A planned past paper: what to do, then the timer, then the marks. */
export function openPastPaper(block) {
  const code = syllabi()[block.subject]?.code;
  const p = PP.paperOf(code, block.paper || String(block.topic).replace(/^paper-/, ""));
  if (!p) return showToast("That paper isn't listed any more.");
  const sheet = openSheet({
    title: `Past paper · ${nameOf(block.subject)} ${code || ""}`.trim(),
    lead: PP.paperLabel(p),
    form: false,
    body: [
      el("ol", { class: "pp-steps" }, [
        el("li", { text: `Take a ${p.name} paper you haven't done (${code}/${p.id}x: your school has them, and Cambridge publishes them).` }),
        el("li", { text: `Sit it in exam conditions: ${fmtMin(p.minutes) || "its full time"}, no notes${p.kind === "written" ? ", a calculator only if the paper allows it" : ""}.` }),
        el("li", { text: "Mark it with its mark scheme, honestly, then enter the marks here: the plan leans on what it shows." }),
      ]),
    ],
    actions: [
      { label: "Enter marks", kind: "btn-quiet", id: "pp-marks-now", onClick: () => (sheet.close(), openPaperMarks(block.subject, p.id), false) },
      {
        label: `Start the timer · ${fmtMin(p.minutes || 90)}`,
        kind: "btn-primary",
        id: "pp-start",
        onClick: () => {
          location.hash = `#/study/block=${encodeURIComponent([block.subject, `paper-${p.id}`, "paper", p.minutes || 90].join("~"))}`;
        },
      },
    ],
  });
  sheet.dialog.style.setProperty("--subj", colourOf(block.subject));
  return sheet;
}

/** Enter a past paper's marks: saved as a result on that paper's topics. */
export function openPaperMarks(subjectId, paperId) {
  const bank = syllabi()[subjectId];
  let p = PP.paperOf(bank?.code, paperId);
  if (!p) return null;
  // Any of the subject's chosen papers (or all of them, if none chosen).
  const mine = profile().subjects.find((s) => s.id === subjectId)?.papers || [];
  const options = PP.papersOf(bank.code).filter((x) => PP.timedPaper(x) && (!mine.length || mine.includes(x.id)));
  const pick = el("select", { class: "input", id: "pp-paper", "aria-label": "Paper" }, options.map((x) => el("option", { value: x.id, text: PP.paperLabel(x) })));
  pick.value = p.id;
  const which = el("input", { type: "text", class: "input", id: "pp-which", maxlength: "40", placeholder: "e.g. Feb/Mar 2025, variant 52", "aria-label": "Which paper" });
  const got = el("input", { type: "number", class: "input", id: "pp-got", min: "0", step: "0.5", inputmode: "decimal", "aria-label": "Marks you got" });
  const total = el("input", { type: "number", class: "input", id: "pp-total", min: "1", step: "0.5", inputmode: "decimal", value: p.marks ? String(p.marks) : "", "aria-label": "Out of" });
  pick.addEventListener("change", () => {
    p = PP.paperOf(bank.code, pick.value);
    if (p?.marks) total.value = String(p.marks);
  });
  return openSheet({
    title: `Past-paper marks · ${nameOf(subjectId)}`,
    lead: "Marked with the mark scheme. The topics the paper examines move towards the mark.",
    body: [
      el("label", { class: "field" }, [el("span", { text: "Paper" }), pick]),
      el("label", { class: "field" }, [el("span", { text: "Which one (optional)" }), which]),
      el("div", { class: "res-row" }, [el("label", { class: "field" }, [el("span", { text: "Marks" }), got]), el("label", { class: "field" }, [el("span", { text: "Out of" }), total])]),
    ],
    actions: [
      { label: "Cancel", kind: "btn-quiet" },
      {
        label: "Save",
        kind: "btn-primary",
        submit: true,
        id: "pp-marks-save",
        onClick: async (btn) => {
          const g = Number(got.value);
          const t = Number(total.value);
          if (!(t > 0 && t <= 1000) || got.value === "" || !(g >= 0 && g <= t)) return showToast("The marks should be between 0 and the total."), got.focus(), false;
          btn.disabled = true;
          const topics = PP.paperTopics(bank, p).map((x) => x.id).slice(0, 60);
          const title = `Paper ${p.id} · ${which.value.trim() || "past paper"}`.slice(0, 80);
          const { error } = await addResult({ subject: subjectId, title, takenOn: isoDay(Date.now()), score: g, outOf: t, topics });
          btn.disabled = false;
          if (error) return reportError(error, "Couldn't save those marks."), false;
          showToast(`Saved: ${Math.round((g / t) * 100)}% on Paper ${p.id}. Your plan has adjusted.`, "success");
        },
      },
    ],
  });
}

