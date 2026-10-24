// Customize the plan (phase 32): tell Pan, or set it yourself. Both make
// the same changes (model/rules.js); Pan's are shown first and applied
// only when the student says so. Pan is functions/api/pan.js; without it
// (no key set, offline) simple sentences are understood here instead.
import { el, openSheet, reportError, showToast } from "./ui.js";
import { supabaseClient } from "../../src/client.js";
import * as R from "./model/rules.js";
import { clockOfText } from "./model/time.js";
import { profile, nameOf, planRules, changePlan, saveRules } from "./planner.js";
import { artImg } from "./art.js";
import { createPan } from "./motion-art.js";

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CAPS = [[30, "30 min"], [60, "1 h"], [90, "1 h 30"], [120, "2 h"], [180, "3 h"], [240, "4 h"]];
const WEIGHTS = [[0, "Paused"], [0.5, "Less"], [1, "Normal"], [1.5, "More"], [2, "A lot more"]];

const subjectsList = () => profile().subjects.map((s) => ({ id: s.id, name: nameOf(s.id), aliases: s.id === "math" ? ["maths", "math"] : [] }));
const words = () => ({ nameOf, clock: clockOfText, now: Date.now() });

/** Ask Pan; if Pan can't be reached, understand the sentence here. */
export async function askPan(text, { fetchImpl = fetch } = {}) {
  const subjects = subjectsList();
  const now = new Date();
  const local = () => ({ ...R.understand(text, { subjects, now: now.getTime() }), local: true });
  try {
    const { data } = await supabaseClient.auth.getSession();
    const res = await fetchImpl("/api/pan", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token || ""}` },
      body: JSON.stringify({ text, today: R.dateKey(now.getTime()), weekday: now.getDay(), subjects: subjects.map(({ id, name }) => ({ id, name })), rules: planRules() }),
    });
    if (res.status === 429) {
      // The day's asks are used up (30 a day): still understand what we can.
      const mine = local();
      return { ...mine, summary: `Pan's resting until tomorrow (30 asks a day).${mine.changes.length ? " Here's what I understood myself:" : " You can still set it yourself below."}` };
    }
    if (!res.ok || !/json/.test(res.headers.get("content-type") || "")) return local();
    const out = await res.json();
    return Array.isArray(out.changes) ? { summary: out.summary || "", changes: out.changes } : local();
  } catch {
    return local();
  }
}

function panArt() {
  return artImg("pan-think", { cls: "cz-pan" }) || Object.assign(createPan({ size: 72, pose: "think" }).canvas, { className: "cz-pan pan-live" });
}

