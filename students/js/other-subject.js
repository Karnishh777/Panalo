// Other subjects (v0.2): add a subject Panalo doesn't list, by name and
// syllabus code; Pan works out its syllabus (functions/api/pan-subject.js)
// and the plan works topic by topic (model/custom.js). Without Pan (no
// key, offline, the day's asks used up) the subject is still added, and
// planned as blocks of your own work until Pan can be asked again.
import { el, openSheet, reportError, showToast } from "./ui.js";
import { supabaseClient } from "../../src/client.js";
import { api } from "./store.js";
import * as C from "./model/custom.js";
import { stageOf, BOARDS, subjectsFor } from "./model/subjects.js";
import { profile } from "./planner.js";

/** Ask Pan for a subject's syllabus: { syllabus, note } or { error }. */
export async function askPanSubject({ name, code, board, stage }, { fetchImpl = fetch } = {}) {
  try {
    const { data } = await supabaseClient.auth.getSession();
    const st = stageOf(stage);
    const res = await fetchImpl("/api/pan-subject", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token || ""}` },
      body: JSON.stringify({ name, code, board: BOARDS.find((b) => b.id === board)?.label || board || "", year: st ? `${st.label}${st.sub ? ` (${st.sub})` : ""}` : "" }),
    });
    if (res.status === 429) return { error: "Pan's resting until tomorrow (30 asks a day). The subject is added; ask Pan again tomorrow from Plan." };
    if (!res.ok || !/json/.test(res.headers.get("content-type") || "")) return { error: "Pan isn't available right now. The subject is added and planned as your own work; ask Pan again later from Plan." };
    const out = await res.json();
    const syllabus = C.cleanSyllabus({ ...out, topics: (out.topics || []).map((t) => ({ name: t.name, stage: t.stage })) });
    return syllabus ? { syllabus, note: out.note || "" } : { error: out.note || "Pan couldn't find topics for that subject. It's planned as your own work." };
  } catch {
    return { error: "Pan isn't available right now. The subject is added and planned as your own work; ask Pan again later from Plan." };
  }
}

/** A short line about what Pan found. */
export function foundLine(s) {
  if (!s) return "";
  const what = [s.board, s.name, s.code ? `(${s.code})` : ""].filter(Boolean).join(" ");
  return s.known ? `Pan found ${what}: ${s.topics.length} topics.` : `Pan's best guess: ${s.topics.length} topics. Check them against your syllabus in Plan.`;
}

/**
 * The setup's "Other subject": a name, a code, and Add. `answers` is the
 * setup's answers object; `onChange` redraws the step.
 */
export function otherSubjectForm(answers, onChange) {
  const name = el("input", { type: "text", class: "input", id: "other-name", maxlength: "40", placeholder: "Subject, e.g. Further Mathematics", "aria-label": "Subject name" });
  const code = el("input", { type: "text", class: "input", id: "other-code", maxlength: "12", placeholder: "Code, e.g. 9231", "aria-label": "Syllabus code (optional)" });
  const status = el("p", { class: "other-status faint small", "aria-live": "polite" });
  const add = el("button", {
    type: "button",
    class: "btn btn-ghost btn-sm",
    id: "other-add",
    text: "Add",
    onClick: async () => {
      const n = name.value.trim();
      if (!n) return name.focus();
      // Already listed? Then it's the listed one (with its questions and papers).
      const plain = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const listed = subjectsFor(answers.stage).find((s) => (code.value.trim() && s.code === code.value.trim()) || plain(s.name) === plain(n));
      if (listed) return showToast(`${listed.name}${listed.code ? ` ${listed.code}` : ""} is in the list above: tap it there.`);
      if (answers.subjects.filter((s) => s.custom).length >= C.MAX_CUSTOM) return showToast(`Up to ${C.MAX_CUSTOM} other subjects.`);
      const id = C.customId(n, answers.subjects.map((s) => s.id));
      const subject = C.cleanCustomSubject({ id, custom: true, name: n, code: code.value });
      if (!subject) return name.focus();
      answers.subjects.push({ ...subject, level: 2 });
      name.value = code.value = "";
      add.disabled = true;
      status.textContent = `Pan is looking up ${subject.name}${subject.code ? ` ${subject.code}` : ""}…`;
      onChange?.();
      const out = await askPanSubject({ name: subject.name, code: subject.code, board: answers.board, stage: answers.stage });
      add.disabled = false;
      if (out.syllabus) {
        answers.customSyllabi = { ...(answers.customSyllabi || {}), [id]: out.syllabus };
        status.textContent = foundLine(out.syllabus);
      } else status.textContent = out.error;
      onChange?.();
    },
  });
  return el("div", { class: "other-subject", id: "other-subject", hidden: true }, [el("div", { class: "other-row" }, [name, code, add]), status]);
}

/** Plan: an other subject's syllabus, to check, edit or ask Pan again. */
export function openCustomSyllabus(subject, current, { board, stage } = {}) {
  let syl = current ? { ...current, topics: current.topics.map((t) => ({ ...t })) } : null;
  const body = el("div", { class: "cs-body" });
  const note = el("p", { class: "faint small", "aria-live": "polite" });
  const draw = () => {
    const list = el(
      "ol",
      { class: "cs-topics", id: "cs-topics" },
      (syl?.topics || []).map((t, i) => {
        const input = el("input", { type: "text", class: "input", maxlength: "80", value: t.name, "aria-label": `Topic ${i + 1}` });
        input.addEventListener("input", () => (t.name = input.value));
        return el("li", {}, [input, el("button", { type: "button", class: "icon-btn sm", "aria-label": `Remove ${t.name}`, text: "✕", onClick: () => (syl.topics.splice(i, 1), draw()) })]);
      })
    );
    const addTopic = el("button", { type: "button", class: "link-btn", id: "cs-add", text: "Add a topic", onClick: () => { syl ||= { name: subject.name, code: subject.code || "", board: "", known: false, topics: [] }; syl.topics.push({ id: "", name: "" }); draw(); body.querySelector(".cs-topics li:last-child input")?.focus(); } });
    body.replaceChildren(syl ? el("p", { class: "small", text: foundLine(syl) }) : el("p", { class: "faint", text: "No topics yet: it's planned as blocks of your own work. Ask Pan, or add the topics yourself." }), list, addTopic);
  };
  draw();
  const again = el("button", {
    type: "button",
    class: "btn btn-ghost",
    id: "cs-ask",
    text: "Ask Pan again",
    onClick: async () => {
      again.disabled = true;
      note.textContent = "Pan is looking it up…";
      const out = await askPanSubject({ name: subject.name, code: subject.code, board, stage });
      again.disabled = false;
      if (out.syllabus) {
        syl = out.syllabus;
        note.textContent = out.note;
        draw();
      } else note.textContent = out.error;
    },
  });
  return openSheet({
    title: `Syllabus · ${subject.name}${subject.code ? ` ${subject.code}` : ""}`,
    lead: "The topics your plan works through, in order. Pan found them; check them against your syllabus and change anything.",
    form: false,
    wide: true,
    body: [body, el("div", { class: "cz-row" }, [again]), note],
    actions: [
      { label: "Cancel", kind: "btn-quiet" },
      {
        label: "Save",
        kind: "btn-primary",
        id: "cs-save",
        onClick: async (btn) => {
          const clean = syl ? C.cleanSyllabus(syl) : null;
          btn.disabled = true;
          const { error } = await saveCustomSyllabus(subject.id, clean);
          btn.disabled = false;
          if (error) return reportError(error, "Couldn't save the topics."), false;
          showToast(clean ? `Saved: ${clean.topics.length} topics. Your plan follows them.` : "Saved.", "success");
        },
      },
    ],
  });
}

/** Save one other subject's syllabus (or remove it with null). */
export function saveCustomSyllabus(subjectId, syllabus) {
  const all = { ...(profile().customSyllabi || {}) };
  if (syllabus) all[subjectId] = syllabus;
  else delete all[subjectId];
  return api.saveStudent({ custom_syllabi: all });
}
