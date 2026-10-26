// Archive: your files as catalogued artifacts.
//
// Not a thumbnail grid. Each file is a specimen with a label that answers
// the questions you actually have: what is it, what type, how big, when,
// and can I preview it. Everything here is yours and only yours. Files are laid down
// in strata -- one layer per month -- so "that PDF from last term" is
// somewhere you can point at.
import { el, openSheet, confirmSheet, popMenu, showToast, emptyState, getPrefs, setPrefs } from "../ui.js";
import { store, on } from "../store.js";
import { fileKind, prettyBytes, extensionOf } from "../../../src/filekind.js";
import { glyph, KIND_LABEL } from "../glyphs.js";
import * as A from "../archive-data.js";

let root;
let bodyEl;
let headSub;
let meterEl;
let filter = { text: "", shelf: null, kind: null };

// Kinds you can filter by; "other" is everything else.
const KIND_FILTERS = [["pdf", "PDFs"], ["image", "Images"], ["audio", "Audio"], ["video", "Video"], ["other", "Other"]];
const kindGroup = (r) => (["pdf", "image", "audio", "video"].includes(kindOf(r)) ? kindOf(r) : "other");
let unsubs = [];

// prettyBytes() leaves zero blank (right for a file card); a quota needs "0 B".
const bytes = (n) => prettyBytes(Number(n)) || "0 B";
const TEXTISH = ["txt", "md", "csv", "json", "js", "ts", "py", "java", "c", "cpp", "h", "html", "css", "tex", "rtf", "log", "yml", "yaml", "xml"];

function kindOf(r) {
  return fileKind({ name: r.file_name, type: r.mime_type || "" });
}

function previewKind(r) {
  const k = kindOf(r);
  if (["image", "video", "audio", "pdf"].includes(k)) return k;
  const mime = (r.mime_type || "").toLowerCase();
  if (mime.startsWith("text/") || TEXTISH.includes(extensionOf(r.file_name))) return Number(r.size_bytes) <= 1024 * 1024 ? "text" : null;
  return null;
}

// Stars: the files you reach for most, kept on a shelf at the top (synced
// with your preferences).
const starred = () => new Set(Array.isArray(getPrefs().archiveStars) ? getPrefs().archiveStars : []);
function toggleStar(r) {
  const s = starred();
  if (s.has(r.id)) s.delete(r.id);
  else s.add(r.id);
  const live = new Set((store.resources || []).map((x) => x.id));
  setPrefs({ archiveStars: [...s].filter((id) => live.has(id)) });
  render();
}
const SORTS = [
  ["new", "Newest"],
  ["old", "Oldest"],
  ["az", "A–Z"],
  ["big", "Largest"],
];
const sortNow = () => (SORTS.some(([v]) => v === getPrefs().archiveSort) ? getPrefs().archiveSort : "new");

function artifact(r) {
  const k = kindOf(r);
  const isStar = starred().has(r.id);
  const pv = previewKind(r);
  const ext = extensionOf(r.file_name).toUpperCase();
  const when = new Date(r.created_at);
  return el("li", { class: `artifact kind-${k}` }, [
    el("span", { class: "artifact-glyph" }, [glyph(k)]),
    el("div", { class: "artifact-label" }, [
      el("b", { class: "artifact-title", text: r.title }),
      el("span", { class: "artifact-file" }, [
        el("span", { text: r.file_name }),
        " · ",
        el("span", { class: "tag tone-archive", text: ext && ext.length <= 5 ? ext : KIND_LABEL[k] }),
        " · ",
        el("span", { class: "num", text: bytes(r.size_bytes) }),
      ]),
      el("span", { class: "artifact-prov" }, [
        "Added ",
        el("time", { datetime: r.created_at, text: when.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) }),
        r.shelf ? el("span", { class: "shelf", text: ` · on “${r.shelf}”` }) : null,
      ]),
      r.note ? el("span", { class: "artifact-note", text: r.note }) : null,
    ]),
    el("div", { class: "artifact-actions" }, [
      el("button", { type: "button", class: `icon-btn sm star-btn${isStar ? " on" : ""}`, "aria-pressed": String(isStar), "aria-label": isStar ? `Unstar ${r.title}` : `Star ${r.title}`, title: isStar ? "Starred" : "Star", text: isStar ? "★" : "☆", onClick: () => toggleStar(r) }),
      pv ? el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "Preview", onClick: () => preview(r) }) : el("span", { class: "faint no-preview", text: "No preview" }),
      el("button", {
        type: "button",
        class: "btn btn-quiet btn-sm",
        text: "Download",
        onClick: async (e) => {
          e.currentTarget.disabled = true;
          if (!(await A.downloadResource(r))) showToast("Couldn't download it. Check your connection.");
          e.currentTarget.disabled = false;
        },
      }),
      el("button", {
        type: "button",
        class: "icon-btn sm",
        "aria-label": `More for ${r.title}`,
        text: "⋯",
        onClick: (e) =>
          popMenu(e.currentTarget, [
            { label: "Rename or re-shelve", onClick: () => edit(r) },
            { label: "Delete", danger: true, onClick: () => remove(r) },
          ]),
      }),
    ]),
  ]);
}

