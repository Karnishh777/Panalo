// The sky over Signals: every conversation is a star, and each kind of
// conversation -- people, crews, study circles, classes, projects, rooms --
// is its own constellation.
//
//   size        how many people are in it
//   brightness  how recently anything happened
//   a pulse     unread messages (with the count)
//   a green rim someone you talk to one-to-one is online now
//   the lines   join a constellation's stars in the order they were last
//               active, brightest first, like a figure in the sky
//
// Positions come from each conversation's id, so a star stays where it is
// from visit to visit. Every star is a link (keyboard and screen readers get
// its name, kind and unread count); the list beside it says the same.
const NS = "http://www.w3.org/2000/svg";

function svg(tag, attrs = {}, children = []) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const c of children) if (c) n.append(c);
  return n;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

const TONE_COLOR = {
  "tone-signal": "#b59cff",
  "tone-drift": "#ff9ec4",
  "tone-focus": "#9ad8ff",
  "tone-time": "#ffc47a",
  "tone-world": "#7ee2a8",
};

/**
 * @param {{conversations: any[], contexts: any[], contextOf: Function, titleOf: Function, isOnline: Function, current?: string, width?: number, height?: number}} o
 *   width/height: the space it will fill, so the sky takes that shape and
 *   its type stays readable on a phone.
 */
