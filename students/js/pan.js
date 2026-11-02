// Pan (v0.3): a fox drawn in stars, the way constellations are -- bright
// points joined by thin lines, a violet star on the brow, sharp eyes. Its
// tails are strands of light fanned behind it, one per subject
// (model/pan-tails.js), dim indigo until that subject is ready for the exam
// hall, then violet into gold with a spark at the tip. Drawn in code, so it
// is sharp at any size and needs no pictures.
import { fan, MAX_TAILS } from "./model/pan-tails.js";

const NS = "http://www.w3.org/2000/svg";
let uid = 0;

const svgEl = (tag, attrs = {}, children = []) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
  for (const c of children) n.append(c);
  return n;
};

// The head, in a 200 x 200 box: stars, and the lines between them.
const STARS = {
  earL: [58, 26], earR: [142, 26],
  baseL: [80, 70], baseR: [120, 70],
  brow: [100, 74],
  cheekL: [48, 102], cheekR: [152, 102],
  jawL: [72, 138], jawR: [128, 138],
  snout: [100, 162],
};
const LINES = [
  ["earL", "baseL"], ["earL", "cheekL"], ["earR", "baseR"], ["earR", "cheekR"],
  ["baseL", "brow"], ["brow", "baseR"],
  ["cheekL", "jawL"], ["jawL", "snout"], ["snout", "jawR"], ["jawR", "cheekR"],
];
// Eyes by pose: thin angled strokes, never round and cute.
// Open eyes are almond-shaped and filled; closed ones are lines.
const ALMOND = ["M71 106 Q82 95 95 102 Q84 108 71 106 Z", "M129 106 Q118 95 105 102 Q116 108 129 106 Z"];
const EYES = {
  idle: { fill: ALMOND },
  early: { fill: ["M73 106 Q83 98 94 103 Q84 108 73 106 Z", "M127 106 Q117 98 106 103 Q116 108 127 106 Z"] },
  think: { fill: ["M71 104 Q82 95 95 101 Q84 106 71 104 Z", "M129 103 Q118 92 105 99 Q116 105 129 103 Z"] },
  cheer: { line: ["M73 106 Q83 96 93 106", "M107 106 Q117 96 127 106"] },
  sleep: { line: ["M73 104 Q83 110 93 104", "M107 104 Q117 110 127 104"] },
};
const STRAND_LEN = { idle: 150, think: 150, cheer: 156, early: 112, sleep: 96 };
// The fan is a little narrower than the pose's own, so the outer tails
// stay in the frame.
const SPREAD = 0.86;