function render() {
  if (!bodyEl) return;
  const all = store.resources;
  if (all === null) {
    bodyEl.replaceChildren(el("div", { class: "loading-line" }));
    return;
  }
  const used = A.usedBytes();
  const quota = bytes(A.ARCHIVE_QUOTA).replace(/\.0 /, " ");
  headSub.textContent = used > 0 ? `Only you can see these. You're using ${bytes(used)} of ${quota}.` : `Only you can see these. Room for ${quota}.`;
  const share = Math.min(1, used / A.ARCHIVE_QUOTA);
  meterEl.style.setProperty("--used", `${(share * 100).toFixed(1)}%`);
  meterEl.classList.toggle("high", share > 0.85);
  meterEl.setAttribute("aria-valuenow", String(Math.round(share * 100)));
  const q = filter.text.trim().toLowerCase();
  const shelves = [...new Set(all.map((r) => r.shelf).filter(Boolean))].sort();
  const items = all.filter(
    (r) =>
      (!filter.shelf || r.shelf === filter.shelf) &&
      (!filter.kind || kindGroup(r) === filter.kind) &&
      (!q || `${r.title} ${r.file_name} ${r.shelf || ""} ${r.note || ""}`.toLowerCase().includes(q))
  );

  const toolbar = el("div", { class: "arch-tools" }, [
    (() => {
      const present = new Set(all.map(kindGroup));
      const kinds = KIND_FILTERS.filter(([k]) => present.has(k));
      return kinds.length > 1
        ? el(
            "div",
            { class: "chips kind-chips", role: "group", "aria-label": "Kind of file" },
            kinds.map(([k, label]) => el("button", { type: "button", class: "chip tone-archive", "aria-pressed": String(filter.kind === k), "data-kind-filter": k, text: label, onClick: () => { filter.kind = filter.kind === k ? null : k; render(); } }))
          )
        : null;
    })(),
    q || filter.kind || filter.shelf ? el("span", { class: "faint arch-count", role: "status", text: `${items.length} of ${all.length}` }) : null,
    shelves.length
      ? el("div", { class: "chips shelf-chips", role: "group", "aria-label": "Shelves" }, [
          ...shelves.map((s) =>
            el("button", {
              type: "button",
              class: "chip tone-archive",
              "aria-pressed": String(filter.shelf === s),
              text: s,
              onClick: () => {
                filter.shelf = filter.shelf === s ? null : s;
                render();
              },
            })
          ),
        ])
      : null,
  ]);

  if (!items.length) {
    bodyEl.replaceChildren(
      toolbar,
      all.length
        ? emptyState("Nothing matches.", "Try another word, or clear the filters.")
        : el("div", { class: "archive-empty" }, [
            el("div", { class: "shelf-art", "aria-hidden": "true" }, ["PDF", "Slides", "Audio", "Image", "Notes", "Code"].map((t, i) => el("span", { class: `shelf-file f${i}`, text: t }))),
            el("div", { class: "archive-empty-copy" }, [
              el("h3", { text: "Your shelves are waiting." }),
              el("p", { text: "Notes, past papers, slides, recordings, sketches. Drop a file anywhere on this page, or upload one. Only you can see them." }),
              el("button", { type: "button", class: "btn btn-primary", text: "Upload your first file", onClick: () => openUpload() }),
            ]),
          ])
    );
    return;
  }

  // Starred first, on their own shelf (when anything starred is showing).
  const stars = starred();
  const top = items.filter((r) => stars.has(r.id));
  const starShelf = top.length
    ? el("section", { class: "stratum starred" }, [el("h2", { class: "stratum-h" }, [el("span", { text: "★ Starred" }), el("small", { class: "num", text: `${top.length}` })]), el("ul", { class: "artifacts" }, top.map(artifact))])
    : null;
  const sort = sortNow();
  const sortSel = el("label", { class: "arch-sort" }, [
    el("span", { class: "faint", text: "Sort" }),
    (() => {
      const s = el("select", { class: "input", "aria-label": "Sort the archive" }, SORTS.map(([v, l]) => el("option", { value: v, text: l })));
      s.value = sort;
      s.addEventListener("change", () => (setPrefs({ archiveSort: s.value }), render()));
      return s;
    })(),
  ]);
  toolbar.append(sortSel);
  // By name or size: one flat list. By date: strata, a layer per month.
  if (sort === "az" || sort === "big") {
    const flat = [...items].sort((a, b) => (sort === "az" ? a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) : (b.size_bytes || 0) - (a.size_bytes || 0)));
    bodyEl.replaceChildren(...[toolbar, starShelf, el("section", { class: "stratum" }, [el("h2", { class: "stratum-h" }, [el("span", { text: sort === "az" ? "A to Z" : "Largest first" }), el("small", { class: "num", text: `${flat.length} artifact${flat.length === 1 ? "" : "s"}` })]), el("ul", { class: "artifacts" }, flat.map(artifact))])].filter(Boolean));
    return;
  }
  // Strata: one layer per month, newest (or oldest) on top.
  const layers = new Map();
  for (const r of sort === "old" ? [...items].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)) : items) {
    const d = new Date(r.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!layers.has(key)) layers.set(key, { label: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }), items: [] });
    layers.get(key).items.push(r);
  }
  const strata = [...layers.values()].map((layer, i) =>
    el("section", { class: "stratum", style: `--depth:${Math.min(i, 6)}` }, [
      el("h2", { class: "stratum-h" }, [el("span", { text: layer.label }), el("small", { class: "num", text: `${layer.items.length} artifact${layer.items.length === 1 ? "" : "s"}` })]),
      el("ul", { class: "artifacts" }, layer.items.map(artifact)),
    ])
  );
  bodyEl.replaceChildren(...[toolbar, starShelf, ...strata].filter(Boolean));
}

