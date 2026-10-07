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

// Where the camera stands at each page: the world's centre (vw, vh), its
// scale, and where the sun hangs (vw, vh). The world's box is 220vh across
// and the planet fills 1/1.7 of it, so its radius is 64.7vh x k.
const STATIONS = {
  now: { n: 1, title: "Now", cx: 76, cy: 112, k: 0.77, sun: [62, 9] }, // a horizon, lower right
  study: { n: 2, title: "The Study Room", cx: 86, cy: 22, k: 0.124, sun: [12, 9] }, // far out, small
  signals: { n: 3, title: "Signals", cx: 6, cy: 108, k: 0.71, sun: [80, 9] }, // swung to the left
  world: { n: 4, title: "World", cx: 50, cy: 50, k: 0.5, sun: [82, 10], hide: true }, // the page has its own
  calendar: { n: 5, title: "Calendar", cx: 50, cy: 172, k: 1.42, sun: [50, 7] }, // a vast arc below
  archive: { n: 6, title: "Archive", cx: 106, cy: 50, k: 0.9, sun: [34, 9] }, // a wall of world, right
  drift: { n: 7, title: "Drift", cx: 20, cy: 120, k: 0.83, sun: [86, 9] },
  safety: { n: 8, title: "Safety", cx: 86, cy: 80, k: 0.37, sun: [28, 9] },
  settings: { n: 9, title: "Settings", cx: 86, cy: 80, k: 0.37, sun: [28, 9] },
  moderate: { n: 10, title: "Moderation", cx: 86, cy: 80, k: 0.37, sun: [28, 9] },
};
const PATH = ["now", "study", "signals", "world", "calendar", "archive", "drift"];
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const FLIGHT = 900; // ms: the warp's length; the page is readable by ~200 ms
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

