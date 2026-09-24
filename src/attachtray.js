// Files waiting to be sent, shown above the composer.
//
// The composer used to hold exactly one file: the picker had no `multiple`,
// sending read fileInput.files[0], and choosing a second file silently
// replaced the first. Sharing five photos was five trips through the menu.
// The preview itself printed the icon's name -- the word "file" in large
// accent-coloured type -- where an icon was meant to be.
//
// Now picking, pasting and dropping all add to one queue, each file shows as
// a tile with its own remove button, and Send sends them in order.
import { el, showToast } from "./util.js";
import { icon } from "./icons.js";
import { MAX_FILE_BYTES } from "./config.js";
import { fileKind, badgeLabel, prettyBytes, MAX_FILES_PER_SEND } from "./filekind.js";

/**
 * @param {{ root: HTMLElement, onChange?: (count: number) => void }} parts
 * @returns {{ add: (files: Iterable<File>) => void, take: () => File[], clear: () => void, count: () => number }}
 */
export function createAttachTray({ root, onChange = () => {} }) {
  // Each entry keeps the object URL of its thumbnail so it can be released:
  // the browser holds the whole file in memory for as long as one exists.
  let items = []; // [{ id, file, thumbUrl }]

  function release(list) {
    list.forEach((it) => it.thumbUrl && URL.revokeObjectURL(it.thumbUrl));
  }

  function add(files) {
    const incoming = [...files];
    const room = MAX_FILES_PER_SEND - items.length;
    if (incoming.length > room) {
      showToast(`You can send up to ${MAX_FILES_PER_SEND} files at once.`);
    }
    const tooBig = incoming.filter((f) => f.size > MAX_FILE_BYTES);
    if (tooBig.length) {
      showToast(`${tooBig.map((f) => f.name).join(", ")}: over the 50 MB limit.`);
    }
    const accepted = incoming
      .filter((f) => f.size <= MAX_FILE_BYTES)
      .slice(0, Math.max(0, room))
      .map((file) => ({
        id: crypto.randomUUID(),
        file,
        thumbUrl: fileKind(file) === "image" ? URL.createObjectURL(file) : null,
      }));
    if (!accepted.length) return;
    items = [...items, ...accepted];
    render();
  }

  function remove(id) {
    release(items.filter((it) => it.id === id));
    items = items.filter((it) => it.id !== id);
    render();
  }

  function clear() {
    release(items);
    items = [];
    render();
  }

  // Hand the files to the sender and empty the tray. The sender makes its
  // own previews, so the tray's thumbnails can go.
  function take() {
    const files = items.map((it) => it.file);
    clear();
    return files;
  }

  function tile(it) {
    const kind = fileKind(it.file);
    const face = it.thumbUrl
      ? el("img", { class: "tray-thumb", src: it.thumbUrl, alt: "" })
      : el("span", { class: `tray-badge kind-${kind}`, text: badgeLabel(it.file.name) });
    return el("div", { class: "tray-tile", title: `${it.file.name} · ${prettyBytes(it.file.size)}` }, [
      face,
      el("span", { class: "tray-name", text: it.file.name }),
      el("button", {
        class: "tray-remove",
        type: "button",
        "aria-label": `Remove ${it.file.name}`,
        onClick: () => remove(it.id),
      }, [icon("close", 12)]),
    ]);
  }

  function render() {
    root.replaceChildren();
    root.classList.toggle("hidden", items.length === 0);
    if (items.length) {
      const total = items.reduce((sum, it) => sum + it.file.size, 0);
      root.append(
        el("div", { class: "tray-tiles" }, items.map(tile)),
        el("div", { class: "tray-footer" }, [
          el("span", {
            class: "tray-summary",
            text: `${items.length} ${items.length === 1 ? "file" : "files"} · ${prettyBytes(total)}`,
          }),
          el("button", { class: "tray-clear", type: "button", text: "Remove all", onClick: clear }),
        ])
      );
    }
    onChange(items.length);
  }

  return { add, take, clear, count: () => items.length };
}