async function preview(r) {
  const kind = previewKind(r);
  const slot = el("div", { class: "preview-slot" }, [el("div", { class: "loading-line" })]);
  const sheet = openSheet({
    title: r.title,
    lead: `${r.file_name} · ${prettyBytes(Number(r.size_bytes))}`,
    body: [slot],
    wide: true,
    form: false,
    actions: [{ label: "Download", kind: "btn-ghost", close: false, onClick: () => A.downloadResource(r) }, { label: "Close", kind: "btn-primary" }],
  });
  if (kind === "pdf") {
    // Open from a short-lived Storage link; nothing is downloaded first.
    const link = await A.pdfLink(r);
    if (!link) {
      slot.replaceChildren(el("p", { class: "muted", text: "This file can't be shown here. Download it to open it." }));
      return sheet;
    }
    slot.replaceChildren(
      el("p", { class: "muted", text: "PDFs open in your browser's own viewer, in a new tab." }),
      el("a", { class: "btn btn-primary", href: link, target: "_blank", rel: "noopener noreferrer", text: "Open the PDF" })
    );
    return sheet;
  }
  const url = await A.resourceUrl(r);
  if (!url) return slot.replaceChildren(el("p", { class: "error-line", text: "Couldn't open this file. Check your connection." }));
  if (kind === "image") slot.replaceChildren(el("img", { src: url, alt: r.title, class: "preview-img" }));
  else if (kind === "video") slot.replaceChildren(el("video", { src: url, controls: "", class: "preview-media" }));
  else if (kind === "audio") slot.replaceChildren(el("audio", { src: url, controls: "", class: "preview-audio" }));
  else if (kind === "text") {
    const text = await fetch(url).then((x) => x.text());
    slot.replaceChildren(el("pre", { class: "preview-text", text: text.slice(0, 200000) }));
  }
  return sheet;
}

