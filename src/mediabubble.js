// How an attachment looks inside a message.
//
// Moved out of chat.js, which had grown to three thousand lines. Before this:
//   - a photo rendered at whatever size CSS rules further down the stylesheet
//     happened to allow, which in practice was the full width of the chat;
//   - every non-photo file was the same grey page icon and a byte count, so a
//     PDF, a spreadsheet and a zip were indistinguishable;
//   - a video was a download button;
//   - the media sat BELOW the caption, the opposite of every chat app people
//     already know.
// Now: photos and videos fill a bounded frame with the time laid over them;
// documents are a card with a coloured type badge, the name, "PDF · 4.7 MB",
// and open on tap. Which of those an encrypted file is can only be known once
// it is decrypted, because the type is inside the ciphertext -- so the slot
// is a placeholder until then.
import { el, safeImageUrl } from "./util.js";
import { icon } from "./icons.js";
import { loadEncrypted, isEncryptedAttachment } from "./attachments.js";
import { fileKind, badgeLabel, docSubtitle, opensInTab } from "./filekind.js";

// Longer than any real image load, short enough that a stuck placeholder
// does not shimmer forever.
const PLACEHOLDER_TIMEOUT_MS = 10000;

/**
 * The element to put in a message for its attachment, or null if it has none.
 * @param {object} msg a message row, possibly with the optimistic-send fields
 *   _localPreview (object URL of a photo or video being sent) and _localFileMeta.
 * @param {{ getKey: (conversationId: string) => Promise<CryptoKey|null>,
 *           lockedLabel: (conversationId: string) => string }} deps
 */
export function renderAttachment(msg, { getKey, lockedLabel }) {
  if (msg._localPreview) return mediaFrame({ url: msg._localPreview, kind: msg._localKind || "image" });
  if (msg._localFileMeta) return docCard(msg._localFileMeta);
  if (!msg.file_url) return null;
  if (isEncryptedAttachment(msg.file_url)) return encryptedSlot(msg, getKey, lockedLabel);

  // Files from before encryption: documents carry their name and size in the
  // storage path, everything else is a photo.
  const legacy = parseLegacyFileMeta(msg.file_url);
  if (legacy) return docCard(legacy);
  const url = safeImageUrl(msg.file_url);
  return url ? mediaFrame({ url, kind: "image", lazy: true }) : null;
}

function encryptedSlot(msg, getKey, lockedLabel) {
  const slot = el("div", { class: "media-frame loading" });
  getKey(msg.conversation_id)
    .then((key) => loadEncrypted(msg.file_url, key))
    .then((entry) => {
      if (!entry) {
        // A locked device, a key this account never got, a tampered blob or
        // a failed fetch. Say which, rather than leave a broken image icon.
        slot.replaceWith(lockedCard(lockedLabel(msg.conversation_id)));
        return;
      }
      const kind = fileKind({ name: entry.name, type: entry.type });
      slot.replaceWith(
        kind === "image" || kind === "video"
          ? mediaFrame({ url: entry.objectUrl, kind })
          : docCard({ url: entry.objectUrl, name: entry.name, size: entry.size, type: entry.type })
      );
    });
  return slot;
}

function mediaFrame({ url, kind, lazy = false }) {
  const frame = el("div", { class: `media-frame loading kind-${kind}` });
  const reveal = () => frame.classList.remove("loading");
  const media =
    kind === "video"
      ? el("video", { class: "chat-video", src: url, controls: "", preload: "metadata", playsinline: "" })
      : el("img", {
          class: "chat-image",
          src: url,
          alt: "Photo",
          decoding: "async",
          loading: lazy ? "lazy" : null,
        });
  media.addEventListener(kind === "video" ? "loadedmetadata" : "load", reveal);
  media.addEventListener("error", reveal);
  if (kind !== "video" && media.complete) reveal();
  setTimeout(reveal, PLACEHOLDER_TIMEOUT_MS);
  frame.append(media);
  return frame;
}

export function docCard({ url, name, size, type = "" }) {
  const kind = fileKind({ name, type });
  const open = () => {
    if (!url) return; // still uploading
    // Decided by the blob's real MIME type, never by the name: a blob: URL
    // runs with this app's origin, so "report.pdf" typed as text/html would
    // otherwise be a page executing inside Panalo.
    if (opensInTab(type)) window.open(url, "_blank", "noopener");
    else downloadFile(url, name);
  };
  return el("div", {
    class: `doc-card kind-${kind}`,
    role: "button",
    tabindex: "0",
    "aria-label": `Open ${name}`,
    onClick: open,
    onKeydown: (e) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    },
  }, [
    el("span", { class: "doc-badge", "aria-hidden": "true", text: badgeLabel(name) }),
    el("span", { class: "doc-meta" }, [
      el("span", { class: "doc-name", text: name }),
      el("span", { class: "doc-sub", text: docSubtitle({ name, size }) }),
    ]),
    el("button", {
      class: "doc-download",
      type: "button",
      "aria-label": `Download ${name}`,
      onClick: (e) => {
        e.stopPropagation();
        downloadFile(url, name);
      },
    }, [icon("download", 18)]),
  ]);
}

function lockedCard(text) {
  return el("div", { class: "doc-card kind-locked" }, [
    el("span", { class: "doc-badge", "aria-hidden": "true" }, [icon("lock", 18)]),
    el("span", { class: "doc-meta" }, [
      el("span", { class: "doc-name", text: "Attachment can't be opened" }),
      el("span", { class: "doc-sub", text }),
    ]),
  ]);
}

// Save a file under its original name. Fetched as a blob because the
// download attribute is ignored for cross-origin URLs.
export async function downloadFile(url, name) {
  if (!url) return; // still uploading
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("fetch failed");
    const objUrl = URL.createObjectURL(await res.blob());
    const a = el("a", { href: objUrl, download: name || `panalo-${Date.now()}` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 2000);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

// Unencrypted documents live under files/ with size and name in the path:
//   files/<ts>_<uuid>_s<bytes>__<original-name>
function parseLegacyFileMeta(url) {
  const safe = safeImageUrl(url); // same allow-list as images
  if (!safe || !safe.includes("/chat-files/files/")) return null;
  let base = safe.split("/").pop() || "";
  try {
    base = decodeURIComponent(base);
  } catch {
    /* keep raw */
  }
  const m = /_s(\d+)__(.+)$/.exec(base);
  return { url: safe, size: m ? Number(m[1]) : 0, name: m ? m[2] : base };
}
