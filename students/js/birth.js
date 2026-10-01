// The first time inside: a film about a universe beginning (film.js),
// then three questions over it while your new world turns.
//
// About 26 seconds, graded like a film, with a score and a voice-over
// (birth-score.js) and captions. "Skip" goes straight to the questions;
// reduced motion replaces the film with a line of text; if the film can't
// run at all, the questions appear immediately. The world that forms is
// the real one: seeded from your account, the same world the World page
// shows.
import { el, chipGroup, showToast, reportError } from "./ui.js";
import { reducedMotion } from "./motion.js";
import { createGlobe } from "./world-render.js";
import { createFilm, IGNITION, WORLDFALL, TITLE, LENGTH } from "./film.js";
import { createScore, setSoundWanted, speak, warmVoice } from "./birth-score.js";
import { INTERESTS } from "./model/drift-library.js";
import { api, store } from "./store.js";
import { state } from "../../src/state.js";

const $ = (id) => document.getElementById(id);
const NAMES = ["Halcyon", "Tamarind", "Velora", "Nadir", "Lumen", "Arka", "Cinder", "Meridian", "Solace", "Kestrel", "Aurel", "Thaliya"];
const NEW_WORLD = { land: 0.07, clouds: 0.05, atmosphere: 0.35, forest: 0.3 };

// The voice-over, with the moment each line begins.
const SCRIPT = [
  { at: 1400, text: "Before anything, there was a question." },
  { at: 4700, text: "What will you become?" },
  { at: IGNITION + 1700, text: "Every hour you focus. Every idea you chase." },
  { at: WORLDFALL + 1100, text: "Every small thing you finish…" },
  { at: WORLDFALL + 3700, text: "…becomes something you can see." },
  { at: TITLE + 600, text: "This one is yours." },
];

function suggestions(seed) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = NAMES[h % NAMES.length];
  const b = NAMES[(h >>> 5) % NAMES.length];
  return [...new Set([a, `${b}-${100 + (h % 900)}`, `${state.currentUsername || "my"}'s world`])];
}

function line(text, { low = false } = {}) {
  const p = $("birth-line");
  p.classList.add("out");
  return new Promise((r) =>
    setTimeout(() => {
      p.textContent = text;
      p.classList.toggle("low", low);
      p.classList.remove("out");
      r();
    }, 450)
  );
}

