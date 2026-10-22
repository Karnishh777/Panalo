// Beacons over a globe: friends' cities (and yours), each a small light
// with a name, following the planet as it turns and fading as it goes round
// the back. Works with either renderer (project + onFrame).
import { el } from "./ui.js";

/**
 * @param globe  a globe from createGlobe (needs project and onFrame)
 * @param canvas the globe's canvas
 * @param onPick called with a beacon's id when it's pressed
 */
export function beaconLayer(globe, canvas, { onPick } = {}) {
  const layer = el("div", { class: "beacons", "aria-hidden": "false" });
  canvas.insertAdjacentElement("afterend", layer);
  let items = []; // { data, node }
  let focused = null;

  function place() {
    layer.style.left = `${canvas.offsetLeft}px`;
    layer.style.top = `${canvas.offsetTop}px`;
    layer.style.width = `${canvas.offsetWidth}px`;
    layer.style.height = `${canvas.offsetHeight}px`;
    for (const it of items) {
      const p = globe.project?.(it.data.lat, it.data.lon);
      if (!p) {
        it.node.style.opacity = "0";
        continue;
      }
      // Fade out towards the limb and hide round the back.
      const k = Math.max(0, Math.min(1, (p.front - 0.04) / 0.22));
      it.node.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      it.node.style.opacity = String(k);
      it.node.style.visibility = k < 0.02 ? "hidden" : "visible";
      it.node.classList.toggle("near-limb", k < 0.6);
      it.x = p.x;
      it.y = p.y;
      it.k = k;
    }
    // Two cities close together: one name each, not a pile of labels. The
    // chosen one, then you, then whoever faces you most, keep theirs.
    const order = items.filter((it) => it.k >= 0.6).sort((a, b) => (b.data.id === focused) - (a.data.id === focused) || !!b.data.self - !!a.data.self || b.k - a.k);
    const kept = [];
    for (const it of order) {
      it.w ||= it.node.querySelector(".beacon-tag")?.offsetWidth || 80;
      const box = { l: it.x + 8, r: it.x + 14 + it.w, t: it.y - 12, b: it.y + 12 };
      const clash = kept.some((o) => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t);
      it.node.classList.toggle("tag-hidden", clash);
      if (!clash) kept.push(box);
    }
    items.filter((it) => !(it.k >= 0.6)).forEach((it) => it.node.classList.remove("tag-hidden"));
  }

  const stop = globe.onFrame?.(place) || (() => {});
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
  ro?.observe(canvas);

  return {
    node: layer,
    /** [{ id, lat, lon, name, where, self }] */
    set(list) {
      items = list.map((d) => {
        const node = el("button", {
          type: "button",
          class: `beacon${d.self ? " self" : ""}${focused === d.id ? " focus" : ""}`,
          "data-id": d.id,
          "aria-label": `${d.name}, ${d.where}`,
          onClick: () => onPick?.(d.id),
        }, [
          el("span", { class: "beacon-dot", "aria-hidden": "true" }),
          el("span", { class: "beacon-tag" }, [el("b", { text: d.name }), el("small", { text: d.where })]),
        ]);
        return { data: d, node };
      });
      layer.replaceChildren(...items.map((i) => i.node));
      place();
    },
    focus(id) {
      focused = id;
      items.forEach((i) => i.node.classList.toggle("focus", i.data.id === id));
      place();
    },
    destroy() {
      stop();
      ro?.disconnect();
      layer.remove();
    },
  };
}
