// The landing's instruments: the gate (a count to 100 on first arrival),
// the HUD (chapter, progress), the thread (a star per chapter, lit as you
// pass it), headings that decode as they arrive, and numbers that count to
// their value. With reduced motion everything is simply shown as it is.
import { reducedMotion } from "./motion.js";

const pad = (n, w) => String(Math.max(0, Math.round(n))).padStart(w, "0");
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

// ---- The gate -----------------------------------------------------------------------
// Counts to 100 over about a second and a half, but doesn't finish before the
// fonts have arrived (so the page it opens onto is the real one), and never
// waits longer than three seconds.
function gate() {
  const root = document.documentElement;
  if (root.getAttribute("data-gate") !== "on") return;
  const node = document.querySelector(".gate");
  const num = node?.querySelector(".gate-n span");
  if (!node || !num || reducedMotion()) {
    root.removeAttribute("data-gate");
    return;
  }
  root.classList.add("gate-js");
  let fontsIn = false;
  (document.fonts?.ready || Promise.resolve()).then(() => (fontsIn = true));
  const start = performance.now();
  const MIN = 1500, MAX = 3000;
  const step = (now) => {
    const t = now - start;
    // On time alone it eases up to 92%; the last stretch waits for the fonts.
    let p = easeOut(Math.min(1, t / MIN));
    if (!fontsIn && t < MAX) p = Math.min(p, 0.92);
    num.textContent = pad(p * 100, 3);
    node.style.setProperty("--p", p.toFixed(3));
    if (p >= 1) return open();
    requestAnimationFrame(step);
  };
  const open = () => {
    num.textContent = "100";
    node.style.setProperty("--p", "1");
    root.setAttribute("data-gate", "out");
    try {
      sessionStorage.setItem("panalo.students.gate", "1");
    } catch {}
    setTimeout(() => {
      root.removeAttribute("data-gate");
      root.classList.remove("gate-js");
    }, 780);
  };
  requestAnimationFrame(step);
}

// ---- Decoding headings ----------------------------------------------------------------
const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*+=/<>";
export function scramble(el, { duration = 700 } = {}) {
  if (!el || reducedMotion()) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n.data.trim() && !n.parentElement.closest("[aria-hidden='true']")) nodes.push({ n, text: n.data });
  }
  const total = nodes.reduce((a, x) => a + x.text.length, 0);
  if (!total) return;
  const start = performance.now();
  const frame = (now) => {
    const t = Math.min(1, (now - start) / duration);
    let i = 0;
    for (const { n, text } of nodes) {
      let out = "";
      for (const ch of text) {
        // Each character settles in turn, left to right, with a little overlap.
        const settle = (i / total) * 0.75 + 0.25;
        out += t >= settle || ch === " " || ch === "\n" ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0];
        i++;
      }
      n.data = out;
    }
    if (t < 1) requestAnimationFrame(frame);
    else for (const { n, text } of nodes) n.data = text;
  };
  requestAnimationFrame(frame);
}

// ---- Counting numbers -----------------------------------------------------------------
function countUp(el) {
  const to = Number(el.dataset.count), from = Number(el.dataset.from || 0), w = Number(el.dataset.pad || 1);
  if (reducedMotion()) return void (el.textContent = pad(to, w));
  const dur = 1300, start = performance.now();
  const frame = (now) => {
    const t = Math.min(1, (now - start) / dur);
    el.textContent = pad(from + (to - from) * easeOut(t), w);
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function onArrive(nodes, fn) {
  if (!("IntersectionObserver" in window)) return nodes.forEach(fn);
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        fn(e.target);
      }
    },
    { threshold: 0.4 }
  );
  nodes.forEach((n) => io.observe(n));
}

// ---- HUD and thread -------------------------------------------------------------------
function hud(landing) {
  const sections = [...landing.querySelectorAll("section[data-chapter]")];
  const hudNode = landing.querySelector(".hud");
  const thread = landing.querySelector(".thread");
  if (!sections.length || !hudNode || !thread) return;
  const no = hudNode.querySelector(".hud-no"), name = hudNode.querySelector(".hud-name");
  const pct = hudNode.querySelector(".hud-pct span");
  const bar = hudNode.querySelector(".hud-progress");
  const line = thread.querySelector(".thread-line");
  const list = thread.querySelector(".thread-stars");
  const last = sections.length - 1;

  const stars = sections.map((s, i) => {
    const li = document.createElement("li");
    li.style.setProperty("--at", String(last ? i / last : 0));
    const a = document.createElement("a");
    a.href = `#${s.id || "top"}`;
    const label = document.createElement("span");
    label.textContent = `${pad(i, 2)} · ${s.dataset.chapter}`;
    a.append(label);
    li.append(a);
    list.append(li);
    return li;
  });

  let current = -1, queued = false;
  const update = () => {
    queued = false;
    if (landing.hidden) return;
    const max = document.documentElement.scrollHeight - innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
    pct.textContent = pad(p * 100, 3);
    bar.style.setProperty("--p", p.toFixed(4));

    // Which chapter is in front of you, and how far through it you are.
    const mark = innerHeight * 0.45;
    let idx = 0;
    for (let i = 0; i < sections.length; i++) if (sections[i].getBoundingClientRect().top <= mark) idx = i;
    if (p > 0.995) idx = last;
    let frac = 0;
    if (idx < last) {
      const a = sections[idx].getBoundingClientRect().top, b = sections[idx + 1].getBoundingClientRect().top;
      frac = Math.min(1, Math.max(0, (mark - a) / Math.max(1, b - a)));
    }
    line.style.setProperty("--p", (last ? Math.min(1, (idx + frac) / last) : 1).toFixed(4));

    if (idx !== current) {
      current = idx;
      stars.forEach((li, i) => {
        li.classList.toggle("lit", i <= idx);
        li.classList.toggle("here", i === idx);
      });
      hudNode.classList.toggle("at-start", idx === 0);
      no.textContent = pad(idx, 2);
      name.textContent = sections[idx].dataset.chapter;
      scramble(name, { duration: 420 });
    }
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };
  addEventListener("scroll", queue, { passive: true });
  addEventListener("resize", queue);
  update();
}

export function initLandingHud() {
  const landing = document.getElementById("landing");
  if (!landing) return;
  gate();
  hud(landing);
  onArrive([...landing.querySelectorAll("[data-scramble]")], (el) => scramble(el));
  onArrive([...landing.querySelectorAll("[data-count]")], countUp);
}
