// The comet (v0.3): a small bright comet that circles your world on a
// tilted orbit. Its streaks are your subjects -- dim indigo until a subject
// is ready for the exam hall, then gold; the middle streaks
// light first. cometOrbit lays it over a globe (the globe fills 1/1.7 of
// half its canvas, so its disk is 118 of the 400 units here, and the comet
// is hidden behind it on the far half of the orbit); cometMark draws the
// comet alone, for small places. With reduced motion it holds still.
import { reducedMotion } from "./motion.js";
import { MAX_STREAKS } from "./model/streaks.js";

const NS = "http://www.w3.org/2000/svg";
let uid = 0;
const svgEl = (tag, attrs = {}, children = []) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
  for (const c of children) n.append(c);
  return n;
};
const counts = (streaks, lit) => {
  const n = Math.max(1, Math.min(MAX_STREAKS, Math.round(streaks)));
  return [n, Math.max(0, Math.min(n, Math.round(lit)))];
};
const describe = (n, k) => `${n} ${n === 1 ? "streak" : "streaks"}, one per subject, ${k} glowing`;

function gradients(id) {
  return svgEl("defs", {}, [
    svgEl("linearGradient", { id: `${id}lit`, x1: "1", y1: "0", x2: "0", y2: "0" }, [
      svgEl("stop", { offset: "0", "stop-color": "#fff1d6" }),
      svgEl("stop", { offset: "0.35", "stop-color": "#ffc27a" }),
      svgEl("stop", { offset: "1", "stop-color": "#ff9a4d", "stop-opacity": "0" }),
    ]),
    svgEl("linearGradient", { id: `${id}dim`, x1: "1", y1: "0", x2: "0", y2: "0" }, [
      svgEl("stop", { offset: "0", "stop-color": "#8f8cd8", "stop-opacity": "0.8" }),
      svgEl("stop", { offset: "1", "stop-color": "#4a4890", "stop-opacity": "0" }),
    ]),
    svgEl("radialGradient", { id: `${id}head` }, [
      svgEl("stop", { offset: "0", "stop-color": "#ffffff" }),
      svgEl("stop", { offset: "0.4", "stop-color": "#ffe2b8", "stop-opacity": "0.9" }),
      svgEl("stop", { offset: "1", "stop-color": "#ff9a4d", "stop-opacity": "0" }),
    ]),
  ]);
}

// The comet, pointing along +x, its streaks trailing behind towards -x.
function comet(id, n, k) {
  const g = svgEl("g", { class: "comet" });
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2));
  const on = new Set(order.slice(0, k));
  for (let i = 0; i < n; i++) {
    const spread = n > 1 ? (i / (n - 1) - 0.5) * 2 : 0; // -1..1
    const len = 70 - Math.abs(spread) * 22;
    const y = spread * 9;
    const lit = on.has(i);
    g.append(
      svgEl("path", {
        class: `comet-streak ${lit ? "lit" : "dim"}`,
        d: `M 0 0 Q ${-len * 0.5} ${y * 0.4} ${-len} ${y}`,
        fill: "none",
        stroke: `url(#${id}${lit ? "lit" : "dim"})`,
        "stroke-width": lit ? 2.6 : 1.4,
        "stroke-linecap": "round",
      })
    );
  }
  g.append(svgEl("circle", { r: 9, fill: `url(#${id}head)` }), svgEl("circle", { r: 2.6, fill: "#fff" }));
  return g;
}

/**
 * The orbit and its comet, to lay over a globe: `streaks` streaks, `lit` of
 * them glowing; one turn every `period` seconds.
 */
export function cometOrbit({ streaks = 6, lit = 0, period = 26, label, globe = 118 } = {}) {
  const id = `comet${++uid}`;
  const [n, k] = counts(streaks, lit);
  // A 400 x 400 box with the globe in the middle; the orbit is a wide
  // ellipse, tilted, a little larger than the globe.
  const orbit = "M 22 214 A 178 62 -14 1 1 378 186 A 178 62 -14 1 1 22 214";
  const svg = svgEl("svg", { class: "comet-orbit", viewBox: "0 0 400 400", role: "img", "aria-label": label || `A comet circles your world: ${describe(n, k)}`, focusable: "false" });
  const defs = gradients(id);
  // Everything but the far half of the planet's disk (the orbit's tilt).
  const c = Math.cos((14 * Math.PI) / 180) * globe, sn = Math.sin((14 * Math.PI) / 180) * globe;
  defs.append(
    svgEl("clipPath", { id: `${id}near` }, [
      svgEl("path", { "clip-rule": "evenodd", d: `M0 0H400V400H0Z M${(200 - c).toFixed(1)} ${(200 + sn).toFixed(1)} A${globe} ${globe} 0 0 1 ${(200 + c).toFixed(1)} ${(200 - sn).toFixed(1)} Z` }),
    ])
  );
  const path = svgEl("path", { class: "comet-path", d: orbit, fill: "none", stroke: "rgba(199,189,255,0.28)", "stroke-width": 1, "stroke-dasharray": "1 6" });
  const head = comet(id, n, k);
  if (reducedMotion()) head.setAttribute("transform", "translate(372 196) rotate(-170)");
  else head.append(svgEl("animateMotion", { dur: `${period}s`, repeatCount: "indefinite", rotate: "auto", path: orbit }));
  svg.append(defs, svgEl("g", { "clip-path": `url(#${id}near)` }, [path, head]));
  return svg;
}

/** The comet alone, `width` pixels wide, flying up and to the right. */
export function cometMark({ streaks = 6, lit = 0, width = 96, label } = {}) {
  const id = `comet${++uid}`;
  const [n, k] = counts(streaks, lit);
  const svg = svgEl("svg", {
    class: "comet-mark",
    viewBox: "-72 -14 84 50",
    width,
    height: Math.round((width * 50) / 84),
    role: "img",
    "aria-label": label || `Your subjects as a comet: ${describe(n, k)}`,
    focusable: "false",
  });
  const g = comet(id, n, k);
  g.setAttribute("transform", "rotate(-24)");
  svg.append(gradients(id), g);
  return svg;
}
