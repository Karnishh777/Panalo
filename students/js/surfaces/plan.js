// Plan: the week the planner made, and why (v0.2).
//
// Quiet on purpose. One thing first -- the next block, one tap from
// starting -- then the week as plain rows, then each subject as a map of
// its topics: grey until met, then coloured by how well they're known.
// Nothing here needs filling in; the plan is rebuilt from what the student
// does, so a missed day simply re-plans.
import { el, emptyState, openSheet, field, reportError, showToast, shortDate } from "../ui.js";
import { store, on } from "../store.js";
import * as L from "../model/learner.js";
import * as P from "../model/plan.js";
import { weekCapacity } from "../model/capacity.js";
import { formatMinutes, DAY, clockOf } from "../model/time.js";
import { reducedMotion, lively } from "../motion.js";
import { hasPlan, profile, loadBanks, banksReady, currentPlan, subjectView, colourOf, nameOf, stateOf, saveTopic, addResult } from "../planner.js";
import { startBlock } from "../block-check.js";
import { art, artImg, onArt, GUARDIANS, guardianOf } from "../art.js";
import { createEmblem, createPan, createAura } from "../motion-art.js";

let root;
let body;
let unsubs = [];

const hhmm = (m) => clockOf(m);
const pct = (x) => `${Math.round(x * 100)}%`;

function dayLabel(ms, i) {
  if (i === 0) return "Today";
  if (i === 1) return "Tomorrow";
  return new Date(ms).toLocaleDateString(undefined, { weekday: "long" });
}

function blockLine(b, { time = false } = {}) {
  return el("li", { class: `pl-block k-${b.kind}`, style: `--subj:${colourOf(b.subject)}` }, [
    time ? el("span", { class: "pl-time num faint", text: hhmm(b.start) }) : null,
    el("i", { class: "pl-dot", "aria-hidden": "true" }),
    el("span", { class: "pl-what" }, [el("b", { text: b.own ? b.subjectName : b.topicName }), el("small", { class: "faint", text: b.own ? P.KINDS[b.kind].verb : `${b.subjectName} · ${P.KINDS[b.kind].label}` })]),
    el("span", { class: "pl-min num faint", text: `${b.minutes} min` }),
  ]);
}

// The one thing: the next block, big, with its subject's glow behind it.
// With today done, it is tomorrow's first -- startable now, if wanted.
function heroText(plan, next, di) {
  const when = di === 0 ? hhmm(next.start) : `${dayLabel(plan[di].date, di)}, ${hhmm(next.start)}`;
  return [
    el("p", { class: "pl-hero-kicker" }, [el("span", { text: di === 0 ? "Next" : "Today's plan is done · next" }), el("span", { class: "num faint", text: ` · ${when}` })]),
    el("h2", { class: "pl-hero-title", id: "pl-next", text: next.own ? next.subjectName : next.topicName }),
    el("p", { class: "pl-hero-sub" }, [next.own ? "" : `${next.subjectName} · `, el("b", { text: P.KINDS[next.kind].label }), ` · ${next.minutes} min — ${P.KINDS[next.kind].verb.toLowerCase()}`]),
    el("div", { class: "pl-hero-go" }, [
      el("button", { type: "button", class: di === 0 ? "btn btn-primary" : "btn btn-ghost", id: "plan-start", text: di === 0 ? "Start" : "Start it now", onClick: () => startBlock(next) }),
      plan[di].blocks.length > 1 ? el("button", { type: "button", class: "btn btn-quiet", id: "plan-unsure", text: "Not sure? Pick from three", onClick: () => deck(plan[di].blocks.slice(0, 3)) }) : null,
    ]),
  ];
}

