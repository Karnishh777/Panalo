// What kind of attachment something is, and how to describe it.
//
// Pure functions, no DOM, so they are tested in Node (tests/filekind.test.mjs).
//
// Documents used to render as a generic page icon and a byte count -- a PDF,
// a spreadsheet and a zip all looked identical, and the composer printed the
// icon's NAME ("file") as text where the icon should have been. WhatsApp's
// document card is the model here: a coloured badge naming the type, the
// filename, and "PDF · 4.7 MB" underneath.

// More than this in one go is almost certainly a mis-selected folder, and
// each file is a separate encrypted upload on the sender's connection.
export const MAX_FILES_PER_SEND = 10;

const KINDS = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "avif", "bmp"],
  video: ["mp4", "mov", "webm", "m4v", "mkv"],
  audio: ["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus"],
  pdf: ["pdf"],
  doc: ["doc", "docx", "odt", "rtf", "txt", "md", "pages"],
  sheet: ["xls", "xlsx", "ods", "csv", "numbers"],
  slides: ["ppt", "pptx", "odp", "key"],
  archive: ["zip", "rar", "7z", "tar", "gz"],
};

export function extensionOf(name) {
  const base = String(name ?? "").split(/[\\/]/).pop();
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

// MIME type wins when there is one; the extension decides otherwise. The
// encrypted header carries the type, but files pasted or picked on some
// systems arrive with an empty one. SVG is deliberately not an "image": it
// can carry script, so it is offered as a download, never rendered inline.
export function fileKind({ name = "", type = "" } = {}) {
  const mime = String(type).toLowerCase();
  if (mime.startsWith("image/") && mime !== "image/svg+xml") return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  const ext = extensionOf(name);
  for (const [kind, exts] of Object.entries(KINDS)) {
    if (exts.includes(ext)) return kind;
  }
  return "file";
}

// Shown inline as a picture or a player rather than as a card.
export function isVisual(kind) {
  return kind === "image" || kind === "video";
}

// Whether a decrypted blob of this MIME type may be opened in a new tab.
// A blob: URL carries this app's origin, and the type comes out of the
// sender's encrypted header -- so it is attacker-chosen. Only types the
// browser renders without running page script are allowed; HTML, SVG and
// anything unknown are downloaded instead.
export function opensInTab(type) {
  const t = String(type ?? "").toLowerCase().split(";")[0].trim();
  if (t === "application/pdf") return true;
  if (t.startsWith("image/")) return t !== "image/svg+xml";
  return t.startsWith("video/") || t.startsWith("audio/");
}

// The short label on a document's badge: "PDF", "DOCX", "ZIP". Capped at four
// characters so an odd extension cannot overflow the badge.
export function badgeLabel(name) {
  const ext = extensionOf(name);
  return ext ? ext.slice(0, 4).toUpperCase() : "FILE";
}

export function prettyBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// "PDF · 4.7 MB", or just one half when the other is unknown.
export function docSubtitle({ name = "", size = 0 } = {}) {
  return [extensionOf(name) ? badgeLabel(name) : "", prettyBytes(size)].filter(Boolean).join(" · ");
}
