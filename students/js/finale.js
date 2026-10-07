// The end of the birth (batch 4): your first constellations, your world's
// name in stars, and the fall into it.
//
// After the three questions, the sky around your new world fills with one
// constellation for each interest you picked, each drawing itself and
// taking its name. Your world's name is written in stars above it. Then the
// camera falls: the world rushes up, the clouds go white, and you're in.
//
// About six seconds; a click, a tap or Escape skips to the end. Under
// reduced motion it doesn't play (the questions are the last thing).
import { el } from "./ui.js";
import { reducedMotion } from "./motion.js";
import { writeInStars } from "./starwriter.js";
import { INTERESTS } from "./model/drift-library.js";

const NS = "http://www.w3.org/2000/svg";

function seeded(seed) {
  let a = 0x9e3779b9;
  for (const c of String(seed)) a = Math.imul(a ^ c.charCodeAt(0), 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A small constellation: 5–7 stars in a loose chain, seeded by its name. */
export function constellation(seed, cx, cy, spread) {
  const rand = seeded(seed);
  const n = 5 + Math.floor(rand() * 3);
  const stars = [];
  let x = cx - spread * 0.5;
  let y = cy + (rand() - 0.5) * spread * 0.4;
  for (let i = 0; i < n; i++) {
    stars.push({ x, y, r: 1.2 + rand() * 1.6 });
    x += (spread / n) * (0.7 + rand() * 0.6);
    y += (rand() - 0.5) * spread * 0.45;
  }
  // A chain, and sometimes one branch back.
  const links = stars.slice(1).map((_, i) => [i, i + 1]);
  if (n > 5 && rand() < 0.7) links.push([1 + Math.floor(rand() * (n - 3)), n - 1]);
  return { stars, links };
}

/**
 * @param {HTMLElement} root  the birth stage
 * @param {{worldName: string, interests: string[], world?: {cx:number, cy:number, size:number}, seed: string}} o
 */
export function playFinale(root, { worldName, interests = [], world, seed }) {
  if (reducedMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = world?.cx ?? vw / 2;
    const cy = world?.cy ?? vh * 0.4;
    const R = (world?.size ?? Math.min(vw, vh) * 0.6) / 3.4; // the planet itself, without its air

    // The name goes in the bigger patch of sky, above or below the planet,
    // clear of it and of the caption.
    const nameH = Math.min(110, Math.max(56, vw * 0.1));
    const above = cy - R;
    const below = vh - (cy + R) - 60;
    const nameY = below >= above
      ? cy + R + Math.min(below / 2, nameH * 0.5 + 40)
      : cy - R - Math.min(above / 2, nameH * 0.5 + 40);
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "finale-sky");
    svg.setAttribute("viewBox", `0 0 ${vw} ${vh}`);
    svg.setAttribute("aria-hidden", "true");
    const picked = INTERESTS.filter((i) => interests.includes(i.id));
    const ring = Math.max(R * 1.9, Math.min(vw, vh) * 0.3);
    picked.forEach((it, k) => {
      // Spread around the world, starting upper left, never on top of it.
      const ang = -Math.PI * 0.85 + (k / Math.max(1, picked.length)) * Math.PI * 1.7;
      const px = Math.min(vw - 60, Math.max(60, cx + Math.cos(ang) * ring * (vw > vh ? 1.35 : 1)));
      const py = Math.min(vh - 40, Math.max(70, cy + Math.sin(ang) * ring * 0.8));
      const c = constellation(`${seed}:${it.id}`, px, py, Math.min(140, Math.max(80, vw * 0.08)));
      // Keep the whole figure, and its label, on screen.
      const top = Math.min(...c.stars.map((s) => s.y));
      const bottom = Math.max(...c.stars.map((s) => s.y)) + 26;
      let shift = top < 24 ? 24 - top : bottom > vh - 64 ? vh - 64 - bottom : 0;
      // And out of the band the name is written in.
      const band = [nameY - nameH / 2 - 12, nameY + nameH / 2 + 12];
      if (top + shift < band[1] && bottom + shift > band[0]) {
        shift = (top + bottom) / 2 < nameY ? band[0] - bottom : band[1] - top;
      }
      for (const s of c.stars) s.y += shift;
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", "finale-const");
      g.style.setProperty("--d", `${300 + k * 280}ms`);
      for (const [a, b] of c.links) {
        const l = document.createElementNS(NS, "line");
        l.setAttribute("x1", c.stars[a].x);
        l.setAttribute("y1", c.stars[a].y);
        l.setAttribute("x2", c.stars[b].x);
        l.setAttribute("y2", c.stars[b].y);
        l.setAttribute("pathLength", "1");
        g.append(l);
      }
      for (const s of c.stars) {
        const dot = document.createElementNS(NS, "circle");
        dot.setAttribute("cx", s.x);
        dot.setAttribute("cy", s.y);
        dot.setAttribute("r", s.r);
        g.append(dot);
      }
      const label = document.createElementNS(NS, "text");
      label.setAttribute("x", c.stars[0].x);
      label.setAttribute("y", Math.max(...c.stars.map((s) => s.y)) + 22);
      label.textContent = it.label.toUpperCase();
      g.append(label);
      svg.append(g);
    });

    const nameCanvas = el("canvas", { class: "finale-name", "aria-hidden": "true" });
    nameCanvas.style.setProperty("--name-y", `${Math.round(nameY)}px`);
    const caption = el("p", { class: "finale-caption", text: picked.length ? "Your first constellations." : "" });
    const fog = el("div", { class: "finale-fog", "aria-hidden": "true" });
    const layer = el("div", { class: "finale", role: "presentation" }, [svg, nameCanvas, caption, fog]);
    root.append(layer);
    root.style.setProperty("--fall-x", `${cx}px`);
    root.style.setProperty("--fall-y", `${cy}px`);
    root.classList.add("finale-on");

    let writer = null;
    const timers = [];
    requestAnimationFrame(() => {
      writer = writeInStars(nameCanvas, worldName || "Your world", { seed, duration: 1600 });
    });
    const fallAt = picked.length ? 4200 : 2900;
    timers.push(setTimeout(() => root.classList.add("falling"), fallAt));
    timers.push(setTimeout(finish, fallAt + 1500));

    const skip = () => finish();
    const onKey = (e) => e.key === "Escape" && finish();
    layer.addEventListener("click", skip);
    document.addEventListener("keydown", onKey);
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      document.removeEventListener("keydown", onKey);
      writer?.stop();
      resolve();
      // The birth's own exit fades everything; tidy after it.
      setTimeout(() => {
        layer.remove();
        root.classList.remove("finale-on", "falling");
      }, 900);
    }
  });
}