function shelfInput(value = "") {
  const listId = `shelves-${Math.random().toString(36).slice(2)}`;
  const shelves = [...new Set((store.resources || []).map((r) => r.shelf).filter(Boolean))];
  return [el("input", { type: "text", maxlength: "40", value, list: listId, placeholder: "e.g. Physics, Past papers" }), el("datalist", { id: listId }, shelves.map((s) => el("option", { value: s })))];
}

export function openUpload(prefilled = null) {
  const file = el("input", { type: "file" });
  const title = el("input", { type: "text", maxlength: "120", placeholder: "What is it?" });
  const [shelf, shelfList] = shelfInput();
  const note = el("textarea", { maxlength: "280", placeholder: "A note for future you (optional)" });
  let chosen = prefilled;
  const chosenLabel = el("p", { class: "field-hint" });
  const showChosen = () => (chosenLabel.textContent = chosen ? `${chosen.name} · ${prettyBytes(chosen.size)}` : "");
  file.addEventListener("change", () => {
    chosen = file.files[0] || null;
    if (chosen && !title.value) title.value = chosen.name.replace(/\.[^.]+$/, "");
    showChosen();
  });
  if (chosen) title.value = chosen.name.replace(/\.[^.]+$/, "");
  showChosen();
  // Progress you can see, and a way out of a slow upload.
  const bar = el("progress", { class: "upload-progress", max: "100", value: "0", "aria-label": "Upload progress" });
  const pct = el("span", { class: "upload-pct num", "aria-live": "polite" });
  const progress = el("div", { class: "upload-meter", hidden: true }, [bar, pct]);
  let controller = null;
  const fields = [file, title, shelf, note];
  const sheet = openSheet({
    title: "Add to the archive",
    lead: "Up to 50 MB per file. Only you can open it. Archive files are protected by access rules on the server, not end-to-end encrypted.",
    body: [
      el("label", { class: "field" }, [el("span", { text: "File" }), file, chosenLabel]),
      el("label", { class: "field" }, [el("span", { text: "Title" }), title]),
      el("label", { class: "field" }, [el("span", { text: "Shelf" }), shelf, shelfList]),
      el("label", { class: "field" }, [el("span", { text: "Note" }), note]),
      progress,
    ],
    onClose: () => controller?.abort(),
    actions: [
      { label: "Cancel", kind: "btn-quiet", onClick: () => controller?.abort() },
      {
        label: "Upload",
        kind: "btn-primary",
        submit: true,
        onClick: async (b) => {
          if (!chosen) return showToast("Choose a file first."), false;
          if (controller) return false; // already sending
          controller = new AbortController();
          b.disabled = true;
          b.textContent = "Uploading…";
          fields.forEach((f) => (f.disabled = true));
          progress.hidden = false;
          const onProgress = (f) => {
            const n = Math.round(f * 100);
            bar.value = n;
            pct.textContent = n >= 100 ? "Saving…" : `${n}%`;
          };
          const r = await A.uploadResource(chosen, { title: title.value, shelf: shelf.value, note: note.value, onProgress, signal: controller.signal });
          controller = null;
          b.disabled = false;
          b.textContent = "Upload";
          fields.forEach((f) => (f.disabled = false));
          if (r.error) {
            progress.hidden = true;
            if (!r.error.cancelled) showToast(r.error.message);
            return false;
          }
          showToast("Saved to your archive.", "success");
        },
      },
    ],
  });
  return sheet;
}

