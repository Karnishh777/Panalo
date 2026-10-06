// The weekly chronicle (batch 2): last week, told as a short story.
//
// The first time you open the app in a new week (after the dawn), the week
// before plays as a few full-screen slides: your focus and the week before
// it, where it went, what you finished, the days you showed up and how they
// felt, the things you wrote down, and your world on Monday beside your
// world on Sunday. Tap or use the arrow keys to move; it advances by itself
// otherwise. A quiet week isn't played at all -- no report card for rest.
//
// Also on demand: World → "Last week", and Warp.
import { el, getPrefs, setPrefs } from "./ui.js";
import { store } from "./store.js";
import { createGlobe } from "./world-render.js";
import { buildWorld } from "./model/world-model.js";
import { lastWeek, chronicle, worldAt, weekNumber } from "./model/chronicle.js";
import { MOODS } from "./model/daily.js";
import { formatMinutes, parseDayKey } from "./model/time.js";
import { reducedMotion } from "./motion.js";
import { state } from "../../src/state.js";

const SLIDE_MS = 5200;
let playing = false;

function data() {
  const base = { sessions: store.sessions, tasks: store.tasks, logs: store.logs, goals: store.goals, entries: store.entries, sentMessages: store.sent, bornAt: store.student?.born_at };
  const w = buildWorld(base);
  return { ...base, discoveries: w.discoveries };
}

/** Whether last week's chronicle is still to be shown here. */
export function chronicleDue(now = Date.now()) {
  if (!store.loaded || store.schemaMissing || !store.student) return false;
  const wk = lastWeek(now);
  if (getPrefs().chronicleSeen === wk.key) return false;
  const born = Date.parse(store.student.born_at || "");
  if (!Number.isFinite(born) || born >= wk.end) return false; // the world didn't exist yet
  return !chronicle(data(), wk).empty;
}

export async function maybeChronicle() {
  if (playing || !chronicleDue()) return;
  setPrefs({ chronicleSeen: lastWeek().key });
  await playChronicle();
}