function buildForm(form, { onDone }) {
  const sug = suggestions(state.currentUser?.id || "x");
  const nameInput = el("input", { type: "text", id: "birth-world-name", maxlength: "40", autocomplete: "off", value: sug[0], "aria-describedby": "birth-name-hint" });
  const interests = new Set();
  const interestChips = el(
    "div",
    { class: "chips", role: "group", "aria-label": "Interests" },
    INTERESTS.map((it) => {
      const b = el("button", { type: "button", class: "chip tone-world", "aria-pressed": "false", text: it.label });
      b.addEventListener("click", () => {
        if (interests.has(it.id)) interests.delete(it.id);
        else if (interests.size < 5) interests.add(it.id);
        else return showToast("Pick up to five — you can change them later.", "");
        b.setAttribute("aria-pressed", String(interests.has(it.id)));
      });
      return b;
    })
  );
  const rhythm = chipGroup({
    label: "Weekly focus goal",
    value: 300,
    options: [
      { id: 180, label: "3 hours" },
      { id: 300, label: "5 hours" },
      { id: 600, label: "10 hours" },
      { id: 900, label: "15 hours" },
      { id: 0, label: "No goal yet" },
    ],
    toneOf: () => "tone-world",
  });

  const steps = [
    {
      title: "Name your world.",
      lead: "It formed a few seconds ago from nothing. It's yours, and it grows from what you do here.",
      body: [
        el("label", { class: "field" }, [el("span", { text: "World name" }), nameInput, el("small", { id: "birth-name-hint", class: "field-hint", text: "Only you see this." })]),
        el("div", { class: "suggest" }, sug.map((s) => el("button", { type: "button", text: s, onClick: () => (nameInput.value = s) }))),
      ],
    },
    {
      title: "What pulls you in?",
      lead: "Pick up to five. Drift uses them to choose what it shows you each day.",
      body: [interestChips],
    },
    {
      title: "How much focus makes a good week?",
      lead: "This becomes your first moon. It fills as you study, and it resets every Monday — no streak to lose.",
      body: [rhythm.node],
    },
  ];

  let step = 0;
  const render = () => {
    const s = steps[step];
    const back = el("button", { type: "button", class: "btn btn-quiet", text: step ? "Back" : "Skip for now" });
    const next = el("button", { type: "submit", class: "btn btn-primary", text: step < steps.length - 1 ? "Next" : "Enter my universe" });
    back.addEventListener("click", () => {
      if (step) {
        step--;
        render();
      } else finish(true);
    });
    form.replaceChildren(
      el("div", { class: "birth-steps", "aria-hidden": "true" }, steps.map((_, i) => el("i", { class: i <= step ? "on" : "" }))),
      el("h2", { id: "birth-title", text: s.title }),
      el("p", { class: "lead", text: s.lead }),
      ...s.body,
      el("div", { class: "birth-actions" }, [back, next])
    );
    form.querySelector("input, button.chip")?.focus();
  };

  let saving = false;
  async function finish(skipped = false) {
    if (saving) return;
    saving = true;
    const worldName = (nameInput.value || "").trim().slice(0, 40) || sug[0];
    const { error } = await api.saveStudent({ world_name: worldName, interests: skipped ? [] : [...interests] });
    if (error) {
      saving = false;
      reportError(error, "Couldn't save your world. Check your connection and try again.");
      return;
    }
    if (!skipped && rhythm.value > 0) {
      const g = await api.addGoal({ title: "Weekly focus", weekly_minutes: rhythm.value });
      if (g.error) reportError(g.error, "Your world is saved, but the weekly goal wasn't. Add it from World.");
    }
    onDone();
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    if (step < steps.length - 1) {
      step++;
      render();
    } else finish(false);
  };
  render();
}

/**
 * @param {{replay?: boolean, onDone: () => void}} opts
 */