function hero(plan) {
  const di = plan.findIndex((d) => d.blocks.length);
  const next = di >= 0 ? plan[di].blocks[0] : null;
  if (!next) {
    return el("section", { class: "pl-hero quiet" }, [el("p", { class: "pl-hero-kicker faint", text: "This week" }), el("p", { class: "pl-hero-title", text: "Nothing to plan this week." })]);
  }
  const fams = [...new Set(profile().subjects.map((s) => guardianOf(s.id)))];
  if (fams.length) return stage(plan, fams);
  return el("section", { class: "pl-hero", style: `--subj:${colourOf(next.subject)}`, "aria-labelledby": "pl-next" }, [...heroText(plan, next, di), pan("idle", "pl-pan")]);
}

// The stage: the student's subjects as a row, small, grey and faint; the
// chosen one steps forward large and in colour, with its glow, its scene
// and its own effect (circuits carrying data for computing, arcs for
// physics ...), and its subject's next block sits beside it. With the guardian paintings (art.js) the row
// is a lineup of portraits; without them, the chosen subject's coded
// emblem (motion-art.js) plays large above a strip of small ones. Left
// and right (or a tap) move along the row.
function stage(plan, fams) {
  const flat = plan.flatMap((d, di) => d.blocks.map((b, bi) => ({ b, di, bi })));
  const firstFor = (f) => flat.find((x) => guardianOf(x.b.subject) === f);
  const lead = flat[0];
  const painted = fams.every((f) => art(`guardian-${f}`));
  let sel = fams.includes(guardianOf(lead.b.subject)) ? guardianOf(lead.b.subject) : fams[0];
  const sceneA = el("div", { class: "st-scene" });
  const sceneB = el("div", { class: "st-scene" });
  let front = sceneA;
  const info = el("div", { class: "st-info" });
  const row = el("div", { class: `st-lineup${painted ? "" : " strip"}`, role: "toolbar", "aria-label": "Your subjects" });
  const feature = painted ? null : el("div", { class: "st-feature", "aria-hidden": "true" });
  const right = el("div", { class: "st-right" }, [feature, row].filter(Boolean));
  const root = el("section", { class: "pl-stage", "aria-labelledby": "pl-next" }, [sceneA, sceneB, info, right]);
  const big = new Map();
  let playing = null;
  const aura = createAura({ always: lively });
  const pick = (f, focus = false) => {
    sel = f;
    root.style.setProperty("--subj", GUARDIANS[f]);
    for (const btn of row.children) {
      const on = btn.dataset.f === f;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", String(on));
      if (on && focus) btn.focus();
      if (on && painted) btn.append(aura.canvas);
    }
    if (feature) {
      if (!big.has(f)) big.set(f, createEmblem(f, GUARDIANS[f], { width: 300, height: 260 }));
      playing?.setActive(false);
      playing = big.get(f);
      playing.setActive(true);
      feature.replaceChildren(playing.canvas, aura.canvas);
    }
    // Sized once the chosen one has its new size (after the transition starts).
    requestAnimationFrame(() => {
      const host = aura.canvas.parentElement;
      if (host) aura.show(f, GUARDIANS[f], aura.canvas.offsetWidth, aura.canvas.offsetHeight);
    });
    const src = art(`scene-${f}`);
    const back = front === sceneA ? sceneB : sceneA;
    back.style.backgroundImage = src ? `url("${src}")` : "";
    back.classList.add("show");
    front.classList.remove("show");
    front = back;
    const x = firstFor(f) || lead;
    info.replaceChildren(...heroText(plan, x.b, x.di));
  };
  fams.forEach((f, i) => {
    const subj = profile().subjects.filter((s) => guardianOf(s.id) === f).map((s) => nameOf(s.id)).join(", ");
    row.append(
      el(
        "button",
        {
          type: "button",
          class: "st-guard",
          "data-f": f,
          style: `--g:${GUARDIANS[f]};--i:${i};--n:${fams.length}`,
          "aria-label": subj,
          title: subj,
          onClick: () => pick(f),
          onKeydown: (e) => {
            const k = fams.indexOf(f) + (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0);
            if (k !== fams.indexOf(f) && fams[k]) (e.preventDefault(), pick(fams[k], true));
          },
        },
        [painted ? artImg(`guardian-${f}`, { cls: "st-img" }) : el("span", { class: "st-emblem" }, [createEmblem(f, GUARDIANS[f], { width: 64, height: 64 }).canvas]), painted ? null : el("small", { class: "st-name", text: subj.split(",")[0] })]
      )
    );
  });
  pick(sel);
  return root;
}