const count = (node, to, fmt, ms = 1100) => {
  if (reducedMotion() || !to) return void (node.textContent = fmt(to));
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, Math.max(0, (t - t0) / ms));
    node.textContent = fmt(Math.round(to * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};

const range = (a, b) =>
  `${new Date(a).toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${new Date(b - 1).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;

const KIND = { read: "reading", create: "making things", move: "moving", rest: "resting", connect: "with people" };

/** Build the slides: each is { node, enter?(), leave?() }. */
function slides(c, wk, d) {
  const out = [];
  const n = weekNumber(store.student?.born_at, wk.start);
  const name = store.student?.world_name || "your world";
  const verdict = c.focusMinutes > c.prevFocusMinutes * 1.2 && c.focusMinutes >= 60 ? "A big one." : c.focusMinutes >= 30 ? "A steady one." : "A quiet one, and that's allowed.";

  out.push({
    node: el("div", { class: "slide slide-open" }, [
      el("p", { class: "kicker toned tone-time", text: "Your week" }),
      el("h2", { class: "story-title", text: `Week ${n}` }),
      el("p", { class: "story-serif", text: `of ${name} · ${range(wk.start, wk.end)}` }),
      el("p", { class: "story-big-line", text: verdict }),
    ]),
  });

  if (c.focusMinutes) {
    const num = el("b", { class: "story-num num" });
    const max = Math.max(60, ...c.days.map((x) => x.minutes));
    const bars = el(
      "div",
      { class: "story-bars-chart", role: "img", "aria-label": c.days.map((x) => `${x.label} ${formatMinutes(x.minutes)}`).join(", ") },
      c.days.map((x) => el("div", { class: `sb${c.best && x.key === c.best.key ? " best" : ""}` }, [el("i", { style: `--h:${Math.max(3, (x.minutes / max) * 100)}%` }), el("span", { text: x.label.slice(0, 2) })]))
    );
    const diff = c.focusMinutes - c.prevFocusMinutes;
    const vs = !c.prevFocusMinutes ? "Your first measured week of focus." : diff > 0 ? `${formatMinutes(diff)} more than the week before.` : diff === 0 ? "Exactly the week before, again." : `${formatMinutes(-diff)} less than the week before. Weeks breathe.`;
    out.push({
      node: el("div", { class: "slide tone-focus" }, [
        el("p", { class: "kicker toned tone-focus", text: "Focus" }),
        num,
        el("p", { class: "story-sub", text: vs }),
        bars,
        c.best ? el("p", { class: "faint", text: `Best day: ${parseDayKey(c.best.key).toLocaleDateString(undefined, { weekday: "long" })}, ${formatMinutes(c.best.minutes)}.${c.deep ? ` ${c.deep} block${c.deep === 1 ? "" : "s"} you called deep.` : ""}` }) : null,
      ]),
      enter: () => {
        count(num, c.focusMinutes, formatMinutes);
        bars.classList.add("grow");
      },
    });
  }

  if (c.subjects.length) {
    const top = c.subjects[0].minutes;
    out.push({
      node: el("div", { class: "slide tone-focus" }, [
        el("p", { class: "kicker toned tone-focus", text: "Where it went" }),
        el("ol", { class: "story-subjects" }, c.subjects.map((s) => el("li", {}, [el("b", { text: s.subject }), el("span", { class: "story-meter" }, [el("i", { style: `--w:${Math.round((s.minutes / top) * 100)}%` })]), el("span", { class: "num faint", text: formatMinutes(s.minutes) })]))),
      ]),
    });
  }

  const loggedKinds = Object.entries(c.logged).filter(([, m]) => m > 0);
  if (c.tasksDone || loggedKinds.length || c.discoveries.length) {
    const tnum = el("b", { class: "story-num num" });
    out.push({
      node: el("div", { class: "slide tone-time" }, [
        el("p", { class: "kicker toned tone-time", text: "What you did" }),
        c.tasksDone ? el("div", { class: "story-pair" }, [tnum, el("span", { class: "story-sub", text: `task${c.tasksDone === 1 ? "" : "s"} finished · ${c.tasksDone === 1 ? "a new light" : "new lights"} on the night side` })]) : null,
        loggedKinds.length ? el("ul", { class: "story-list" }, loggedKinds.map(([k, m]) => el("li", { text: `${formatMinutes(m)} ${KIND[k] || k}` }))) : null,
        ...c.discoveries.map((x) => el("p", { class: "story-disc" }, [el("span", { class: "tag tone-time", text: "Discovery" }), " ", x.title])),
      ]),
      enter: () => c.tasksDone && count(tnum, c.tasksDone, String, 700),
    });
  }

  const mood = c.mood ? MOODS.find((m) => m.v === Math.round(c.mood))?.label : null;
  out.push({
    node: el("div", { class: "slide tone-drift" }, [
      el("p", { class: "kicker toned tone-drift", text: "Your days" }),
      el("ol", { class: "story-week", "aria-label": `You showed up on ${c.shown.length} of 7 days` }, c.days.map((x) => el("li", { class: c.shown.includes(x.key) ? "lit" : "" }, [el("i", { "aria-hidden": "true" }), el("span", { text: x.label.slice(0, 2) })]))),
      el("p", { class: "story-sub", text: `${c.shown.length} of 7 days.${c.shown.length >= 5 ? " Your ring held." : ""}` }),
      mood ? el("p", { class: "story-serif", text: `Mostly ${mood.toLowerCase()}.` }) : null,
      c.intentions ? el("p", { class: "faint", text: `${c.kept} of ${c.intentions} intention${c.intentions === 1 ? "" : "s"} kept.` }) : null,
    ]),
  });

  if (c.words.length) {
    out.push({
      node: el("div", { class: "slide tone-drift" }, [
        el("p", { class: "kicker toned tone-drift", text: "In your words" }),
        el("ul", { class: "story-quotes" }, c.words.map((w) => el("li", {}, [el("q", { text: w.text }), el("small", { class: "faint", text: `${w.kind === "learned" ? "Learned" : "A good thing"}, ${parseDayKey(w.day).toLocaleDateString(undefined, { weekday: "long" })}` })]))),
      ]),
    });
  }

  // The world on Monday beside the world on Sunday.
  const before = worldAt(d, wk.start);
  const after = worldAt(d, wk.end);
  const cBefore = el("canvas", { class: "story-globe", "aria-hidden": "true" });
  const cAfter = el("canvas", { class: "story-globe", "aria-hidden": "true" });
  const landGain = Math.round((after.layers.land - before.layers.land) * 1000) / 10;
  const lights = after.stats.tasksDone - before.stats.tasksDone;
  let globes = [];
  out.push({
    node: el("div", { class: "slide tone-world" }, [
      el("p", { class: "kicker toned tone-world", text: "Your world" }),
      el("div", { class: "story-worlds" }, [el("figure", {}, [cBefore, el("figcaption", { class: "faint", text: "Monday" })]), el("span", { class: "story-arrow", "aria-hidden": "true", text: "→" }), el("figure", {}, [cAfter, el("figcaption", { class: "faint", text: "Sunday" })])]),
      el("p", { class: "story-sub", text: [landGain > 0 ? `${landGain}% more land` : null, lights > 0 ? `${lights} new light${lights === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || "Held steady. Nothing you built went anywhere." }),
    ]),
    enter: () => {
      if (globes.length) return;
      try {
        for (const [canvas, w] of [[cBefore, before], [cAfter, after]]) {
          const g = createGlobe(canvas, { seed: state.currentUser.id, maxDisk: 300, spin: 0.7 });
          g.setLayers(w.layers, w.moons);
          globes.push(g);
        }
      } catch (e) {
        console.error(e);
      }
    },
    leave: () => {
      globes.forEach((g) => g.destroy?.());
      globes = [];
    },
  });

  out.push({
    node: el("div", { class: "slide slide-end" }, [
      el("h2", { class: "story-title", text: `Week ${n + 1}` }),
      el("p", { class: "story-serif", text: "starts now. Nothing to live up to, just more sky." }),
    ]),
  });
  return out;
}

