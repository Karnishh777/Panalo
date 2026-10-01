// The starfield behind the outside of Panalo.
//
// Three depth layers of stars drift very slowly and parallax a little with
// the pointer. Star count scales with the screen area and is capped, the
// canvas renders at most at 1.5x device pixels, and the loop stops when the
// tab is hidden. With reduced motion it is drawn once and left still.
import { reducedMotion, animationLoop } from "./motion.js";

let loop = null;

export function startSky(canvas) {
  if (!canvas || loop) return;
  const ctx = canvas.getContext("2d");
  let w = 0;
  let h = 0;
  let stars = [];
  let px = 0;
  let py = 0;

  const resize = () => {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(420, Math.round((w * h) / 5200));
    stars = Array.from({ length: n }, () => {
      const z = Math.random();
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        z,
        r: 0.35 + z * 1.15,
        a: 0.25 + z * 0.65,
        tw: Math.random() * Math.PI * 2,
        hue: Math.random() < 0.12 ? (Math.random() < 0.5 ? "255,214,170" : "190,215,255") : "255,255,255",
      };
    });
    draw(performance.now(), 0);
  };

  const draw = (t, dt) => {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      s.x -= dt * 0.004 * (0.2 + s.z);
      if (s.x < -2) s.x = w + 2;
      const tw = 0.75 + 0.25 * Math.sin(t * 0.0012 + s.tw);
      const x = s.x + px * s.z * 14;
      const y = s.y + py * s.z * 10;
      ctx.globalAlpha = s.a * tw;
      ctx.fillStyle = `rgb(${s.hue})`;
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  window.addEventListener("resize", resize);
  window.addEventListener(
    "pointermove",
    (e) => {
      px = e.clientX / w - 0.5;
      py = e.clientY / h - 0.5;
    },
    { passive: true }
  );
  resize();

  loop = animationLoop(canvas, draw);
  if (!reducedMotion()) loop.start();
}