/** Pan, `size` pixels wide, with `tails` strands of which `lit` glow. */
export function panFox({ pose = "idle", tails = 6, lit = 3, size = 200, label, noTails = false } = {}) {
  if (!(pose in EYES)) pose = "idle";
  const id = `pan${++uid}`;
  const asleep = pose === "sleep";
  const list = noTails ? [] : fan(pose === "sleep" ? "idle" : pose, Math.min(MAX_TAILS, tails), asleep ? 0 : lit);
  const glowing = list.filter((t) => t.lit).length;
  const svg = svgEl("svg", {
    class: `pan pan-${pose}`,
    width: size,
    height: size,
    viewBox: "-20 -24 240 240",
    role: "img",
    "aria-label": label || (noTails ? `Pan${asleep ? ", asleep" : ""}` : `Pan, with ${list.length} ${list.length === 1 ? "tail" : "tails"}, ${glowing} glowing`),
    focusable: "false",
  });
  const defs = svgEl("defs", {}, [
    svgEl("linearGradient", { id: `${id}lit`, x1: "0", y1: "1", x2: "0", y2: "0" }, [
      svgEl("stop", { offset: "0", "stop-color": "#7a6bff" }),
      svgEl("stop", { offset: "0.55", "stop-color": "#c7bdff" }),
      svgEl("stop", { offset: "1", "stop-color": "#ffd29a" }),
    ]),
    svgEl("radialGradient", { id: `${id}halo` }, [
      svgEl("stop", { offset: "0", "stop-color": "#9b8cff", "stop-opacity": asleep ? "0.12" : "0.28" }),
      svgEl("stop", { offset: "1", "stop-color": "#9b8cff", "stop-opacity": "0" }),
    ]),
    svgEl("filter", { id: `${id}glow`, x: "-50%", y: "-50%", width: "200%", height: "200%" }, [svgEl("feGaussianBlur", { stdDeviation: "3" })]),
  ]);
  svg.append(defs, svgEl("circle", { cx: 100, cy: 100, r: 104, fill: `url(#${id}halo)` }));

  // The tails, behind the head: from under the jaw, curling outward.
  const root = [100, 176];
  const len = STRAND_LEN[pose];
  const tailsG = svgEl("g", { class: "pan-strands", opacity: asleep ? 0.45 : 1 });
  for (const t of list) {
    const a = (t.angle * SPREAD * Math.PI) / 180;
    // The middle tails reach further, so they clear the ears.
    const reach = len * (1 + 0.24 * Math.cos(a) ** 3);
    const tip = [root[0] + Math.sin(a) * reach, root[1] - Math.cos(a) * reach];
    // Curl: the control point leans outward from the fan's middle.
    const side = t.angle === 0 ? 0 : Math.sign(t.angle);
    const mid = [root[0] + Math.sin(a) * reach * 0.55 + side * 18 * Math.cos(a), root[1] - Math.cos(a) * reach * 0.55 + side * 10];
    const d = `M${root[0]} ${root[1]} Q${mid[0].toFixed(1)} ${mid[1].toFixed(1)} ${tip[0].toFixed(1)} ${tip[1].toFixed(1)}`;
    if (t.lit) {
      const g = svgEl("linearGradient", { id: `${id}s${tailsG.childElementCount}`, gradientUnits: "userSpaceOnUse", x1: root[0], y1: root[1], x2: tip[0].toFixed(1), y2: tip[1].toFixed(1) }, [
        svgEl("stop", { offset: "0", "stop-color": "#7a6bff", "stop-opacity": "0.2" }),
        svgEl("stop", { offset: "0.6", "stop-color": "#c7bdff" }),
        svgEl("stop", { offset: "1", "stop-color": "#ffd29a" }),
      ]);
      defs.append(g);
      const ref = `url(#${g.getAttribute("id")})`;
      tailsG.append(
        svgEl("path", { class: "pan-strand lit", d, fill: "none", stroke: ref, "stroke-width": 7, "stroke-linecap": "round", opacity: 0.35, filter: `url(#${id}glow)` }),
        svgEl("path", { class: "pan-strand lit", d, fill: "none", stroke: ref, "stroke-width": 2.2, "stroke-linecap": "round" }),
        star(tip, 4.2, "#fff4dc", "pan-tip")
      );
    } else {
      tailsG.append(
        svgEl("path", { class: "pan-strand dim", d, fill: "none", stroke: "#4a4890", "stroke-width": 2, "stroke-linecap": "round", opacity: 0.85 }),
        svgEl("path", { class: "pan-strand dim", d, fill: "none", stroke: "#8f8cd8", "stroke-width": 1.4, "stroke-linecap": "round", "stroke-dasharray": "2 7", opacity: 0.9 }),
        svgEl("circle", { cx: tip[0].toFixed(1), cy: tip[1].toFixed(1), r: 2.2, fill: "#a6a3e6" })
      );
    }
  }
  svg.append(tailsG);

  // The head.
  const head = svgEl("g", { class: "pan-head", opacity: pose === "early" ? 0.8 : asleep ? 0.7 : 1 });
  const P = (k) => STARS[k];
  head.append(svgEl("path", { d: `M${P("earL")} L${P("cheekL")} L${P("jawL")} L${P("snout")} L${P("jawR")} L${P("cheekR")} L${P("earR")} L${P("baseR")} L${P("brow")} L${P("baseL")} Z`.replace(/,/g, " "), fill: "#120f28", opacity: 0.75 }));
  // Inner ears, ember.
  head.append(
    svgEl("path", { d: "M62 36 L78 66 L58 82", fill: "none", stroke: "#ff9a4d", "stroke-width": 1.6, "stroke-linecap": "round", opacity: 0.85 }),
    svgEl("path", { d: "M138 36 L122 66 L142 82", fill: "none", stroke: "#ff9a4d", "stroke-width": 1.6, "stroke-linecap": "round", opacity: 0.85 })
  );
  for (const [a, b] of LINES) head.append(svgEl("line", { x1: P(a)[0], y1: P(a)[1], x2: P(b)[0], y2: P(b)[1], stroke: "#c9c3f2", "stroke-width": 1.4, opacity: 0.8 }));
  for (const [k, xy] of Object.entries(STARS)) if (k !== "brow") head.append(star(xy, k.startsWith("ear") || k === "snout" ? 3.4 : 2.6, "#f4f2fb", "pan-star"));
  // The brow star: Pan's own, violet.
  head.append(star(STARS.brow, 7, "#9b8cff", "pan-brow"), svgEl("circle", { cx: 100, cy: 74, r: 1.6, fill: "#fff" }));
  const eyes = EYES[pose];
  for (const d of eyes.fill || []) head.append(svgEl("path", { d, fill: "#ffd29a" }), svgEl("path", { d, fill: "none", stroke: "#ff9a4d", "stroke-width": 1, opacity: 0.8 }));
  for (const d of eyes.line || []) head.append(svgEl("path", { d, fill: "none", stroke: pose === "sleep" ? "#a9a4c4" : "#ffd29a", "stroke-width": 2.6, "stroke-linecap": "round" }));
  if (pose === "think") head.append(star([160, 50], 3, "#c7bdff", "pan-star"), star([174, 34], 2.2, "#c7bdff", "pan-star"));
  if (pose === "cheer") head.append(star([28, 60], 4, "#ffd29a", "pan-star"), star([176, 64], 3.4, "#5ee6b8", "pan-star"));
  if (pose === "sleep") head.append(svgEl("path", { d: "M154 40 h9 l-9 10 h9 M168 24 h6 l-6 7 h6", fill: "none", stroke: "#a9a4c4", "stroke-width": 1.6, "stroke-linejoin": "round" }));
  svg.append(head);
  return svg;
}

/** A four-pointed star. */
function star([x, y], r, fill, cls) {
  const s = r * 0.34;
  return svgEl("path", { class: cls, d: `M${x} ${y - r} L${x + s} ${y - s} L${x + r} ${y} L${x + s} ${y + s} L${x} ${y + r} L${x - s} ${y + s} L${x - r} ${y} L${x - s} ${y - s} Z`, fill });
}

/** Pan in a pose, without tails: for small places (a sheet, the setup). */
export function panPose(pose, { cls = "", label = null, size = 120 } = {}) {
  const svg = panFox({ pose, size, noTails: true, label: label || undefined });
  if (!label) svg.setAttribute("aria-hidden", "true");
  if (cls) svg.setAttribute("class", `${svg.getAttribute("class")} pan-pose ${cls}`);
  return svg;
}