// Pan, the mascot: the painting if there is one, else the live one.
function pan(pose, cls) {
  return artImg(`pan-${pose}`, { cls: `pan ${cls}` }) || Object.assign(createPan({ size: 120, pose }).canvas, { className: `pan pan-live ${cls}` });
}

function week(plan) {
  return el("section", { class: "pl-week", "aria-labelledby": "pl-week-h" }, [
    el("h2", { id: "pl-week-h", class: "pl-h", text: "The week" }),
    el(
      "ol",
      { class: "pl-days" },
      plan.map((d, i) =>
        el("li", { class: `pl-day${i === 0 ? " today" : ""}${d.light ? " light" : ""}` }, [
          el("div", { class: "pl-day-head" }, [
            el("b", { text: dayLabel(d.date, i) }),
            el("span", { class: "faint", text: d.blocks.length ? `${formatMinutes(d.minutes)}${d.light ? " · lighter day" : ""}` : d.light ? "lighter day" : "free" }),
          ]),
          d.blocks.length ? el("ul", { class: "pl-blocks" }, d.blocks.map((b) => blockLine(b, { time: i === 0 }))) : null,
        ])
      )
    ),
  ]);
}

function examLine(v, now) {
  if (!v.examAt) return null;
  const days = Math.ceil((v.examAt - now) / DAY);
  return el("span", { class: "pl-exam", text: days <= 0 ? "Exam today" : days === 1 ? "Exam tomorrow" : `Exam in ${days} days` });
}

// A subject: how ready, and its topics as dots, grey until met.
function subjectCard(s, now) {
  const v = subjectView(s, now);
  const colour = colourOf(s.id);
  const dots = v.own
    ? el("p", { class: "faint small", text: "No question bank for this subject yet: your plan gives it blocks of your own work." })
    : el(
        "ol",
        { class: "pl-topics", "aria-label": `${v.name} topics` },
        v.list.map((tp) => {
          const t = v.states[tp.id];
          const met = t && !(t.n === 0 && t.covered === 0 && t.minutes === 0);
          const m = met ? L.mastery(t) : 0;
          const due = t && L.dueAt(t, { examAt: v.examAt, now });
          const state = !met ? "not started" : t.covered < 1 ? `${pct(t.covered)} covered` : `${pct(m)} known`;
          return el(
            "li",
            {},
            el("button", {
              type: "button",
              class: `pl-topic${met ? " met" : ""}${due && due <= now ? " due" : ""}`,
              style: met ? `--m:${m.toFixed(2)}` : null,
              "aria-label": `${tp.name}: ${state}`,
              title: `${tp.name} — ${state}`,
              onClick: () => topicSheet(s.id, tp),
            })
          );
        })
      );
  const ready = v.readiness;
  return el("article", { class: "pl-subject", style: `--subj:${colour}` }, [
    el("div", { class: "pl-subject-head" }, [
      el("h3", {}, [v.name, v.code ? el("span", { class: "faint num", text: ` ${v.code}` }) : null]),
      examLine(v, now),
    ]),
    v.own
      ? null
      : el("div", { class: "pl-ready" }, [
          el("span", { class: "meter", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(ready * 100)), "aria-label": `${v.name}: ready` }, [el("i", { style: `width:${pct(ready)}` }), el("b", { class: "pl-aim", style: `left:${pct(v.target)}`, title: "Your aim" })]),
          el("span", { class: "num small", text: pct(ready) }),
        ]),
    dots,
    v.pace?.n >= 3 ? el("p", { class: "faint small", text: v.pace.pace > 1.15 ? `You take a little longer here (×${v.pace.pace.toFixed(1)}): your plan allows for it.` : v.pace.pace < 0.85 ? `You move quickly here (×${v.pace.pace.toFixed(1)}).` : "Your pace here is about typical." }) : null,
  ]);
}