function edit(r) {
  const title = el("input", { type: "text", maxlength: "120", value: r.title });
  const [shelf, shelfList] = shelfInput(r.shelf || "");
  const note = el("textarea", { maxlength: "280" });
  note.value = r.note || "";
  openSheet({
    title: "Rename or re-shelve",
    body: [el("label", { class: "field" }, [el("span", { text: "Title" }), title]), el("label", { class: "field" }, [el("span", { text: "Shelf" }), shelf, shelfList]), el("label", { class: "field" }, [el("span", { text: "Note" }), note])],
    actions: [
      { label: "Cancel", kind: "btn-quiet" },
      {
        label: "Save",
        kind: "btn-primary",
        submit: true,
        onClick: async () => {
          const { error } = await A.updateResource(r, { title: title.value.trim() || r.title, shelf: shelf.value.trim() || null, note: note.value.trim() || null });
          if (error) return showToast("Couldn't save that."), false;
        },
      },
    ],
  });
}

async function remove(r) {
  const ok = await confirmSheet({
    title: `Delete “${r.title}”?`,
    lead: "The file is deleted for good.",
    confirm: "Delete",
    danger: true,
  });
  if (!ok) return;
  const { error } = await A.deleteResource(r);
  showToast(error ? "Couldn't remove it." : "Removed.", error ? "error" : "success");
}

export function mount(section) {
  root = el("div", { class: "archive" });
  headSub = el("p", { class: "s-sub" });
  meterEl = el("span", { class: "arch-meter", role: "meter", "aria-label": "Storage used", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" }, [el("i")]);
  const search = el("input", { type: "search", class: "input arch-search", placeholder: window.matchMedia?.("(pointer: fine)").matches ? "Search titles, files, shelves, notes  ( / )" : "Search titles, files, shelves, notes", "aria-label": "Search the archive", "aria-keyshortcuts": "/" });
  // "/" jumps to the search box, as on most sites.
  const slash = (e) => {
    if (e.key === "/" && document.body.dataset.view === "archive" && !e.target.closest?.("input, textarea, select, [contenteditable]") && !document.querySelector("dialog[open]")) {
      e.preventDefault();
      search.focus();
    }
  };
  document.addEventListener("keydown", slash);
  unsubs.push(() => document.removeEventListener("keydown", slash));
  search.addEventListener("input", () => {
    filter.text = search.value;
    render();
  });
  bodyEl = el("div", { class: "arch-body" });
  root.append(
    el("div", { class: "s-head" }, [
      el("div", {}, [el("p", { class: "kicker toned tone-archive", text: "Archive" }), el("h1", { text: "Catalogued artifacts" }), headSub, meterEl]),
      el("div", { class: "s-actions" }, [el("button", { type: "button", class: "btn btn-primary", text: "Upload", onClick: () => openUpload() })]),
    ]),
    search,
    bodyEl
  );
  section.append(root);

  // Drop a file anywhere on the archive to add it.
  section.addEventListener("dragover", (e) => {
    if ([...(e.dataTransfer?.types || [])].includes("Files")) {
      e.preventDefault();
      root.classList.add("dropping");
    }
  });
  section.addEventListener("dragleave", (e) => {
    if (!section.contains(e.relatedTarget)) root.classList.remove("dropping");
  });
  section.addEventListener("drop", (e) => {
    const f = e.dataTransfer?.files?.[0];
    root.classList.remove("dropping");
    if (!f) return;
    e.preventDefault();
    openUpload(f);
  });

  unsubs.push(on("resources", render));
  render();
}

export async function show(param) {
  const r = await A.loadResources();
  if (r.error) {
    bodyEl.replaceChildren(emptyState("The archive isn't available.", store.schemaMissing ? "This Panalo hasn't been upgraded for Students yet (supabase-phase16.sql)." : "Check your connection and try again."));
    return;
  }
  if (param === "upload") openUpload();
}

export function destroy() {
  unsubs.forEach((u) => u());
  unsubs = [];
  A.clearArchiveCache();
}
