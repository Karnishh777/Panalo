// Odyssey: the app as one continuous camera through space.
//
// One scene lives behind every page: a deep starfield, your own world (the
// real renderer, at full quality), a sun with an anamorphic flare. Every
// page is a station the camera stands at -- Now looks down on your world's
// horizon, the Study Room drifts far out where it's quiet, Signals swings
// round to the night side. Going somewhere flies the camera there: the
// stars stretch into warp streaks, the world glides to its new framing, the
// letterbox squeezes, and the page racks into focus (css/cinema.css).
//
// Under the letterbox, a subtitle says what matters on that page, written
// from your own data ("Next: Chemistry, in forty minutes."). The first time
// you reach a page in a session, its chapter card plays.
//
// Weak devices get fewer stars and a lighter world; reduced motion gets the
// same scene, still: no flights, no drift, no parallax.
import { el } from "../ui.js";
import { store, on } from "../store.js";
import { createGlobe } from "../world-render.js";
import { buildWorld } from "../model/world-model.js";
import { nextUp, tasksAsDeadlines, occurrencesBetween } from "../model/timeline.js";
import { reducedMotion } from "../motion.js";
import { deviceTier } from "../device-tier.js";
import { state } from "../../../src/state.js";

// Where the camera stands at each page: the planet's centre (vw, vh) and
// radius (vh), which way its sunlight falls (towards the sun, view space:
// x right, y up, z towards you), and where the sun hangs on screen (vw, vh;
// null when it's off frame or would sit behind the words). A page with a dial of the day (Now,
// Calendar) puts your world exactly inside it instead ("anchor").
const STATIONS = {
  now: { n: 1, title: "Now", x: 74, y: 118, r: 62, L: [0.55, 0.5, 0.67], sun: [93, 22], anchor: ".now .orbit-wrap" },
  study: { n: 2, title: "The Study Room", x: 84, y: 26, r: 6.5, L: [-0.75, 0.3, 0.45], sun: null }, // far out, quiet
  signals: { n: 3, title: "Signals", x: 6, y: 112, r: 58, L: [0.85, 0.4, -0.45], sun: null }, // the night side, lit cities
  world: { n: 4, title: "World", x: 150, y: 50, r: 40, L: [0.5, 0.4, 0.7], sun: [84, 20] }, // the page has its own
  calendar: { n: 5, title: "Calendar", x: 50, y: 196, r: 118, L: [0.35, 0.6, 0.72], sun: null, anchor: ".cal-orbit" },
  archive: { n: 6, title: "Archive", x: 104, y: 52, r: 46, L: [-0.6, 0.45, 0.66], sun: null }, // a wall of world, lit towards you
  drift: { n: 7, title: "Drift", x: 20, y: 124, r: 56, L: [0.62, 0.48, 0.6], sun: [84, 22] },
  safety: { n: 8, title: "Safety", x: 88, y: 84, r: 22, L: [-0.6, 0.5, 0.6], sun: null },
  settings: { n: 9, title: "Settings", x: 88, y: 84, r: 22, L: [-0.6, 0.5, 0.6], sun: null },
  moderate: { n: 10, title: "Moderation", x: 88, y: 84, r: 22, L: [-0.6, 0.5, 0.6], sun: null },
};
// The world inside a dial of the day: its radius as a share of the dial's
// width (the same proportion the dial's own world is drawn at).
const IN_DIAL = 0.84 / 1.7 / 2;
const PATH = ["now", "study", "signals", "world", "calendar", "archive", "drift"];
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const FLIGHT = 1150; // ms: the camera's move; the page is readable by ~200 ms
const SEEN = "panalo.students.ody.seen";

// ---- Words, for subtitles ------------------------------------------------------------