export function skyMap({ conversations, contexts, contextOf, titleOf, isOnline, current, width = 1000, height = 640 }) {
  const W = Math.round(Math.max(460, Math.min(1000, width * 1.1)));
  const H = Math.round(W * Math.max(0.45, Math.min(2.2, height / Math.max(1, width))));
  const portrait = H > W;
  const groups = contexts.map((ctx) => ({ ctx, items: conversations.filter((c) => contextOf(c) === ctx.id) })).filter((g) => g.items.length);
  const root = svg("svg", { class: "sky-map", viewBox: `0 0 ${W} ${H}`, role: "group", "aria-label": "Your conversations as a sky of constellations" });

  // A field of faint background stars and a band of light across it.
  const defs = svg("defs", {}, [
    svg("radialGradient", { id: "sky-band", cx: "50%", cy: "50%", r: "60%" }, [
      svg("stop", { offset: "0", "stop-color": "#2a2350", "stop-opacity": "0.55" }),
      svg("stop", { offset: "1", "stop-color": "#05070d", "stop-opacity": "0" }),
    ]),
    svg("filter", { id: "sky-glow", x: "-50%", y: "-50%", width: "200%", height: "200%" }, [svg("feGaussianBlur", { stdDeviation: "3" })]),
  ]);
  root.append(defs, svg("ellipse", { cx: W / 2, cy: H / 2, rx: W * 0.6, ry: H * 0.32, fill: "url(#sky-band)", transform: `rotate(-14 ${W / 2} ${H / 2})` }));
  const dust = svg("g", { class: "sky-dust", "aria-hidden": "true" });
  for (let i = 0; i < 140; i++) {
    const r = hash(`d${i}`), q = hash(`e${i}`);
    dust.append(svg("circle", { cx: (r * W).toFixed(1), cy: (q * H).toFixed(1), r: (0.4 + hash(`f${i}`) * 0.9).toFixed(2), style: `--tw:${(2 + hash(`g${i}`) * 5).toFixed(1)}s;--td:${(-hash(`h${i}`) * 6).toFixed(1)}s` }));
  }
  root.append(dust);

  if (!groups.length) return root;

  // Each constellation gets a region of the sky: a ring of centres.
  const n = groups.length;
  const centres = groups.map((_, i) => {
    if (n === 1) return [W / 2, H / 2];
    const a = (i / n) * Math.PI * 2 - Math.PI / 2 + 0.35;
    return [W / 2 + Math.cos(a) * W * (portrait ? 0.22 : 0.3), H / 2 + Math.sin(a) * H * (portrait ? 0.3 : 0.29)];
  });
  const spread = Math.min(W, H) * (n === 1 ? 0.33 : Math.max(0.13, 0.3 - n * 0.022));

  const now = Date.now();
  groups.forEach((g, gi) => {
    const [gx, gy] = centres[gi];
    const color = TONE_COLOR[g.ctx.tone] || "#b59cff";
    // Brightest (most recent) first: the figure is drawn from it.
    const items = [...g.items].sort((a, b) => Date.parse(b.lastAt || b.created_at || 0) - Date.parse(a.lastAt || a.created_at || 0));
    const pts = items.map((c) => {
      const a = hash(c.id) * Math.PI * 2, d = Math.sqrt(hash(`${c.id}r`)) * spread;
      return { c, x: gx + Math.cos(a) * d * 1.25, y: gy + Math.sin(a) * d * 0.8 };
    });
    // Nudge apart stars whose labels would overlap (a star and its name
    // make a box), and keep everything on the map.
    const box = (p) => {
      const t = titleOf(p.c);
      const len = Math.min(20, t.length);
      return { x0: p.x - 12, y0: p.y - 16, x1: p.x + 22 + len * 8.6, y1: p.y + (p.c.unread ? 26 : 14) };
    };
    for (let k = 0; k < 60; k++) {
      let moved = false;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const A = box(pts[i]), B = box(pts[j]);
          const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
          const oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
          if (ox > 0 && oy > 0) {
            moved = true;
            // Separate along the shorter overlap, mostly vertically.
            if (oy < ox * 1.6) {
              const d = (oy / 2 + 2) * (pts[i].y <= pts[j].y ? 1 : -1);
              pts[i].y -= d;
              pts[j].y += d;
            } else {
              const d = (ox / 2 + 2) * (pts[i].x <= pts[j].x ? 1 : -1);
              pts[i].x -= d;
              pts[j].x += d;
            }
          }
        }
      }
      for (const p of pts) {
        p.x = Math.max(30, Math.min(W - (portrait ? 150 : 170), p.x));
        p.y = Math.max(50, Math.min(H - 40, p.y));
      }
      if (!moved) break;
    }

    const cons = svg("g", { class: "sky-cons", style: `--tone:${color}` });
    // The figure's lines.
    if (pts.length > 1) {
      const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
      cons.append(svg("path", { class: "sky-line", d, pathLength: "1", "aria-hidden": "true" }));
    }
    // The constellation's name, above its brightest star.
    const top = Math.min(...pts.map((p) => p.y));
    const mid = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    cons.append(svg("text", { class: "sky-name", x: mid.toFixed(1), y: Math.max(22, top - 30).toFixed(1), "text-anchor": "middle", "aria-hidden": "true" }, [document.createTextNode(g.ctx.label.toUpperCase())]));

    pts.forEach(({ c, x, y }, i) => {
      const ageH = (now - Date.parse(c.lastAt || c.created_at || 0)) / 3600000;
      const bright = ageH < 1 ? 1 : ageH < 24 ? 0.85 : ageH < 168 ? 0.6 : 0.4;
      const members = c.members?.length || (c.type === "direct" ? 2 : 1);
      const r = 3.2 + Math.min(6, Math.log2(members + 1) * 1.6);
      const title = titleOf(c);
      const label = title.length > 20 ? `${title.slice(0, 19)}…` : title;
      const online = c.type === "direct" && c.otherUserId && isOnline(c.otherUserId);
      const unread = c.unread || 0;
      const aria = `${title}, ${g.ctx.label.toLowerCase()}${unread ? `, ${unread} unread` : ""}${online ? ", online now" : ""}`;
      const a = svg("a", { href: `#/signals/${c.id}`, class: `sky-star${unread ? " unread" : ""}${online ? " online" : ""}${current === c.id ? " current" : ""}`, "aria-label": aria, style: `--b:${bright};--i:${i}` }, [
        svg("title", {}, [document.createTextNode(c.preview ? `${title} — ${c.preview}` : title)]),
        svg("circle", { class: "sky-halo", cx: x.toFixed(1), cy: y.toFixed(1), r: (r * 3.2).toFixed(1), filter: "url(#sky-glow)" }),
        unread ? svg("circle", { class: "sky-pulse", cx: x.toFixed(1), cy: y.toFixed(1), r: (r + 4).toFixed(1) }) : null,
        online ? svg("circle", { class: "sky-online", cx: x.toFixed(1), cy: y.toFixed(1), r: (r + 2.5).toFixed(1) }) : null,
        svg("circle", { class: "sky-core", cx: x.toFixed(1), cy: y.toFixed(1), r: r.toFixed(1) }),
        svg("text", { class: "sky-label", x: (x + r + 9).toFixed(1), y: (y + 4).toFixed(1) }, [document.createTextNode(label)]),
        unread ? svg("text", { class: "sky-count", x: (x + r + 9).toFixed(1), y: (y + 20).toFixed(1) }, [document.createTextNode(`${unread > 99 ? "99+" : unread} new`)]) : null,
      ]);
      cons.append(a);
    });
    // Point at a constellation and its figure lights up.
    cons.addEventListener("pointerenter", () => cons.classList.add("lit"));
    cons.addEventListener("pointerleave", () => cons.classList.remove("lit"));
    cons.addEventListener("focusin", () => cons.classList.add("lit"));
    cons.addEventListener("focusout", () => cons.classList.remove("lit"));
    root.append(cons);
  });
  return root;
}
