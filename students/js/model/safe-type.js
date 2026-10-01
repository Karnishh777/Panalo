// The type an archive file's blob is given, decided here and nowhere else.
//
// The type a blob carries decides what the browser does with it, and a
// blob: URL runs with THIS app's origin. So it is never taken from the
// uploader -- the stored Content-Type and mime_type are both theirs to
// choose: an HTML page labelled "notes.pdf" and opened in a tab would be
// script running inside Panalo, with the viewer's session. Only types that
// cannot execute get through; everything else becomes opaque bytes, fit
// only for downloading. Pure (tests/students-model.test.mjs).
import { fileKind } from "../../../src/filekind.js";

const SAFE_IMAGE = /^image\/(png|jpe?g|gif|webp|avif|bmp|heic|heif)$/;
const SAFE_MEDIA = /^(audio|video)\/[\w.+-]+$/;
const TEXT_EXT = /\.(txt|md|csv|json|log|ya?ml|tex)$/i;

export function safeBlobType({ mime_type = "", file_name = "" } = {}) {
  const mime = String(mime_type || "").toLowerCase().trim();
  const kind = fileKind({ name: file_name, type: mime });
  if (kind === "pdf") return "application/pdf";
  if (kind === "image" && SAFE_IMAGE.test(mime)) return mime;
  if ((kind === "audio" || kind === "video") && SAFE_MEDIA.test(mime)) return mime;
  if (mime.startsWith("text/") || TEXT_EXT.test(file_name || "")) return "text/plain;charset=utf-8";
  return "application/octet-stream";
}
