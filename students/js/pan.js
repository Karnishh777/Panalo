// Pan, the star kitsune, drawn from parts: the body for a pose, and one
// tail per subject fanned behind it (model/pan-tails.js), lit when that
// subject is ready.
import { el } from "./ui.js";
import { fan, POSES, ASPECT } from "./model/pan-tails.js";

const ART = "assets/pan/";

/** A Pan figure, `size` pixels wide. */
export function panFox({ pose = "idle", tails = 6, lit = 3, size = 200, label } = {}) {
  if (!(pose in POSES)) pose = "idle";
  const c = POSES[pose];
  const list = fan(pose, tails, lit);
  const glowing = list.filter((t) => t.lit).length;
  const box = el("div", {
    class: `pan pan-${pose}`,
    role: "img",
    "aria-label": label || (c ? `Pan, with ${list.length} ${list.length === 1 ? "tail" : "tails"}, ${glowing} glowing` : "Pan, asleep"),
  });
  box.style.width = `${size}px`;
  box.style.height = `${Math.round(size * ASPECT)}px`;
  const len = c ? Math.round(c.len * size) : 0;
  for (const t of list) {
    const img = el("img", { class: "pan-tail", src: `${ART}tail-${t.lit ? "lit" : "dim"}.webp`, alt: "", draggable: "false", decoding: "async" });
    img.style.left = `${c.x}%`;
    img.style.top = `${c.y}%`;
    img.style.height = `${len}px`;
    img.style.transform = `translate(-50%, -100%) rotate(${t.angle}deg)${t.mirror ? " scaleX(-1)" : ""}`;
    box.append(img);
  }
  box.append(el("img", { class: "pan-body", src: `${ART}pan-${pose}.webp`, alt: "", draggable: "false", decoding: "async" }));
  return box;
}
