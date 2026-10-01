// Whether to animate. The OS setting and the in-app switch both count.
const query = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

export function reducedMotion() {
  return document.documentElement.getAttribute("data-motion") === "reduce" || !!(query && query.matches);
}

// A requestAnimationFrame loop that stops itself while the tab is hidden
// or the canvas is off screen, so nothing burns battery out of sight.
export function animationLoop(canvas, draw) {
  let raf = 0;
  let visible = true;
  let running = false;
  let last = performance.now();

  const frame = (t) => {
    raf = 0;
    if (!running) return;
    const dt = Math.min(64, t - last);
    last = t;
    draw(t, dt);
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (running && !raf && visible && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };

  let io = null;
  if ("IntersectionObserver" in window && canvas) {
    io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      kick();
    });
    io.observe(canvas);
  }
  document.addEventListener("visibilitychange", kick);

  return {
    start() {
      running = true;
      kick();
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    destroy() {
      this.stop();
      io?.disconnect();
      document.removeEventListener("visibilitychange", kick);
    },
  };
}