export function playChronicle({ week = lastWeek() } = {}) {
  if (playing) return Promise.resolve();
  playing = true;
  return new Promise((resolve) => {
    const d = data();
    const c = chronicle(d, week);
    const list = slides(c, week, d);
    const still = reducedMotion();
    const bars = el("div", { class: "story-progress", "aria-hidden": "true" }, list.map(() => el("span", {}, [el("i")])));
    const stage = el("div", { class: "story-stage", "aria-live": "polite" });
    const prevBtn = el("button", { type: "button", class: "story-nav prev", "aria-label": "Previous", onClick: () => go(i - 1) });
    const nextBtn = el("button", { type: "button", class: "story-nav next", "aria-label": "Next", onClick: () => go(i + 1) });
    const close = el("button", { type: "button", class: "btn btn-quiet btn-sm story-close", text: "Close", onClick: () => end() });
    const root = el("div", { class: `story${still ? " still" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": "Your week" }, [el("div", { class: "story-sky", "aria-hidden": "true" }), bars, stage, prevBtn, nextBtn, close]);
    document.body.append(root);
    document.body.classList.add("in-story");

    let i = -1;
    let timer = 0;
    function go(k) {
      if (k >= list.length) return end();
      if (k < 0) k = 0;
      list[i]?.leave?.();
      i = k;
      stage.replaceChildren(list[i].node);
      list[i].node.classList.remove("in");
      void list[i].node.offsetWidth;
      list[i].node.classList.add("in");
      [...bars.children].forEach((b, j) => {
        b.className = j < i ? "done" : j === i ? (still ? "done" : "now") : "";
        b.style.setProperty("--ms", `${SLIDE_MS}ms`);
      });
      list[i].enter?.();
      clearTimeout(timer);
      if (!still) timer = setTimeout(() => go(i + 1), SLIDE_MS);
      nextBtn.focus({ preventScroll: true });
    }
    const onKey = (e) => {
      if (e.key === "Escape") end();
      else if (e.key === "ArrowRight" || e.key === " ") (e.preventDefault(), go(i + 1));
      else if (e.key === "ArrowLeft") go(i - 1);
    };
    document.addEventListener("keydown", onKey);
    let ended = false;
    function end() {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      list[i]?.leave?.();
      document.removeEventListener("keydown", onKey);
      root.classList.add("leaving");
      setTimeout(
        () => {
          root.remove();
          document.body.classList.remove("in-story");
          playing = false;
          resolve();
        },
        still ? 0 : 400
      );
    }
    go(0);
  });
}
