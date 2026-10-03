// How much this device can draw: "low", "normal" or "high".
//
// Used by the film (and anything else heavy) to pick resolution and detail
// before the first frame, from what the browser can tell us: CPU cores,
// memory (Chrome), the GPU's name, whether it's a phone, and Data Saver.
// The film also watches its own frame times and steps down if this guess
// was too generous.
//
// Override for testing: localStorage "panalo.students.filmtier" = low |
// normal | high.

const WEAK_GPU = /SwiftShader|llvmpipe|Software|Mali-4\d\d|Mali-T\d+|Mali-G(31|51|52|57)\b|Adreno \(TM\) [2-5]\d\d|PowerVR|Intel\(R\) HD Graphics( [2-5]\d{2,3})?\b|GMA|Microsoft Basic/i;
const STRONG_GPU = /RTX|GeForce (GTX|RTX)? ?(1[06-9]|[2-9])\d{2}|Radeon (RX|Pro)|Apple M\d|Intel\(R\) (Iris|Arc)/i;

let cached = null;

function gpuName() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl", { failIfMajorPerformanceCaveat: false });
    if (!gl) return { name: "", none: true };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { name: String(name || "") };
  } catch {
    return { name: "", none: true };
  }
}

/** The tier, and why (for debugging). */
export function deviceTier() {
  if (cached) return cached;
  let forced = null;
  try {
    forced = localStorage.getItem("panalo.students.filmtier");
  } catch {}
  if (["low", "normal", "high"].includes(forced)) return (cached = { tier: forced, why: "forced" });

  const nav = navigator;
  const cores = nav.hardwareConcurrency || 4;
  const mem = typeof nav.deviceMemory === "number" ? nav.deviceMemory : null;
  const saveData = Boolean(nav.connection?.saveData);
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || "") || (window.matchMedia?.("(pointer: coarse)").matches ?? false);
  const gpu = gpuName();

  let tier = "normal";
  const why = [];
  if (gpu.none || WEAK_GPU.test(gpu.name)) {
    tier = "low";
    why.push(gpu.none ? "no-webgl" : "weak-gpu");
  } else if (saveData) {
    tier = "low";
    why.push("save-data");
  } else if (cores <= 2 || (mem !== null && mem <= 2)) {
    tier = "low";
    why.push("small-device");
  } else if (mobile && (cores <= 4 || (mem !== null && mem <= 4))) {
    tier = "low";
    why.push("budget-phone");
  } else if (!mobile && (STRONG_GPU.test(gpu.name) || (cores >= 8 && (mem === null || mem >= 8)))) {
    tier = "high";
    why.push(STRONG_GPU.test(gpu.name) ? "strong-gpu" : "many-cores");
  }
  return (cached = { tier, why: why.join(",") || "default", cores, mem, mobile, gpu: gpu.name });
}

/** What each tier draws. Numbers are multipliers on the film's base counts. */
export const FILM_QUALITY = {
  low: { res: 0.62, dprCap: 1, stars: 0.45, disk: 0.4, sparks: 0.5, motes: 0.5, plate: [720, 444], rays: 14, globe: 720, galaxies: 0, spikes: 0.03 },
  normal: { res: 1, dprCap: 1.5, stars: 1, disk: 1, sparks: 1, motes: 1, plate: [1400, 860], rays: 28, globe: 1536, galaxies: 6, spikes: 0.05 },
  high: { res: 1, dprCap: 2, stars: 1.5, disk: 1.6, sparks: 1.4, motes: 1.6, plate: [2048, 1260], rays: 36, globe: 2048, galaxies: 12, spikes: 0.07 },
};
