// The first time inside: a universe begins, a world forms, you name it.
//
// About eight seconds, drawn on one canvas with a few hundred particles --
// no video, no assets. "Skip" jumps straight to the questions; reduced
// motion replaces the sequence with two lines of text; if the canvas can't
// run at all, the questions appear immediately. The world that forms is the
// real one: seeded from your account, the same world the World page shows.
import { el, chipGroup, showToast, reportError } from "./ui.js";
import { reducedMotion, animationLoop } from "./motion.js";
import { createGlobe } from "./world-render.js";
import { INTERESTS } from "./model/drift-library.js";
import { api, store } from "./store.js";
import { state } from "../../src/state.js";

const $ = (id) => document.getElementById(id);
const NAMES = ["Halcyon", "Tamarind", "Velora", "Nadir", "Lumen", "Arka", "Cinder", "Meridian", "Solace", "Kestrel", "Aurel", "Thaliya"];

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

function runSequence(canvas, seed, onFormed) {
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  let w = 0, h = 0;
  const resize = () => {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);

  const N = w * h < 500000 ? 380 : 820;
  const parts = Array.from({ length: N }, () => ({
    th: Math.random() * Math.PI * 2,
    r: 0,
    v: 0.25 + Math.random() * 0.9,
    band: 0.16 + Math.random() * 0.34,
    temp: Math.random(),
    size: 0.5 + Math.random() * 1.4,
  }));
  let t0 = null;
  let formedCalled = false;

  const loop = animationLoop(canvas, (t, dt) => {
    if (t0 === null) t0 = t;
    const e = t - t0;
    const cx = w / 2, cy = h / 2;
    const S = Math.min(w, h);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = e < 1900 ? "#000" : "rgba(0,0,0,0.22)";
    ctx.fillRect(0, 0, w, h);

    if (e < 1900) {
      // A single point, breathing, then collapsing.
      const pulse = e < 1400 ? 1.4 + Math.sin(e / 160) * 0.6 + e / 900 : Math.max(0.3, 3.5 - (e - 1400) / 120);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulse * 9);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(1, "rgba(255,220,180,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, pulse * 9, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (e < 2500) {
      // The flash.
      const a = 1 - (e - 1900) / 600;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * (0.2 + (e - 1900) / 500));
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.4, `rgba(255,214,160,${a * 0.6})`);
      g.addColorStop(1, "rgba(120,160,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    const forming = Math.max(0, Math.min(1, (e - 4300) / 2600));
    ctx.globalCompositeOperation = "lighter";
    for (const p of parts) {
      if (e < 4300) {
        p.r += p.v * dt * (S / 900);
        p.v *= 0.987;
      } else {
        const target = p.band * S;
        p.r += (target - p.r) * 0.035;
        p.th += (0.0009 * dt) / Math.sqrt(Math.max(0.15, p.band));
      }
      const tilt = 1 - forming * 0.6;
      const x = cx + Math.cos(p.th) * p.r;
      const y = cy + Math.sin(p.th) * p.r * tilt;
      // Hot to cool as the universe expands.
      const cool = Math.min(1, (e - 1900) / 3000);
      const warm = p.temp < 0.5;
      const r = 255;
      const gch = Math.round(255 - cool * (warm ? 70 : 40));
      const b = Math.round(255 - cool * (warm ? 150 : -0));
      ctx.fillStyle = `rgba(${warm ? r : Math.round(255 - cool * 110)},${gch},${b},${0.55 + 0.4 * (1 - cool)})`;
      ctx.fillRect(x, y, p.size, p.size);
    }
    if (forming > 0.15 && !formedCalled) {
      formedCalled = true;
      onFormed();
    }
  });
  loop.start();
  return () => {
    loop.destroy();
    window.removeEventListener("resize", resize);
  };
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
  const canvas = $("birth-canvas");
  const form = $("birth-form");
  const skip = $("birth-skip");
  root.hidden = false;
  form.hidden = true;
  $("birth-line").textContent = "";
  document.body.classList.add("birthing");

  let stop = () => {};
  let globe = null;
  let globeCanvas = null;
  let ended = false;

  const showWorld = () => {
    if (globeCanvas) return;
    globeCanvas = el("canvas", { class: "birth-globe", "aria-hidden": "true" });
    root.append(globeCanvas);
    try {
      globe = createGlobe(globeCanvas, { seed: state.currentUser?.id || "panalo", maxDisk: 260 });
      globe.setLayers({ land: 0.07, clouds: 0.05, atmosphere: 0.35, forest: 0.3 });
    } catch (e) {
      console.error(e);
    }
    requestAnimationFrame(() => globeCanvas.classList.add("in"));
  };

  const end = () => {
    if (ended) return;
    ended = true;
    stop();
    globe?.destroy();
    globeCanvas?.remove();
    root.classList.add("leaving");
    setTimeout(() => {
      root.hidden = true;
      root.classList.remove("leaving", "asking");
      document.body.classList.remove("birthing");
      onDone();
    }, reducedMotion() ? 0 : 700);
  };

  const ask = () => {
    if (replay) return end();
    stop();
    root.classList.add("asking");
    showWorld();
    line(`Universe № ${(state.currentUser?.id || "0000").slice(0, 4).toUpperCase()} · age 0 seconds`, { low: false });
    form.hidden = false;
    skip.hidden = true;
    buildForm(form, { onDone: end });
  };

  skip.hidden = false;
  skip.textContent = replay ? "Close" : "Skip";
  skip.onclick = () => (replay ? end() : ask());

  if (reducedMotion() || !canvas.getContext) {
    line("Before this, there was nothing.").then(() => setTimeout(ask, 1200));
    return;
  }

  try {
    stop = runSequence(canvas, state.currentUser?.id, showWorld);
  } catch (e) {
    console.error(e);
    return ask();
  }
  line("Before this, there was nothing.");
  setTimeout(() => !ended && line("Then — everything, all at once."), 2300);
  setTimeout(() => !ended && line("A world is forming.", { low: true }), 4700);
  setTimeout(() => !ended && line("It's yours.", { low: true }), 6600);
  setTimeout(() => !ended && (replay ? end() : ask()), 8600);
}

export function needsBirth() {
  return !store.student && !store.schemaMissing;
}
