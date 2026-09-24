// Tests for how attachments are classified and described. Pure, plain Node.
//
// opensInTab() is the security-relevant one: a decrypted attachment opens as
// a blob: URL, which runs with this app's origin, and its MIME type comes
// from the sender. Anything that could run script must be downloaded instead.
import { fileKind, isVisual, opensInTab, badgeLabel, prettyBytes, docSubtitle, extensionOf, MAX_FILES_PER_SEND } from "../src/filekind.js";

let passed = 0;
const failures = [];
const ok = (label, cond) => (cond ? passed++ : failures.push(label));

// ---- fileKind ----------------------------------------------------------------
ok("a JPEG by MIME type is an image", fileKind({ name: "x", type: "image/jpeg" }) === "image");
ok("a PNG with no MIME type is an image by extension", fileKind({ name: "shot.PNG", type: "" }) === "image");
ok("SVG is never an inline image", fileKind({ name: "a.svg", type: "image/svg+xml" }) === "file");
ok("a PDF is a pdf", fileKind({ name: "CH3 Hardware AS QP.pdf", type: "application/pdf" }) === "pdf");
ok("a PDF with no MIME type is a pdf by extension", fileKind({ name: "notes.pdf" }) === "pdf");
ok("a video is a video", fileKind({ name: "clip.mov", type: "video/quicktime" }) === "video");
ok("a spreadsheet is a sheet", fileKind({ name: "marks.xlsx" }) === "sheet");
ok("a zip is an archive", fileKind({ name: "project.zip" }) === "archive");
ok("an unknown file is a file", fileKind({ name: "thing.xyz" }) === "file");
ok("a File-like object works directly", fileKind({ name: "a.jpg", type: "image/jpeg", size: 3 }) === "image");
ok("nothing at all is a file", fileKind() === "file");

ok("images and videos render inline", isVisual("image") && isVisual("video"));
ok("documents do not render inline", !isVisual("pdf") && !isVisual("file"));

// ---- opensInTab ----------------------------------------------------------------
ok("a real PDF opens in a tab", opensInTab("application/pdf"));
ok("a photo opens in a tab", opensInTab("image/jpeg"));
ok("a video opens in a tab", opensInTab("video/mp4"));
ok("HTML never opens in a tab", !opensInTab("text/html"));
ok("HTML with parameters never opens in a tab", !opensInTab("text/html; charset=utf-8"));
ok("SVG never opens in a tab", !opensInTab("image/svg+xml"));
ok("XHTML never opens in a tab", !opensInTab("application/xhtml+xml"));
ok("an unknown type never opens in a tab", !opensInTab("") && !opensInTab(undefined));
ok("MIME case does not matter", opensInTab("Application/PDF") && !opensInTab("TEXT/HTML"));

// ---- labels ------------------------------------------------------------------
ok("the badge names the type", badgeLabel("CH3 Hardware AS QP.pdf") === "PDF");
ok("the badge is at most four characters", badgeLabel("deck.keynote") === "KEYN");
ok("a file with no extension gets FILE", badgeLabel("README") === "FILE");
ok("a dotfile has no extension", extensionOf(".env") === "");
ok("a path is ignored", extensionOf("dir.v2/archive") === "");

ok("bytes", prettyBytes(512) === "512 B");
ok("kilobytes", prettyBytes(121.9 * 1024) === "121.9 KB");
ok("megabytes", prettyBytes(4.7 * 1024 * 1024) === "4.7 MB");
ok("an unknown size is blank", prettyBytes(0) === "" && prettyBytes(NaN) === "");

ok("the subtitle reads like WhatsApp's", docSubtitle({ name: "a.pdf", size: 4.7 * 1024 * 1024 }) === "PDF · 4.7 MB");
ok("the subtitle drops what it doesn't know", docSubtitle({ name: "README", size: 2048 }) === "2.0 KB");

ok("a sane cap on files per send", MAX_FILES_PER_SEND >= 2 && MAX_FILES_PER_SEND <= 30);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exitCode = 1;
}
