// The painted art on the landing (art.js): the wallpaper behind the hero,
// the cast of subject guardians, and Pan. Nothing shows until the
// paintings are known to exist, so the landing never has a hole.
import { art, artImg, onArt, GUARDIANS } from "./art.js";
import { createAura } from "./motion-art.js";

const CAST = [
  ["physics", "Physics"],
  ["chemistry", "Chemistry"],
  ["biology", "Biology"],
  ["maths", "Maths"],
  ["computing", "Computing"],
  ["commerce", "Economics, Business, Accounting"],
  ["words", "English and the humanities"],
  ["art", "Art and Design"],
];

const abs = (u) => new URL(u, location.href).href;

export function initLandingArt() {
  onArt(() => {
    const wall = art("wall-wide");
    const hero = document.querySelector("#landing .hero");
    if (wall && hero) {
      hero.style.setProperty("--hero-wall", `url("${abs(wall)}")`);
      hero.classList.add("painted");
    }
    cast();
  });
}

function cast() {
  const section = document.getElementById("cast");
  const row = section?.querySelector(".cast-row");
  const members = CAST.filter(([f]) => art(`guardian-${f}`));
  if (!section || !row || members.length < 3 || row.childElementCount) return;
  const [sceneA, sceneB] = section.querySelectorAll(".cast-scene i");
  const name = section.querySelector(".cast-name");
  let front = sceneA;
  // The chosen one's own effect; the landing is a show, so it keeps moving.
  const aura = createAura({ always: () => true });
  const pick = (f, label) => {
    section.style.setProperty("--g", GUARDIANS[f]);
    for (const b of row.children) {
      b.classList.toggle("on", b.dataset.f === f);
      if (b.dataset.f === f && aura.canvas.parentElement !== b) {
        b.append(aura.canvas);
        requestAnimationFrame(() => aura.show(f, GUARDIANS[f], aura.canvas.offsetWidth, aura.canvas.offsetHeight));
      }
    }
    const src = art(`scene-${f}`);
    const back = front === sceneA ? sceneB : sceneA;
    back.style.backgroundImage = src ? `url("${abs(src)}")` : "";
    back.classList.add("show");
    front.classList.remove("show");
    front = back;
    name.textContent = label;
  };
  members.forEach(([f, label], i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cast-guard";
    b.dataset.f = f;
    b.style.setProperty("--g", GUARDIANS[f]);
    b.style.setProperty("--i", String(i));
    b.setAttribute("aria-label", label);
    b.append(artImg(`guardian-${f}`, { cls: "cast-img" }));
    b.addEventListener("pointerenter", () => pick(f, label));
    b.addEventListener("focus", () => pick(f, label));
    b.addEventListener("click", () => pick(f, label));
    row.append(b);
  });
  const pan = artImg("pan-idle", { cls: "cast-pan-img", alt: "Pan, a small star of molten light with a flame crown and a blue scarf" });
  if (pan) section.querySelector(".cast-pan-art").append(pan);
  else section.querySelector(".cast-pan").hidden = true;
  section.hidden = false;
  pick(members[0][0], members[0][1]);
}