const ONES = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function words(n) {
  n = Math.round(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
  return String(n);
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function inWords(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `in ${words(min)} minute${min === 1 ? "" : "s"}`;
  const h = Math.round(min / 60);
  if (h < 20) return `in ${words(h)} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(min / 1440);
  return d <= 1 ? "tomorrow" : `in ${words(d)} days`;
}

function captionFor(name) {
  const now = Date.now();
  if (name === "now") {
    const events = [...store.events, ...tasksAsDeadlines(store.tasks)];
    const { current, next } = nextUp(events, now);
    if (current) return `Now: ${current.event.title}.`;
    if (next) return `Next: ${next.event.title}, ${inWords(next.start.getTime() - now)}.`;
    const h = new Date().getHours();
    return h >= 18 || h < 5 ? "Nothing on the orbit. The evening is yours." : "Nothing on the orbit yet. The day is yours.";
  }
  if (name === "study") return "Quiet now. The ship holds its course.";
  if (name === "signals") {
    const n = store.unreadTotal || 0;
    return n ? `${cap(words(n))} ${n === 1 ? "voice" : "voices"} waiting.` : "All quiet on the signals.";
  }
  if (name === "world") {
    const born = Date.parse(store.student?.born_at || "");
    const day = Number.isFinite(born) ? Math.floor((now - born) / 86400000) + 1 : null;
    const nameOf = store.student?.world_name || "Your world";
    return day ? `${nameOf}, day ${words(day)}.` : `${nameOf}.`;
  }
  if (name === "calendar") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const n = occurrencesBetween([...store.events, ...tasksAsDeadlines(store.tasks)], start.getTime(), start.getTime() + 86400000).length;
    return n ? `${cap(words(n))} ${n === 1 ? "thing" : "things"} on today's orbit.` : "A clear orbit today.";
  }
  if (name === "archive") return "Everything you keep, kept.";
  if (name === "drift") return "Drift a while. Nothing is waiting.";
  if (name === "safety") return "Your safety. Your rules.";
  if (name === "settings") return "The ship, as you like it.";
  if (name === "moderate") return "The watch.";
  return "";
}

// ---- The engine ------------------------------------------------------------------------

const ease = (q) => (q < 0.5 ? 4 * q * q * q : 1 - (-2 * q + 2) ** 3 / 2); // in-out cubic
const lerp = (a, b, k) => a + (b - a) * k;
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

export function start() {
  const still = reducedMotion();
  const tier = deviceTier().tier;
  // The longest side of the scene, in pixels: the most each tier may draw.
  // Lowered on the fly if frames run slow, raised again when there's room.
  const CAP = { low: 1280, normal: 1920, high: 2600 }[tier] || 1920;
  let maxPx = CAP;

  // The scene, behind everything: a nebula, the sun, and one canvas the GPU
  // draws -- your world, framed by the camera, with the stars behind it.
  const sky = el("canvas", { class: "ody-sky" });
  const sun = el("div", { class: "ody-sun" }, [el("i", { class: "ody-flare" })]);
  const nebula = el("div", { class: "ody-nebula" });
  const stage = el("div", { class: "ody-stage", "aria-hidden": "true" }, [nebula, sun, sky, el("div", { class: "ody-vignette" }), el("div", { class: "ody-grain" })]);
  const line = el("p", { class: "ody-line" });
  const dots = el("ol", { class: "ody-path", "aria-hidden": "true" }, PATH.map((p) => el("li", { "data-station": p })));
  const caption = el("div", { class: "ody-caption" }, [line, dots]);
  const leak = el("div", { class: "ody-leak", "aria-hidden": "true" });
  document.body.prepend(stage);
  document.body.append(leak, caption);
  document.documentElement.classList.add("ody-on");

  // Your world: the real renderer, framed by this camera and driven by this
  // loop (manual), so the world, the stars and the camera move in the same
  // frame -- nothing lags behind anything else.
  let globe = null;
  try {
    globe = createGlobe(sky, { seed: state.currentUser?.id || "panalo", maxPixels: maxPx, spin: 0.32, tilt: -0.42, manual: true });
  } catch (e) {
    console.error("odyssey world", e);
  }
  const gpu = !!globe?.setFrame;
  if (!gpu) {
    // No WebGL: a still field of stars, and no world.
    globe?.destroy();
    globe = null;
    stage.classList.add("ody-flat");
  }
  const refreshWorld = () => {
    if (!globe) return;
    const w = buildWorld({ sessions: store.sessions, tasks: store.tasks, logs: store.logs, goals: store.goals, sentMessages: store.sent, entries: store.entries, bornAt: store.student?.born_at });
    globe.setLayers(w.layers, w.moons);
  };
  refreshWorld();
  let worldTimer = 0;
  let captionTimer = 0;
  const offStore = on("any", () => {
    clearTimeout(worldTimer);
    worldTimer = setTimeout(refreshWorld, 1500);
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => setCaption(station, false), 400);
  });

  // ---- The camera ----
  let W = window.innerWidth;
  let H = window.innerHeight;
  let station = null;
  // Where a station puts the planet, in px, right now (a dial moves as
  // the page lays out and scrolls, so anchors are read every frame).
  function shotFor(name) {
    const s = STATIONS[name] || STATIONS.now;
    let x = (s.x / 100) * W;
    let y = (s.y / 100) * H;
    let r = (s.r / 100) * H;
    let anchored = false;
    if (s.anchor) {
      const a = document.querySelector(`.surface[data-surface="${name}"]:not([hidden]) ${s.anchor}`);
      const b = a?.getBoundingClientRect();
      if (b && b.width > 40) {
        x = b.left + b.width / 2;
        y = b.top + b.height / 2;
        r = b.width * IN_DIAL;
        anchored = true;
      }
    }
    return { x, y, r, L: norm(s.L), sun: s.sun, anchored };
  }
  let cam = null; // the shot now
  let from = null; // the shot a flight left from
  let flightStart = -1e9;
  let flightTo = null;

  function setCaption(name, animate) {
    const text = captionFor(name);
    if (line.textContent === text) return;
    if (!animate || still) {
      line.textContent = text;
      return;
    }
    line.classList.remove("ody-line-in");
    void line.offsetWidth;
    line.textContent = text;
    line.classList.add("ody-line-in");
  }
  function chapter(name) {
    if (still) return;
    let seen = [];
    try {
      seen = JSON.parse(sessionStorage.getItem(SEEN) || "[]");
    } catch {}
    if (seen.includes(name)) return;
    seen.push(name);
    try {
      sessionStorage.setItem(SEEN, JSON.stringify(seen));
    } catch {}
    const s = STATIONS[name];
    if (!s) return;
    const card = el("div", { class: "ody-chapter", "aria-hidden": "true" }, [el("span", { text: ROMAN[s.n] || "" }), el("b", { text: s.title })]);
    document.querySelectorAll(".ody-chapter").forEach((c) => c.remove()); // one title on screen at a time
    document.body.append(card);
    setTimeout(() => card.remove(), 1900);
  }

  // ---- Pointer and scroll: read raw, eased in the frame ----
  let par = { x: 0, y: 0 };
  let target = { x: 0, y: 0 };
  const onPointer = (e) => {
    target = { x: (e.clientX / W - 0.5) * -28, y: (e.clientY / H - 0.5) * -18 };
  };
  if (!still) window.addEventListener("pointermove", onPointer, { passive: true });

  // ---- A frame ----
  let roll = 0;
  function render(t, dt) {
    const k = 1 - Math.exp(-dt / 140); // the camera's follow: smooth, never late
    par.x += (target.x - par.x) * k;
    par.y += (target.y - par.y) * k;
    const scroll = Math.min(900, window.scrollY || 0);

    const goal = shotFor(station || "now");
    const q = Math.min(1, Math.max(0, (t - flightStart) / FLIGHT));
    const flying = q < 1 && from;
    if (flying) {
      // The move: ease in, ease out; the radius changes in log space, so a
      // zoom feels like distance, not inflation; the light swings round.
      const e = ease(q);
      cam = {
        x: lerp(from.x, goal.x, e),
        y: lerp(from.y, goal.y, e),
        r: Math.exp(lerp(Math.log(from.r), Math.log(goal.r), e)),
        L: norm([lerp(from.L[0], goal.L[0], e), lerp(from.L[1], goal.L[1], e), lerp(from.L[2], goal.L[2], e)]),
        sun: goal.sun && from.sun ? [lerp(from.sun[0], goal.sun[0], e), lerp(from.sun[1], goal.sun[1], e)] : goal.sun,
        anchored: false,
      };
    } else {
      cam = goal;
      from = null;
    }
    const warp = flying && !still ? Math.sin(Math.PI * q) ** 1.6 : 0;
    // A slight roll through the move, the way a ship banks.
    roll = flying ? Math.sin(Math.PI * q) * (flightTo?.dir || 1) * 1.4 : 0;

    // A dial's world is locked to the dial (it scrolls with it); a horizon
    // rises as you scroll, and leans with the pointer.
    const lean = cam.anchored ? 0 : 1;
    const x = cam.x + par.x * 0.6 * lean;
    const y = cam.y + (par.y * 0.6 - scroll * 0.3) * lean;
    if (globe) {
      globe.setFrame({ x, y, r: cam.r });
      globe.setSun(cam.L, 0.55);
      globe.setSky({ stars: 1, par: [par.x, par.y - scroll * 0.12], warp, warpAt: [W / 2, H / 2] });
      globe.frame(t, dt);
    }
    sky.style.transform = roll ? `rotate(${roll.toFixed(3)}deg) scale(1.02)` : "";
    nebula.style.transform = `translate3d(${(par.x * 0.3).toFixed(2)}px, ${(par.y * 0.3 - scroll * 0.05).toFixed(2)}px, 0)`;
    if (cam.sun) {
      sun.style.opacity = "1";
      sun.style.transform = `translate3d(${((cam.sun[0] / 100) * W + par.x * 0.15).toFixed(1)}px, ${((cam.sun[1] / 100) * H + par.y * 0.15 - scroll * 0.1).toFixed(1)}px, 0)`;
    } else {
      sun.style.opacity = "0";
    }
  }

  // ---- The loop: one for everything; quality follows the frame rate ----
  // While nothing moves (no flight, no pointer, no scroll for a moment), a
  // mid-range device draws every other frame: the world turns slowly
  // enough that no one sees it, and the page keeps its headroom.
  let raf = 0;
  let last = 0;
  let avg = 16.7;
  let slowFor = 0;
  let fastFor = 0;
  let skip = false;
  let owed = 0; // time not yet drawn (a skipped frame's)
  let stirred = 0;
  const stir = () => (stirred = performance.now());
  window.addEventListener("pointermove", stir, { passive: true });
  window.addEventListener("scroll", stir, { passive: true });
  const loop = (t) => {
    raf = 0;
    if (document.hidden) return;
    const dt = last ? Math.min(100, t - last) : 16.7;
    last = t;
    const busy = t - flightStart < FLIGHT || t - stirred < 1200;
    skip = tier !== "high" && !busy && !skip;
    owed += dt;
    if (!skip) {
      render(t, owed);
      owed = 0;
    }
    // Adaptive resolution, decided on time rather than frame counts so it
    // reacts within a second even when frames are very slow: if frames run
    // long, draw fewer pixels; when there's been room for a while, more.
    avg += (dt - avg) * 0.1;
    if (avg > 26) {
      slowFor += dt;
      if (slowFor > 700 && maxPx > 720) {
        maxPx = Math.round(maxPx * (avg > 50 ? 0.7 : 0.85));
        globe?.setMaxPixels(maxPx);
        slowFor = 0;
        avg = 18;
      }
    } else slowFor = 0;
    if (avg < 18.5) {
      fastFor += dt;
      if (fastFor > 5000 && maxPx < CAP) {
        maxPx = Math.min(CAP, Math.round(maxPx * 1.1));
        globe?.setMaxPixels(maxPx);
        fastFor = 0;
      }
    } else fastFor = 0;
    raf = requestAnimationFrame(loop);
  };
  const wake = () => {
    if (still) return render(performance.now(), 16);
    if (!raf && !document.hidden) {
      last = 0;
      raf = requestAnimationFrame(loop);
    }
  };
  document.addEventListener("visibilitychange", wake);
  const onResize = () => {
    W = window.innerWidth;
    H = window.innerHeight;
    if (still) setTimeout(() => render(performance.now(), 16), 50);
  };
  window.addEventListener("resize", onResize);
  // Still pictures move when you scroll (reduced motion: no loop).
  const onScroll = () => still && render(performance.now(), 16);
  window.addEventListener("scroll", onScroll, { passive: true });

  if (!gpu) drawFlatStars(stage);

  // ---- Arrivals (shell.js) ----
  let flyTimer = 0;
  const onArrive = (e) => {
    const name = e.detail?.name;
    if (!name || name === station) return;
    const first = station === null;
    const prev = station;
    station = name;
    stage.dataset.station = name;
    dots.querySelectorAll("li").forEach((li) => li.classList.toggle("here", li.dataset.station === name));
    setCaption(name, !first);
    chapter(name);
    if (first || still || !cam) {
      if (still) requestAnimationFrame(() => render(performance.now(), 16));
      return;
    }
    // Fly from wherever the camera is now (mid-flight included).
    from = { ...cam, x: cam.x, y: cam.y };
    flightStart = performance.now();
    flightTo = { dir: PATH.indexOf(name) >= PATH.indexOf(prev) ? 1 : -1 };
    document.body.classList.add("ody-flying");
    clearTimeout(flyTimer);
    flyTimer = setTimeout(() => document.body.classList.remove("ody-flying"), FLIGHT - 250);
  };
  window.addEventListener("panalo:arrive", onArrive);
  // Already on a page when the look was chosen (or the app opened).
  onArrive({ detail: { name: document.body.dataset.view || "now" } });
  wake();

  return {
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      clearTimeout(flyTimer);
      clearTimeout(worldTimer);
      clearTimeout(captionTimer);
      offStore?.();
      window.removeEventListener("panalo:arrive", onArrive);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointermove", stir);
      window.removeEventListener("scroll", stir);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", wake);
      globe?.destroy();
      stage.remove();
      leak.remove();
      caption.remove();
      document.querySelectorAll(".ody-chapter").forEach((c) => c.remove());
      document.body.classList.remove("ody-flying");
      document.documentElement.classList.remove("ody-on");
    },
  };
}

// Without WebGL: stars drawn once on a 2D canvas.
function drawFlatStars(stage) {
  const c = el("canvas", { class: "ody-flat-stars" });
  stage.querySelector(".ody-sky")?.replaceWith(c);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const ctx = c.getContext("2d");
  ctx.scale(dpr, dpr);
  for (let i = 0; i < 900; i++) {
    const b = Math.random() ** 3;
    ctx.fillStyle = `rgba(235,240,255,${0.25 + b * 0.75})`;
    const r = 0.5 + b * 1.4;
    ctx.fillRect(Math.random() * w, Math.random() * h, r, r);
  }
}