export function start() {
  const still = reducedMotion();
  const tier = deviceTier().tier;
  const STAR_COUNT = { low: 520, normal: 1100, high: 1700 }[tier] || 1100;

  // The scene, behind everything.
  const stars = el("canvas", { class: "ody-stars" });
  const globeCanvas = el("canvas", { class: "ody-globe" });
  const worldBox = el("div", { class: "ody-world" }, [globeCanvas]);
  const sun = el("div", { class: "ody-sun" }, [el("i", { class: "ody-flare" })]);
  const stage = el("div", { class: "ody-stage", "aria-hidden": "true" }, [el("div", { class: "ody-nebula" }), stars, sun, worldBox, el("div", { class: "ody-vignette" })]);
  const grain = el("div", { class: "ody-grain", "aria-hidden": "true" });
  const line = el("p", { class: "ody-line" });
  const dots = el("ol", { class: "ody-path", "aria-hidden": "true" }, PATH.map((p) => el("li", { "data-station": p })));
  const caption = el("div", { class: "ody-caption" }, [line, dots]);
  // The grade's light over the whole frame, and the leak that sweeps
  // across it in flight (css/cinema.css).
  // (Two separate layers: a blend inside a shared parent would only blend
  // with its sibling, not with the frame.)
  const gradeA = el("div", { class: "ody-grade ody-grade-a", "aria-hidden": "true" });
  const gradeB = el("div", { class: "ody-grade ody-grade-b", "aria-hidden": "true" });
  const leak = el("div", { class: "ody-leak", "aria-hidden": "true" });
  document.body.prepend(stage);
  document.body.append(gradeA, gradeB, leak, grain, caption);
  document.documentElement.classList.add("ody-on");


  // Your world: the real renderer, as large and sharp as the device allows.
  let globe = null;
  try {
    globe = createGlobe(globeCanvas, {
      seed: state.currentUser?.id || "panalo",
      maxPixels: tier === "high" ? 2048 : tier === "normal" ? 1500 : 900,
      maxDisk: tier === "low" ? 520 : 760,
      spin: 0.32,
      // Tipped away from the camera: from a horizon you see coasts and
      // cloud, not a polar cap.
      tilt: -0.42,
    });
  } catch (e) {
    console.error("odyssey world", e);
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

  // ---- Stations ----
  let station = null;
  function frame(name, instant) {
    const s = STATIONS[name] || STATIONS.now;
    if (instant) stage.classList.add("ody-instant");
    worldBox.style.setProperty("--cx", s.cx);
    worldBox.style.setProperty("--cy", s.cy);
    worldBox.style.setProperty("--k", s.k);
    worldBox.classList.toggle("ody-hidden", !!s.hide);
    sun.style.setProperty("--sx", s.sun[0]);
    sun.style.setProperty("--sy", s.sun[1]);
    stage.dataset.station = name;
    dots.querySelectorAll("li").forEach((li) => li.classList.toggle("here", li.dataset.station === name));
    if (instant) requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.remove("ody-instant")));
  }
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

  // ---- The camera: stars, parallax, warp ----
  const ctx = stars.getContext("2d");
  const dpr = Math.min(tier === "high" ? 2 : 1.5, window.devicePixelRatio || 1);
  let W = 0, H = 0;
  const fit = () => {
    W = window.innerWidth;
    H = window.innerHeight;
    stars.width = Math.round(W * dpr);
    stars.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  fit();
  // Stars: depth z (near ones move more), size, brightness, twinkle, a tint.
  const field = Array.from({ length: STAR_COUNT }, () => {
    const z = Math.random() ** 1.8;
    const tint = Math.random();
    return {
      x: Math.random(),
      y: Math.random(),
      z: 0.15 + z * 0.85,
      r: 0.35 + Math.random() ** 3 * 1.6 + z * 0.4,
      b: 0.35 + Math.random() * 0.65,
      tw: 0.4 + Math.random() * 1.6,
      ph: Math.random() * 6.3,
      c: tint < 0.12 ? "255,214,170" : tint < 0.3 ? "200,220,255" : "235,240,255",
    };
  });
  // A soft glow sprite for the brightest stars.
  const glow = document.createElement("canvas");
  glow.width = glow.height = 32;
  const gctx = glow.getContext("2d");
  const grad = gctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.25, "rgba(210,225,255,0.35)");
  grad.addColorStop(1, "rgba(210,225,255,0)");
  gctx.fillStyle = grad;
  gctx.fillRect(0, 0, 32, 32);

  let par = { x: 0, y: 0 };
  let target = { x: 0, y: 0 };
  let warp = 0;
  let flightStart = -1e9;
  let drift = 0;
  const onPointer = (e) => {
    target = { x: (e.clientX / W - 0.5) * -26, y: (e.clientY / H - 0.5) * -16 };
  };
  // Scrolling dollies the camera: near stars slide past faster than far
  // ones, and the world rises into frame.
  let scroll = 0;
  let scrollShown = 0;
  const onScroll = () => {
    scroll = window.scrollY || 0;
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  if (!still) window.addEventListener("pointermove", onPointer, { passive: true });

  function draw(t) {
    const dt = 16;
    par.x += (target.x - par.x) * 0.05;
    par.y += (target.y - par.y) * 0.05;
    scrollShown += (scroll - scrollShown) * 0.12;
    const q = Math.min(1, Math.max(0, (t - flightStart) / FLIGHT));
    warp = q < 1 ? Math.sin(Math.PI * q) ** 1.4 : 0;
    const calm = stage.dataset.station === "study";
    drift += dt * (calm ? 0.000004 : 0.000012);
    ctx.clearRect(0, 0, W, H);
    const vx = W / 2, vy = H / 2;
    for (const s of field) {
      let x = ((s.x + drift * s.z) % 1) * W + par.x * s.z;
      let y = (((s.y * H + par.y * s.z - scrollShown * s.z * 0.35) % H) + H) % H;
      const tw = still ? 1 : 0.65 + 0.35 * Math.sin(t * 0.001 * s.tw + s.ph);
      const a = s.b * tw;
      if (warp > 0.02) {
        // Into the warp: every star streaks away from the centre.
        const dx = x - vx, dy = y - vy;
        const len = warp * s.z * 0.55;
        ctx.strokeStyle = `rgba(${s.c},${Math.min(1, a * (0.6 + warp))})`;
        ctx.lineWidth = s.r * (0.8 + warp * 0.6);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + dx * len, y + dy * len);
        ctx.stroke();
        continue;
      }
      if (s.r > 1.5) {
        const g = s.r * 7;
        ctx.globalAlpha = a;
        ctx.drawImage(glow, x - g / 2, y - g / 2, g, g);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = `rgba(${s.c},${a})`;
      ctx.fillRect(x - s.r / 2, y - s.r / 2, s.r, s.r);
    }
    // The scene's other layers follow the camera too (less, being far).
    stage.style.setProperty("--px", `${par.x.toFixed(2)}px`);
    stage.style.setProperty("--py", `${par.y.toFixed(2)}px`);
    stage.style.setProperty("--scroll", `${Math.min(900, scrollShown).toFixed(1)}px`);
  }
  let raf = 0;
  const loop = (t) => {
    raf = 0;
    if (document.hidden) return;
    draw(t);
    raf = requestAnimationFrame(loop);
  };
  const wake = () => {
    if (!still && !raf && !document.hidden) raf = requestAnimationFrame(loop);
  };
  document.addEventListener("visibilitychange", wake);
  const onResize = () => {
    fit();
    if (still) draw(0);
  };
  window.addEventListener("resize", onResize);

  // ---- Arrivals (shell.js) ----
  let flyTimer = 0;
  const onArrive = (e) => {
    const name = e.detail?.name;
    if (!name || name === station) return;
    const first = station === null;
    station = name;
    frame(name, first || still);
    setCaption(name, !first);
    chapter(name);
    if (first || still) return;
    flightStart = performance.now();
    document.body.classList.add("ody-flying");
    clearTimeout(flyTimer);
    flyTimer = setTimeout(() => document.body.classList.remove("ody-flying"), FLIGHT);
  };
  window.addEventListener("panalo:arrive", onArrive);
  // Already on a page when the look was chosen (or the app opened).
  onArrive({ detail: { name: document.body.dataset.view || "now" } });
  if (still) draw(0);
  else wake();

  return {
    stop() {
      cancelAnimationFrame(raf);
      clearTimeout(flyTimer);
      clearTimeout(worldTimer);
      clearTimeout(captionTimer);
      offStore?.();
      window.removeEventListener("panalo:arrive", onArrive);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("scroll", onScroll);

      gradeA.remove();
      gradeB.remove();
      leak.remove();

      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", wake);
      globe?.destroy();
      stage.remove();
      grain.remove();
      caption.remove();
      document.querySelectorAll(".ody-chapter").forEach((c) => c.remove());
      document.body.classList.remove("ody-flying");
      document.documentElement.classList.remove("ody-on");
    },
  };
}