/** The Customize sheet. */
export function openCustomize() {
  const preview = el("div", { class: "cz-preview", id: "cz-preview", "aria-live": "polite" });
  const text = el("textarea", { id: "cz-text", class: "input", rows: "2", maxlength: "500", placeholder: "e.g. Sundays off, only an hour on Saturday, more maths", "aria-label": "Tell Pan what to change" });
  const ask = el("button", { type: "button", class: "btn btn-primary", id: "cz-ask", text: "Ask Pan" });
  const subj = subjectsList();
  const examples = ["Sundays off", "Only 1 hour on Saturday", subj[0] ? `More ${subj[0].name.toLowerCase()}` : "Start after 5 pm", "Skip tomorrow"];
  const chips = el(
    "div",
    { class: "chips cz-examples", "aria-label": "Examples" },
    examples.map((x) => el("button", { type: "button", class: "chip", text: x, onClick: () => { text.value = x; text.focus(); } }))
  );

  async function run() {
    const said = text.value.trim();
    if (!said) return text.focus();
    ask.disabled = true;
    preview.replaceChildren(el("p", { class: "faint", text: "Pan is thinking…" }));
    const out = await askPan(said);
    ask.disabled = false;
    if (!out.changes.length) {
      preview.replaceChildren(
        el("p", { class: "cz-summary", text: out.summary || "Pan didn't catch a change to make. Try something like “Sundays off” or “more maths”." })
      );
      return;
    }
    const apply = el("button", { type: "button", class: "btn btn-primary", id: "cz-apply", text: "Apply" });
    apply.addEventListener("click", async () => {
      apply.disabled = true;
      const { error } = await changePlan(out.changes);
      if (error) {
        apply.disabled = false;
        return reportError(error, "Couldn't change the plan. Try again.");
      }
      text.value = "";
      preview.replaceChildren(el("p", { class: "cz-summary", text: "Done. Your plan has re-planned around it." }));
      showToast("Plan updated");
      refresh();
    });
    preview.replaceChildren(
      out.summary ? el("p", { class: "cz-summary", text: out.summary }) : null,
      el("ul", { class: "cz-changes" }, out.changes.map((c) => el("li", { text: R.describeChange(c, words()) })).filter((li) => li.textContent)),
      el("div", { class: "cz-row" }, [apply, el("button", { type: "button", class: "btn btn-quiet", id: "cz-cancel", text: "Not this", onClick: () => preview.replaceChildren() })])
    );
    apply.focus();
  }
  ask.addEventListener("click", run);
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      run();
    }
  });

  // ---- by hand ----
  const own = el("div", { class: "cz-own" });
  async function change(changes) {
    const { error } = await changePlan(changes);
    if (error) return reportError(error, "Couldn't change the plan. Try again.");
    refresh();
  }

  function refresh() {
    const r = planRules();
    const days = el(
      "div",
      { class: "cz-days" },
      ORDER.map((d) => {
        const val = r.off.includes(d) ? "off" : r.minutes[d] != null ? String(r.minutes[d]) : "";
        const sel = el("select", { id: `cz-day-${d}`, class: "input", "aria-label": WD[d] }, [
          el("option", { value: "", text: "As planned" }),
          el("option", { value: "off", text: "Off" }),
          ...CAPS.map(([m, t]) => el("option", { value: String(m), text: `At most ${t}` })),
        ]);
        sel.value = val;
        sel.addEventListener("change", () => change([sel.value === "off" ? { op: "day_off", weekday: d } : sel.value ? { op: "day_minutes", weekday: d, minutes: Number(sel.value) } : { op: r.off.includes(d) ? "day_on" : "day_minutes", weekday: d, minutes: null }]));
        return el("label", { class: "cz-day" }, [el("span", { text: WD[d].slice(0, 3) }), sel]);
      })
    );
    const start = el("input", { type: "time", id: "cz-start", class: "input", value: r.start || "", "aria-label": "Nothing before" });
    start.addEventListener("change", () => change([{ op: "start_after", time: start.value || null }]));
    const subjects = el(
      "div",
      { class: "cz-subjects" },
      subj.map((s) => {
        const sel = el("select", { id: `cz-subj-${s.id}`, class: "input", "aria-label": s.name }, WEIGHTS.map(([w, t]) => el("option", { value: String(w), text: t })));
        sel.value = String(r.weight[s.id] ?? 1);
        sel.addEventListener("change", () => change([{ op: "subject_weight", subject: s.id, weight: Number(sel.value) }]));
        return el("label", { class: "cz-subject" }, [el("span", { text: s.name }), sel]);
      })
    );
    const lines = R.describe(r, words());
    const list = lines.length
      ? el("ul", { class: "cz-list", id: "cz-list" }, lines.map((l) => el("li", {}, [el("span", { text: l.text }), el("button", { type: "button", class: "link-btn", text: "Undo", "aria-label": `Undo: ${l.text}`, onClick: async () => { const { error } = await saveRules(R.undo(planRules(), l.undo, { subjects: subj.map((x) => x.id) })); if (error) return reportError(error, "Couldn't change the plan. Try again."); refresh(); } })])))
      : el("p", { class: "faint", id: "cz-list", text: "No changes yet: this is the plan as the planner made it." });
    own.replaceChildren(
      el("h3", { class: "cz-h", text: "Set it yourself" }),
      el("p", { class: "cz-label", text: "How much on each day" }),
      days,
      el("label", { class: "cz-start" }, [el("span", { class: "cz-label", text: "Nothing before" }), start]),
      el("p", { class: "cz-label", text: "Subjects" }),
      subjects,
      el("div", { class: "cz-row cz-yours" }, [el("h3", { class: "cz-h", text: "Your changes" }), lines.length ? el("button", { type: "button", class: "btn btn-quiet", id: "cz-reset", text: "Reset all", onClick: () => change([{ op: "reset" }]) }) : null]),
      list
    );
  }
  refresh();

  const sheet = openSheet({
    title: "Customize your plan",
    lead: "Tell Pan, or set it yourself. Either way, the week re-plans around it.",
    form: false,
    wide: true,
    body: [
      el("section", { class: "cz-ask" }, [panArt(), el("div", { class: "cz-ask-main" }, [el("h3", { class: "cz-h", text: "Tell Pan" }), text, chips, el("div", { class: "cz-row" }, [ask]), preview])]),
      own,
    ],
  });
  sheet.dialog.classList.add("customize");
  text.focus();
  return sheet;
}