export function runBirth({ replay = false, onDone }) {
  const root = $("birth");
  const form = $("birth-form");
  const skip = $("birth-skip");
  root.hidden = false;
  form.hidden = true;
  $("birth-line").textContent = "";
  document.body.classList.add("birthing");
  const number = (state.currentUser?.id || "0000").slice(0, 4).toUpperCase();

  let film = null;
  let score = null;
  let globe = null;
  let globeCanvas = null;
  let ended = false;
  const extras = [];
  const add = (node) => (extras.push(node), root.append(node), node);

  const stopSound = () => {
    score?.close();
    score = null;
  };

  // The world as a page element: for reduced motion, and for browsers
  // where the film can't render it itself.
  const showWorld = () => {
    if (globeCanvas) return;
    globeCanvas = el("canvas", { class: "birth-globe", "aria-hidden": "true" });
    root.append(globeCanvas);
    try {
      globe = createGlobe(globeCanvas, { seed: state.currentUser?.id || "panalo", maxDisk: 260 });
      globe.setLayers(NEW_WORLD);
    } catch (e) {
      console.error(e);
    }
    requestAnimationFrame(() => globeCanvas.classList.add("in"));
  };

  const end = () => {
    if (ended) return;
    ended = true;
    stopSound();
    root.classList.add("leaving");
    setTimeout(() => {
      film?.stop();
      globe?.destroy();
      globeCanvas?.remove();
      extras.forEach((n) => n.remove());
      root.hidden = true;
      root.classList.remove("leaving", "asking", "cinema", "titled");
      delete root.dataset.shot;
      document.body.classList.remove("birthing");
      onDone();
    }, reducedMotion() ? 0 : 700);
  };

  const ask = () => {
    if (replay) return end();
    stopSound();
    root.classList.remove("cinema", "titled");
    root.classList.add("asking");
    extras.filter((n) => !n.classList.contains("film-out")).forEach((n) => n.remove());
    if (film) film.hold();
    else showWorld();
    line(`Universe № ${number} · age 0 seconds`);
    form.hidden = false;
    skip.hidden = true;
    buildForm(form, { onDone: end });
  };

  skip.hidden = false;
  skip.textContent = replay ? "Close" : "Skip";
  skip.onclick = () => (replay ? end() : ask());

  if (reducedMotion()) {
    line("Before this, there was nothing.").then(() => setTimeout(ask, 1200));
    return;
  }

  // Captions sit in the lower letterbox bar; the title card is type, set
  // over the last shot.
  const caption = add(el("p", { class: "film-caption", "aria-live": "polite" }));
  const title = add(
    el("div", { class: "film-title", "aria-hidden": "true" }, [
      el("span", { class: "ft-word", text: "PANALO" }),
      el("span", { class: "ft-sub", text: "STUDENTS" }),
      el("span", { class: "ft-num", text: `Universe № ${number} · age 0 seconds` }),
    ])
  );
  let captionTimer = 0;
  const say = (text) => {
    caption.classList.remove("on");
    clearTimeout(captionTimer);
    requestAnimationFrame(() => {
      caption.textContent = text;
      caption.classList.add("on");
    });
    captionTimer = setTimeout(() => caption.classList.remove("on"), Math.max(2600, text.length * 75));
    speak(text, { score });
  };

  score = createScore();
  warmVoice();
  if (score) {
    const sound = add(el("button", { type: "button", class: "btn btn-quiet btn-sm birth-sound" }));
    const label = () => {
      const on = !score?.muted;
      sound.textContent = on ? "Sound on" : "Sound off";
      sound.setAttribute("aria-pressed", String(on));
    };
    sound.addEventListener("click", () => {
      if (!score) return;
      score.setMuted(!score.muted);
      setSoundWanted(!score.muted);
      label();
    });
    label();
    score.resume();
  }

  const shot = (name) => () => (root.dataset.shot = name);
  const cues = [
    { at: 0, run: shot("void") },
    { at: IGNITION, run: shot("genesis") },
    { at: WORLDFALL, run: shot("worldfall") },
    { at: TITLE, run: shot("title") },
    { at: 150, run: () => score?.drone(9) },
    { at: 700, run: () => score?.heartbeat(7, 1.02) },
    { at: 5000, run: () => score?.riser(3.2) },
    { at: IGNITION, run: () => score?.impact() },
    { at: IGNITION + 250, run: () => score?.whoosh(2.4) },
    { at: IGNITION + 1000, run: () => score?.pad([146.8, 174.6, 220, 261.6, 329.6], 9, 0.07) },
    { at: WORLDFALL - 300, run: () => score?.whoosh(1.8) },
    { at: WORLDFALL + 400, run: () => score?.pad([110, 164.8, 220, 277.2, 329.6], 8, 0.07) },
    { at: TITLE - 200, run: () => score?.resolve() },
    { at: TITLE, run: () => root.classList.add("titled") },
    ...SCRIPT.map((l) => ({ at: l.at, run: () => say(l.text) })),
    { at: LENGTH, run: () => !ended && (replay ? end() : ask()) },
  ];

  root.classList.add("cinema");
  try {
    film = createFilm(root, { seed: state.currentUser?.id || "panalo", layers: NEW_WORLD, cues, onFallbackWorld: showWorld });
    extras.push(root.querySelector(".film-out"));
  } catch (e) {
    console.error(e);
    film = null;
    return ask();
  }
}

export function needsBirth() {
  return !store.student && !store.schemaMissing;
}
