// Exam-style questions (v0.2): written questions with their marks, a mark
// scheme to mark yourself against, and diagrams, by paper, by marks and by
// topic. Original questions in the style of the papers, not past papers
// (those are Cambridge's). Each mark ticked or not moves the topic, as
// answers do (model/learner.js), and the marks grow the world (phase 37).
import { el, openSheet, reportError, showToast } from "./ui.js";
import * as P from "./model/plan.js";
import * as PP from "./model/papers.js";
import { nameOf, syllabi, scopeOf, stateOf, saveTopic, colourOf, profile } from "./planner.js";
import { api } from "./store.js";
import { dayKey } from "./model/time.js";
import { tipsFor, SOURCE } from "./model/examiner.js";
import { supabaseClient } from "../../src/client.js";

/** A photo, shrunk to a JPEG the marker can read (longest side 1600 px). */
export async function photoToJpeg(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c.toDataURL("image/jpeg", 0.82).split(",")[1];
}

/** Ask Pan to mark a photographed answer. { out } or { error: "off" | "limit" | "failed" }. */
export async function markPhoto(q, { image, code, subject, fetchImpl = fetch }) {
  try {
    const { data } = await supabaseClient.auth.getSession();
    const res = await fetchImpl("/api/mark", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token || ""}` },
      body: JSON.stringify({ image, q: q.q, scheme: q.scheme, ans: q.ans || "", subject, paper: q.paper, tips: tipsFor(code, q.paper) }),
    });
    if (res.status === 501 || res.status === 404) return { error: "off" };
    if (res.status === 429) return { error: "limit" };
    if (!res.ok || !/json/.test(res.headers.get("content-type") || "")) return { error: "failed" };
    const out = await res.json();
    return Array.isArray(out.points) ? { out } : { error: "failed" };
  } catch {
    return { error: "failed" };
  }
}

const MARKS = [["all", "All"], ["1", "1–2 marks"], ["3", "3–4 marks"], ["5", "5+ marks"]];
const inBand = (m, band) => band === "all" || (band === "1" ? m <= 2 : band === "3" ? m >= 3 && m <= 4 : m >= 5);

/** Every exam-style question a subject's chosen papers examine. */
export function examQuestionsOf(subjectId) {
  const out = [];
  for (const tp of scopeOf(subjectId)) for (const [i, q] of (tp.long || []).entries()) out.push({ ...q, key: `${tp.id}#${i}`, topic: tp.id, topicName: tp.name });
  return out;
}

export function hasExamQuestions(subjectId) {
  return scopeOf(subjectId).some((tp) => tp.long?.length);
}

export function openExamQuestions(subjectId) {
  const all = examQuestionsOf(subjectId);
  if (!all.length) return showToast("No exam-style questions for this subject yet.");
  const code = syllabi()[subjectId]?.code;
  const mine = profile().subjects.find((s) => s.id === subjectId)?.papers || [];
  const paperIds = [...new Set(all.map((q) => q.paper))].filter((id) => !mine.length || mine.includes(id)).sort();
  const done = new Map(); // key -> marks got, this time
  let paper = "all";
  let band = "all";
  let topic = "all";

  const stage = el("div", { class: "xq-stage" });
  const sheet = openSheet({ title: `Exam-style questions · ${nameOf(subjectId)}`, lead: "Answer on paper, then mark yourself with the scheme.", form: false, wide: true, body: [stage] });
  sheet.dialog.classList.add("exam-questions");
  sheet.dialog.style.setProperty("--subj", colourOf(subjectId));

  const chips = (label, options, value, onPick, cls) =>
    el("div", { class: `chips ${cls}`, role: "radiogroup", "aria-label": label }, options.map(([v, text]) => el("button", { type: "button", role: "radio", class: "chip", "data-value": v, "aria-checked": String(v === value), text, onClick: () => onPick(v) })));

  function list() {
    const shown = all.filter((q) => (paper === "all" || q.paper === paper) && inBand(q.marks, band) && (topic === "all" || q.topic === topic) && (!mine.length || mine.includes(q.paper)));
    const topics = [...new Map(all.map((q) => [q.topic, q.topicName])).entries()];
    const topicSel = el("select", { class: "input xq-topic", "aria-label": "Topic" }, [el("option", { value: "all", text: "All topics" }), ...topics.map(([id, name]) => el("option", { value: id, text: name }))]);
    topicSel.value = topic;
    topicSel.addEventListener("change", () => ((topic = topicSel.value), list()));
    const total = shown.reduce((n, q) => n + q.marks, 0);
    stage.replaceChildren(
      paperIds.length > 1 ? chips("Paper", [["all", "All papers"], ...paperIds.map((id) => [id, `Paper ${id}${PP.paperOf(code, id) ? ` · ${PP.paperOf(code, id).name}` : ""}`])], paper, (v) => ((paper = v), list()), "xq-papers") : null,
      chips("Marks", MARKS, band, (v) => ((band = v), list()), "xq-marks"),
      topicSel,
      el("p", { class: "faint small", text: `${shown.length} question${shown.length === 1 ? "" : "s"} · ${total} marks` }),
      shown.length
        ? el(
            "ol",
            { class: "xq-list" },
            shown.map((q) =>
              el("li", {}, [
                el("button", { type: "button", class: "xq-item", "data-key": q.key, onClick: () => one(q, shown) }, [
                  el("span", { class: "xq-meta" }, [el("b", { text: `[${q.marks}]` }), ` Paper ${q.paper} · ${q.topicName.replace(/^[^:]+: /, "")}`, q.fig ? " · diagram" : ""]),
                  el("span", { class: "xq-q", text: q.q }),
                  done.has(q.key) ? el("span", { class: "xq-done", text: `${done.get(q.key)}/${q.marks}` }) : null,
                ]),
              ])
            )
          )
        : el("p", { class: "faint", text: "Nothing here with these filters." })
    );
  }

  function one(q, shown) {
    const fig = q.fig ? el("figure", { class: "xq-fig" }, [el("img", { src: q.fig, alt: "Diagram for the question", decoding: "async" })]) : null;
    const scheme = el("div", { class: "xq-scheme", hidden: true });
    const ticks = q.scheme.map(() => false);
    const score = el("p", { class: "xq-score", "aria-live": "polite" });
    const save = el("button", { type: "button", class: "btn btn-primary", id: "xq-save", text: "Save my marks", hidden: true });
    const showScore = () => (score.textContent = `${ticks.filter(Boolean).length} of ${q.marks} marks`);
    scheme.append(
      el("p", { class: "pp-h", text: "Mark scheme: tick each mark you earned" }),
      el(
        "ul",
        { class: "xq-points" },
        q.scheme.map((pt, i) => {
          const box = el("input", { type: "checkbox", id: `xq-pt-${i}` });
          box.addEventListener("change", () => ((ticks[i] = box.checked), showScore()));
          return el("li", {}, [el("label", {}, [box, el("span", { text: pt })]), el("span", { class: "xq-note faint small", hidden: true })]);
        })
      ),
      q.ans ? el("p", { class: "xq-ans" }, [el("b", { text: "Answer: " }), q.ans]) : null,
      score
    );
    const open = () => ((scheme.hidden = false), (reveal.hidden = true), (save.hidden = false), showScore());
    const reveal = el("button", { type: "button", class: "btn btn-ghost", id: "xq-reveal", text: "Show the mark scheme", onClick: () => (open(), scheme.querySelector("input")?.focus()) });
    // Photo marking: Pan reads the answer and ticks the scheme; the student can change any tick.
    const verdict = el("div", { class: "xq-verdict", "aria-live": "polite", hidden: true });
    const file = el("input", { type: "file", accept: "image/*", capture: "environment", id: "xq-photo", hidden: true });
    const snap = el("button", { type: "button", class: "btn btn-ghost", id: "xq-snap", text: "Mark a photo of my answer", onClick: () => file.click() });
    file.addEventListener("change", async () => {
      const f = file.files?.[0];
      file.value = "";
      if (!f) return;
      snap.disabled = true;
      snap.textContent = "Pan is marking…";
      let image = null;
      try {
        image = await photoToJpeg(f);
      } catch {
        image = null;
      }
      const r = image ? await markPhoto(q, { image, code, subject: nameOf(subjectId) }) : { error: "failed" };
      snap.disabled = false;
      snap.textContent = "Mark another photo";
      open();
      if (r.error) {
        verdict.hidden = false;
        verdict.replaceChildren(el("p", { text: r.error === "off" ? "Photo marking isn't switched on yet. Mark yourself with the scheme below." : r.error === "limit" ? "Pan's resting until tomorrow (30 asks a day). Mark yourself with the scheme below." : "Pan couldn't mark that photo. Try a clearer one, or mark yourself below." }));
        return;
      }
      const { out } = r;
      scheme.querySelectorAll(".xq-points > li").forEach((li, i) => {
        const box = li.querySelector("input");
        box.checked = ticks[i] = out.points[i]?.earned === true;
        const note = li.querySelector(".xq-note");
        note.textContent = out.points[i]?.note || "";
        note.hidden = !note.textContent;
      });
      showScore();
      verdict.hidden = false;
      verdict.replaceChildren(
        el("p", { class: "pp-h", text: out.legible ? "Examiner's comment" : "Pan couldn't read it" }),
        el("p", { text: out.examiner }),
        out.next ? el("p", {}, [el("b", { text: "Next: " }), out.next]) : null,
        el("p", { class: "faint small", text: "Marked by Pan from your photo, which isn't kept. Change any tick you disagree with, then save." })
      );
    });
    const tips = tipsFor(code, q.paper);
    const advice = tips.length
      ? el("details", { class: "xq-tips" }, [el("summary", { text: "What the examiners say" }), el("ul", {}, tips.map((t) => el("li", { text: t }))), el("p", { class: "faint small", text: SOURCE })])
      : null;
    save.addEventListener("click", async () => {
      save.disabled = true;
      const now = Date.now();
      const got = ticks.filter(Boolean).length;
      // Half the marks or more: the topic has clearly been taught.
      let t = stateOf(subjectId, q.topic);
      if (got * 2 >= q.marks) t = { ...t, covered: 1 };
      t = P.afterBlock(t, { kind: "practice", answers: ticks.map((correct) => ({ correct, options: 0 })), now });
      const { error } = await saveTopic(subjectId, q.topic, t);
      save.disabled = false;
      if (error) return reportError(error, "Couldn't save your marks.");
      // Kept for the world (phase 37): about a minute and a half a mark.
      const logged = await api.addLog({ kind: "questions", minutes: Math.min(720, Math.max(1, Math.round(q.marks * 1.5))), marks: got, out_of: q.marks, occurred_on: dayKey(new Date()), note: `${nameOf(subjectId)} · Paper ${q.paper}`.slice(0, 140) });
      if (logged.error) console.error(logged.error);
      done.set(q.key, got);
      showToast(`${got}/${q.marks} saved to ${q.topicName.replace(/^[^:]+: /, "")}.`, "success");
      const i = shown.indexOf(q);
      if (i >= 0 && i + 1 < shown.length) one(shown[i + 1], shown);
      else list();
    });
    stage.replaceChildren(
      el("button", { type: "button", class: "link-btn xq-back", text: "← All questions", onClick: list }),
      el("p", { class: "xq-meta" }, [el("b", { text: `[${q.marks} mark${q.marks === 1 ? "" : "s"}]` }), ` Paper ${q.paper} · ${q.topicName}`]),
      el("p", { class: "xq-text", text: q.q }),
      fig,
      el("p", { class: "faint small", text: "Write your full working on paper first." }),
      advice,
      el("div", { class: "xq-row" }, [reveal, snap, save, file]),
      verdict,
      scheme
    );
    reveal.focus();
  }

  list();
  return sheet;
}
