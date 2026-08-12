// Hand-authored line icons. Every path is stroked with `currentColor` on a
// transparent background, so an icon simply inherits whatever color its button
// has — which means the whole set recolors itself with the theme for free.
//
// Usage:
//   icon("star")                     → an <svg> element
//   <span data-icon="star"></span>   → hydrated by hydrateIcons() on load

const SVG_NS = "http://www.w3.org/2000/svg";

// Each entry is a list of shapes: ["path", d] | ["circle", cx, cy, r] |
// ["rect", x, y, w, h, rx] | ["line", x1, y1, x2, y2]
const PATHS = {
  chat: [["path", "M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5z"]],
  user: [["path", "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"], ["circle", 12, 7, 4]],
  users: [
    ["path", "M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"],
    ["circle", 9.5, 7, 4],
    ["path", "M22 21v-2a4 4 0 0 0-3-3.87"],
    ["path", "M16 3.13a4 4 0 0 1 0 7.75"],
  ],
  star: [["path", "M12 2.8l2.9 5.9 6.4.9-4.6 4.5 1.1 6.4-5.8-3-5.8 3 1.1-6.4L2.7 9.6l6.4-.9L12 2.8z"]],
  settings: [
    ["circle", 12, 12, 3],
    ["path", "M19.1 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.1a2 2 0 0 1-4 0v-.2a1.6 1.6 0 0 0-1-1.4 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.4-1H3a2 2 0 0 1 0-4h.2a1.6 1.6 0 0 0 1.4-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.4V3a2 2 0 0 1 4 0v.2a1.6 1.6 0 0 0 1 1.4 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.4 1h.2a2 2 0 0 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1z"],
  ],
  plus: [["path", "M12 5v14"], ["path", "M5 12h14"]],
  palette: [
    ["path", "M12 3a9 9 0 0 0 0 18c.8 0 1.4-.6 1.4-1.4 0-.4-.1-.7-.4-1-.2-.2-.4-.6-.4-1 0-.8.6-1.4 1.4-1.4h1.6A5.4 5.4 0 0 0 21 10.8C21 6.5 17 3 12 3z"],
    ["circle", 7.5, 11.5, 1.1],
    ["circle", 11, 7.5, 1.1],
    ["circle", 15.5, 9.5, 1.1],
  ],
  more: [["circle", 12, 5, 1.4], ["circle", 12, 12, 1.4], ["circle", 12, 19, 1.4]],
  back: [["path", "M19 12H5"], ["path", "M12 19l-7-7 7-7"]],
  info: [["circle", 12, 12, 9], ["path", "M12 16v-4.5"], ["path", "M12 8.2h.01"]],
  bell: [["path", "M18 8.5a6 6 0 1 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17S18 15 18 8.5"], ["path", "M13.7 20.5a2 2 0 0 1-3.4 0"]],
  bellOff: [
    ["path", "M18 8.5a6 6 0 0 0-9.3-5"],
    ["path", "M5.2 8a6 6 0 0 0 .8 3c0 3.4-1.3 5.3-2 6h12"],
    ["path", "M13.7 20.5a2 2 0 0 1-3.4 0"],
    ["path", "M3 3l18 18"],
  ],
  pin: [["path", "M12 16.5V22"], ["path", "M8.5 11.2V4h7v7.2l2.2 3.6a.6.6 0 0 1-.5.9H6.8a.6.6 0 0 1-.5-.9l2.2-3.6z"]],
  edit: [
    ["path", "M11.5 4.5H5a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h12.5a2 2 0 0 0 2-2v-6.5"],
    ["path", "M18 2.6a2.1 2.1 0 0 1 3 3L12.5 14 8.5 15l1-4L18 2.6z"],
  ],
  trash: [["path", "M3.5 6h17"], ["path", "M8.5 6V4.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2V6"], ["path", "M18.5 6v13a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V6"]],
  clip: [["path", "M21 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.9-2.9l8.5-8.5"]],
  download: [["path", "M21 15.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3.5"], ["path", "M7.5 10.5L12 15l4.5-4.5"], ["path", "M12 15V3"]],
  upload: [["path", "M21 15.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3.5"], ["path", "M16.5 7.5L12 3 7.5 7.5"], ["path", "M12 3v12"]],
  close: [["path", "M18 6L6 18"], ["path", "M6 6l12 12"]],
  send: [["path", "M21.5 2.5L11 13"], ["path", "M21.5 2.5l-6.7 19-3.8-8.5L2.5 9.2l19-6.7z"]],
  image: [["rect", 3, 4.5, 18, 15, 2], ["circle", 8.5, 10, 1.6], ["path", "M21 15.5l-4.8-4.8L6 19.5"]],
  expand: [["path", "M8 3.5H5a1.5 1.5 0 0 0-1.5 1.5v3"], ["path", "M20.5 8V5A1.5 1.5 0 0 0 19 3.5h-3"], ["path", "M16 20.5h3a1.5 1.5 0 0 0 1.5-1.5v-3"], ["path", "M3.5 16v3A1.5 1.5 0 0 0 5 20.5h3"]],
  collapse: [["path", "M4 8.5h3A1.5 1.5 0 0 0 8.5 7V4"], ["path", "M15.5 4v3A1.5 1.5 0 0 0 17 8.5h3"], ["path", "M20 15.5h-3a1.5 1.5 0 0 0-1.5 1.5v3"], ["path", "M8.5 20v-3A1.5 1.5 0 0 0 7 15.5H4"]],
  menu: [["path", "M3.5 12h17"], ["path", "M3.5 6.5h17"], ["path", "M3.5 17.5h17"]],
  logout: [["path", "M9.5 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4.5"], ["path", "M16 16.5l5-4.5-5-4.5"], ["path", "M21 12H9.5"]],
  search: [["circle", 11, 11, 7.5], ["path", "M21 21l-4.6-4.6"]],
  sound: [["path", "M11 5L6.5 9H3v6h3.5L11 19V5z"], ["path", "M15.5 9a4 4 0 0 1 0 6"], ["path", "M18.5 6.5a8 8 0 0 1 0 11"]],
  userPlus: [["path", "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"], ["circle", 9, 7, 4], ["path", "M19 8v6"], ["path", "M22 11h-6"]],
  sparkle: [["path", "M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3z"], ["path", "M18.5 15.5l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3z"]],
  check: [["path", "M20 6.5L9.5 17 4 11.5"]],
  phone: [["path", "M21.6 16.9v2.8a2 2 0 0 1-2.2 2 19.6 19.6 0 0 1-8.5-3 19.3 19.3 0 0 1-6-6 19.6 19.6 0 0 1-3-8.6A2 2 0 0 1 3.9 2h2.8a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.7 9.8a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2.1z"]],
  phoneOff: [["path", "M15.5 3.2a10 10 0 0 1 5.3 5.3M13.9 7a5.5 5.5 0 0 1 3 3"], ["path", "M21.6 16.9v2.8a2 2 0 0 1-2.2 2 19.6 19.6 0 0 1-8.5-3 19.3 19.3 0 0 1-6-6 19.6 19.6 0 0 1-3-8.6A2 2 0 0 1 3.9 2h2.8a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.7 9.8a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2.1z"], ["path", "M2.5 2.5l19 19"]],
  video: [["rect", 2.5, 6, 13, 12, 2.5], ["path", "M21.5 8.5l-6 3.5 6 3.5z"]],
  videoOff: [["path", "M15.5 10.5V8.5a2.5 2.5 0 0 0-2.5-2.5H8.5M2.5 6.6A2.5 2.5 0 0 0 2.5 8.5v7a2.5 2.5 0 0 0 2.5 2.5h8a2.5 2.5 0 0 0 2.1-1.2"], ["path", "M21.5 8.5l-6 3.5 6 3.5z"], ["path", "M2.5 2.5l19 19"]],
  mic: [["path", "M12 2.5a2.9 2.9 0 0 0-2.9 2.9v6a2.9 2.9 0 0 0 5.8 0v-6A2.9 2.9 0 0 0 12 2.5z"], ["path", "M18.5 10.5v1a6.5 6.5 0 0 1-13 0v-1"], ["path", "M12 18v3.5M8.5 21.5h7"]],
  micOff: [["path", "M14.9 5.2a2.9 2.9 0 0 0-5.8.2v5.4M9.1 13.4a2.9 2.9 0 0 0 5.6-.9"], ["path", "M18.5 10.5v1a6.5 6.5 0 0 1-10.4 5.2M5.5 10.5v1a6.5 6.5 0 0 0 1 3.4"], ["path", "M12 18v3.5M8.5 21.5h7"], ["path", "M2.5 2.5l19 19"]],
  checkDouble: [["path", "M2 12.5L6.5 17 15 8.5"], ["path", "M10 14.5l2 2 9-9"]],
  reply: [["path", "M9 15l-5-5 5-5"], ["path", "M4 10h9a6 6 0 0 1 6 6v3"]],
  smile: [["circle", 12, 12, 9], ["path", "M8.5 14.2a4.2 4.2 0 0 0 7 0"], ["path", "M9 9.5h.01"], ["path", "M15 9.5h.01"]],
  camera: [["path", "M21 18.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h2.5l1.6-2.5h5.8L16.5 7.5H19a2 2 0 0 1 2 2z"], ["circle", 12, 13.5, 3.5]],
  file: [["path", "M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5z"], ["path", "M14 2.5v5h5"]],
  type: [["path", "M4 7V5h16v2"], ["path", "M12 5v14"], ["path", "M9 19h6"]],
};