function subjects(now) {
  const p = profile();
  return el("section", { class: "pl-subjects-wrap", "aria-labelledby": "pl-subj-h" }, [
    el("div", { class: "pl-row-head" }, [
      el("h2", { id: "pl-subj-h", class: "pl-h", text: "Your subjects" }),
      el("span", { class: "pl-legend faint small" }, [el("i", { class: "pl-topic" }), " not started ", el("i", { class: "pl-topic met", style: "--m:.85" }), " known ", el("i", { class: "pl-topic met due", style: "--m:.6" }), " review due"]),
    ]),
    el("div", { class: "pl-subjects" }, p.subjects.map((s) => subjectCard(s, now))),
  ]);
}

function results() {
  const list = store.results.slice(0, 8);
  return el("section", { class: "pl-results", "aria-labelledby": "pl-res-h" }, [
    el("div", { class: "pl-row-head" }, [
      el("h2", { id: "pl-res-h", class: "pl-h", text: "Results" }),
      el("button", { type: "button", class: "btn btn-quiet btn-sm", id: "plan-add-result", text: "Add a result", onClick: resultSheet, disabled: store.progressMissing || null }),
    ]),
    list.length
      ? el(
          "ul",
          { class: "pl-res-list" },
          list.map((r) =>
            el("li", { style: `--subj:${colourOf(r.subject)}` }, [
              el("i", { class: "pl-dot", "aria-hidden": "true" }),
              el("span", {}, [el("b", { text: r.title }), el("small", { class: "faint", text: ` ${nameOf(r.subject)} · ${shortDate(r.taken_on)}` })]),
              el("span", { class: "num", text: `${Number(r.score)}/${Number(r.out_of)} · ${pct(r.score / r.out_of)}` }),
            ])
          )
        )
      : el("p", { class: "faint small", text: "Tests, mocks, past papers: add the mark and the plan leans towards what it shows." }),
  ]);
}

function render() {
  if (!root) return;
  if (!hasPlan()) {
    body.replaceChildren(emptyState("No plan yet.", "Answer a few questions about your subjects and your week, and Panalo plans it for you."), el("p", {}, [el("a", { class: "btn btn-primary", href: "#/settings", text: "Set up my plan" })]));
    return;
  }
  if (!banksReady()) {
    body.replaceChildren(el("p", { class: "faint", text: "Planning your week…" }));
    loadBanks();
    return;
  }
  const now = Date.now();
  const plan = currentPlan({ now });
  const cap = weekCapacity(profile());
  const total = cap.reduce((n, d) => n + d.planned, 0);
  const light = cap.find((d) => d.light);
  const shortSleep = cap.some((d) => d.shortSleep);
  const summary = el("p", { class: "s-sub" }, [
    profile().boarding && profile().prepStart
      ? `About ${formatMinutes(total)} a week: your evening prep on school days, and around sleep at weekends. A fifth is kept free`
      : `About ${formatMinutes(total)} a week, fitted around school${profile().tuitionHours ? ", tuition" : ""} and sleep. A fifth of your free time is kept free`,
    light ? `, and ${new Date(2026, 0, 4 + light.day).toLocaleDateString(undefined, { weekday: "long" })} is lighter.` : ".",
    " ",
    el("a", { href: "#/settings", class: "faint", text: "Change my answers" }),
  ]);
  body.replaceChildren(
    ...[
      summary,
      shortSleep ? el("p", { class: "pl-note", text: "Your bedtime leaves under 8 hours of sleep, so your plan stops 8 hours before you wake. Teenagers need 8 to 10." }) : null,
      store.progressMissing ? el("p", { class: "pl-note", text: "This Panalo can't save progress yet (supabase-phase30.sql). The plan shows, but checks won't be kept." }) : null,
      hero(plan),
      el("div", { class: "pl-grid" }, [week(plan), el("div", { class: "pl-side" }, [subjects(now), results()])]),
    ].filter(Boolean)
  );
}

