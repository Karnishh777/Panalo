// Artifact glyphs: one shape per kind of file, so a glance tells you what
// something is before you read the label. Drawn as SVG strokes in the
// archive's sand tone. The label next to the glyph always names the type in
// words too -- the shape is a shortcut, never the only signal.
const NS = "http://www.w3.org/2000/svg";

const SHAPES = {
  // PDF: a monolith with a folded corner.
  pdf: ["M14 6h14l8 8v26a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z", "M28 6v8h8", "M17 22h14M17 27h14M17 32h9"],
  // Image: a crystal.
  image: ["M24 5l13 9-5 22H16l-5-22z", "M11 14h26M24 5l-6 9 6 22 6-22z"],
  // Video: a prism.
  video: ["M8 12h22v24H8z", "M30 18l10-6v24l-10-6", "M15 19l7 5-7 5z"],
  // Audio: a ringed body.
  audio: ["M24 14a10 10 0 1 1 0 20 10 10 0 0 1 0-20z", "M5 28c4 6 34-2 38-10"],
  // Document: a tablet with lines.
  doc: ["M12 7h24v34H12z", "M17 15h14M17 21h14M17 27h14M17 33h8"],
  // Spreadsheet: a lattice.
  sheet: ["M9 10h30v28H9z", "M9 19h30M9 28h30M19 10v28M29 10v28"],
  // Slides: stacked plates.
  slides: ["M10 16h28v20H10z", "M14 11h20M18 6h12", "M24 36v6M18 42h12"],
  // Archive: a capsule.
  archive: ["M17 6h14a7 7 0 0 1 7 7v22a7 7 0 0 1-7 7H17a7 7 0 0 1-7-7V13a7 7 0 0 1 7-7z", "M10 20h28", "M22 24h4v6h-4z"],
  // Anything else: an asteroid.
  file: ["M14 10l12-4 12 8 2 14-8 12-14 2-10-10z", "M20 18a2 2 0 1 0 0 .1M30 28a3 3 0 1 0 0 .1"],
};

export const KIND_LABEL = { pdf: "PDF", image: "Image", video: "Video", audio: "Audio", doc: "Document", sheet: "Spreadsheet", slides: "Slides", archive: "Archive", file: "File" };

export function glyph(kind, size = 44) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `glyph glyph-${kind}`);
  for (const d of SHAPES[kind] || SHAPES.file) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}