export function icon(name, size = 18) {
  const shapes = PATHS[name];
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("aria-hidden", "true");
  if (!shapes) return svg;

  for (const [type, ...args] of shapes) {
    const node = document.createElementNS(SVG_NS, type);
    if (type === "path") node.setAttribute("d", args[0]);
    else if (type === "circle") {
      node.setAttribute("cx", args[0]);
      node.setAttribute("cy", args[1]);
      node.setAttribute("r", args[2]);
    } else if (type === "rect") {
      node.setAttribute("x", args[0]);
      node.setAttribute("y", args[1]);
      node.setAttribute("width", args[2]);
      node.setAttribute("height", args[3]);
      if (args[4] != null) node.setAttribute("rx", args[4]);
    } else if (type === "line") {
      node.setAttribute("x1", args[0]);
      node.setAttribute("y1", args[1]);
      node.setAttribute("x2", args[2]);
      node.setAttribute("y2", args[3]);
    }
    svg.append(node);
  }
  return svg;
}

// Replace every <span data-icon="name"> in `root` with its rendered icon.
export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((slot) => {
    if (slot.dataset.iconDone) return;
    const size = Number(slot.dataset.iconSize) || 18;
    slot.append(icon(slot.dataset.icon, size));
    slot.dataset.iconDone = "1";
  });
}

// A labelled menu row: icon + text, used by the chat and message menus.
export function iconLabel(name, text) {
  const frag = document.createDocumentFragment();
  frag.append(icon(name, 16), document.createTextNode(" " + text));
  return frag;
}