// ---- Sheets ------------------------------------------------------------------------------

function topicSheet(subject, tp) {
  const t = stateOf(subject, tp.id);
  const now = Date.now();
  const v = subjectView(profile().subjects.find((s) => s.id === subject), now);
  const met = !(t.n === 0 && t.covered === 0 && t.minutes === 0);
  const due = L.dueAt(t, { examAt: v.examAt, now });
  const rows = [
    ["Known", met ? pct(L.mastery(t)) : "not checked yet"],
    ["Covered", pct(t.covered)],
    ["Time on it", t.minutes ? formatMinutes(t.minutes) : "none yet"],
    ["Next review", due ? (due <= now ? "due now" : shortDate(new Date(due).toISOString())) : "after it's covered"],
  ];
  const kind = !met ? "check" : t.covered < 1 ? "learn" : due && due <= now ? "review" : "practice";
  const block = { kind, subject, topic: tp.id, minutes: P.KINDS[kind].minutes };
  const sheet = openSheet({
    title: tp.name,
    lead: `${nameOf(subject)}${tp.stage ? ` · ${tp.stage === "as" ? "AS" : "A2"}` : ""}`,
    form: false,
    body: [el("dl", { class: "pl-facts" }, rows.flatMap(([k, val]) => [el("dt", { text: k }), el("dd", { text: val })]))],
    actions: [
      t.covered < 1 && !store.progressMissing
        ? {
            label: "Covered at school",
            kind: "btn-quiet",
            onClick: async () => {
              const next = L.review({ ...t, covered: 1 }, 2, Date.now());
              const { error } = await saveTopic(subject, tp.id, next);
              if (error) return reportError(error), false;
              showToast("Marked as covered. A short review is planned.", "success");
            },
          }
        : null,
      { label: `${P.KINDS[kind].label} · ${block.minutes} min`, kind: "btn-primary", onClick: () => { sheet.close(); startBlock(block); return false; } },
    ].filter(Boolean),
  });
}

function resultSheet() {
  const p = profile();
  const subject = el("select", { class: "input", id: "res-subject" }, p.subjects.map((s) => el("option", { value: s.id, text: nameOf(s.id) })));
  const title = el("input", { type: "text", class: "input", id: "res-title", maxlength: "80", placeholder: "Mock, Paper 4" });
  const date = el("input", { type: "date", class: "input", id: "res-date", value: new Date().toLocaleDateString("en-CA"), max: new Date().toLocaleDateString("en-CA") });
  const score = el("input", { type: "number", class: "input", id: "res-score", min: "0", step: "0.5", inputmode: "decimal" });
  const outOf = el("input", { type: "number", class: "input", id: "res-out", min: "1", step: "0.5", inputmode: "decimal", value: "100" });
  const topicsBox = el("fieldset", { class: "res-topics" });
  const drawTopics = () => {
    const v = subjectView(p.subjects.find((s) => s.id === subject.value), Date.now());
    topicsBox.replaceChildren(
      el("legend", { text: "Which topics did it cover? Leave empty for the whole course." }),
      ...(v.own ? [] : v.list.map((tp) => el("label", { class: "res-topic" }, [el("input", { type: "checkbox", value: tp.id }), el("span", { text: tp.name })])))
    );
  };
  subject.addEventListener("change", drawTopics);
  drawTopics();
  openSheet({
    title: "Add a result",
    lead: "The mark pulls those topics towards it, so the plan spends time where marks were lost.",
    body: [field("Subject", subject), field("What was it", title), el("div", { class: "res-row" }, [field("Date", date), field("Score", score), field("Out of", outOf)]), topicsBox],
    actions: [
      { label: "Cancel", kind: "btn-quiet" },
      {
        label: "Add",
        kind: "btn-primary",
        submit: true,
        onClick: async (btn) => {
          const s = Number(score.value);
          const o = Number(outOf.value);
          if (!title.value.trim()) return showToast("Give it a name, like “Mock, Paper 4”."), title.focus(), false;
          if (!(o > 0 && o <= 1000) || !(s >= 0 && s <= o)) return showToast("The score should be between 0 and the total."), score.focus(), false;
          btn.disabled = true;
          const topics = [...topicsBox.querySelectorAll("input:checked")].map((x) => x.value).slice(0, 60);
          const { error } = await addResult({ subject: subject.value, title: title.value.trim().slice(0, 80), takenOn: date.value, score: s, outOf: o, topics });
          btn.disabled = false;
          if (error) return reportError(error, "Couldn't save that result."), false;
          showToast("Added. Your plan has adjusted.", "success");
        },
      },
    ],
  });
}

// "Not sure what to do?": three cards from today's plan. Left is "not
// now", start begins after a three-second count you can stop. The
// planner picks; the student chooses. No spinning, no chance.
function deck(cards) {
  let i = 0;
  let timer = null;
  const stage = el("div", { class: "deck-stage" });
  const sheet = openSheet({ title: "Pick one", lead: "Today's three best options.", form: false, body: [stage], onClose: () => clearInterval(timer) });
  sheet.dialog.classList.add("deck-sheet");
  const draw = () => {
    clearInterval(timer);
    const b = cards[i];
    const peek = cards.slice(i + 1, i + 3);
    stage.replaceChildren(
      el("div", { class: "deck" }, [
        ...peek.reverse().map((c, k) => el("div", { class: "deck-card peek", style: `--subj:${colourOf(c.subject)};--k:${peek.length - k}`, "aria-hidden": "true" })),
        el("div", { class: "deck-card", style: `--subj:${colourOf(b.subject)}` }, [
          el("span", { class: "deck-kind", text: `${P.KINDS[b.kind].label} · ${b.minutes} min` }),
          el("b", { class: "deck-title", text: b.own ? b.subjectName : b.topicName }),
          el("span", { class: "faint", text: b.own ? P.KINDS[b.kind].verb : b.subjectName }),
        ]),
      ]),
      el("div", { class: "deck-go" }, [
        el("button", { type: "button", class: "btn btn-quiet", id: "deck-skip", text: i + 1 < cards.length ? "Not now" : "Back to the first", onClick: () => { i = (i + 1) % cards.length; draw(); } }),
        el("button", { type: "button", class: "btn btn-primary", id: "deck-pick", text: "This one", onClick: () => count(b) }),
      ])
    );
  };
  const count = (b) => {
    let left = 3;
    const bar = el("span", { class: "deck-bar", style: `--subj:${colourOf(b.subject)}` }, [el("i")]);
    const label = el("b", { class: "num", text: `Starting in ${left}…` });
    stage.replaceChildren(
      el("div", { class: "deck-count", role: "status" }, [label, bar]),
      el("div", { class: "deck-go" }, [
        el("button", { type: "button", class: "btn btn-quiet", id: "deck-cancel", text: "Cancel", onClick: draw }),
        el("button", { type: "button", class: "btn btn-primary", id: "deck-now", text: "Start now", onClick: go }),
      ])
    );
    if (!reducedMotion()) requestAnimationFrame(() => bar.classList.add("run"));
    timer = setInterval(() => {
      left -= 1;
      if (left <= 0) return go();
      label.textContent = `Starting in ${left}…`;
    }, 1000);
    function go() {
      clearInterval(timer);
      sheet.close();
      startBlock(b);
    }
  };
  draw();
}

// ---- Surface -----------------------------------------------------------------------------

export function mount(section) {
  root = el("div", { class: "plan" });
  body = el("div", { class: "plan-body" });
  root.append(el("div", { class: "s-head" }, [el("p", { class: "kicker toned tone-focus", text: "Your plan" }), el("h1", { text: "This week" })]), body);
  section.append(root);
  unsubs.push(on("any", render));
}

export function show() {
  loadBanks();
  onArt(render);
  render();
}

export function hide() {}

export function destroy() {
  unsubs.forEach((u) => u());
  unsubs = [];
  root = null;
}
