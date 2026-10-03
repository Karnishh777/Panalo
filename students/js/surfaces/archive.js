// Archive: your files as catalogued artifacts.
//
// Not a thumbnail grid. Each file is a specimen with a label that answers
// the questions you actually have: what is it, what type, how big, who put
// it here, when, who can see it, and can I preview it. Files are laid down
// in strata -- one layer per month -- so "that PDF from last term" is
// somewhere you can point at.
import { el, openSheet, confirmSheet, popMenu, showToast, emptyState, chipGroup } from "../ui.js";
import { store, on } from "../store.js";
import { state } from "../../../src/state.js";
import { fileKind, prettyBytes, extensionOf } from "../../../src/filekind.js";
import { glyph, KIND_LABEL } from "../glyphs.js";
import * as A from "../archive-data.js";
import { titleOf } from "../signals-data.js";

let root;
let bodyEl;
let headSub;
let filter = { text: "", scope: "all", shelf: null };
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

function scopeLabel(r) {
  if (!r.conversation_id) return r.owner_id === state.currentUser.id ? "Private · only you" : "Private";
  const conv = store.conversations.find((c) => c.id === r.conversation_id);
  return conv ? `Shared · ${titleOf(conv)}` : "Shared with a conversation";
}

function artifact(r) {
  const k = kindOf(r);
  const mine = r.owner_id === state.currentUser.id;
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
        `Added by ${mine ? "you" : `@${store.owners[r.owner_id] || "someone"}`} · `,
        el("time", { datetime: r.created_at, text: when.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) }),
        " · ",
        el("span", { class: r.conversation_id ? "scope shared" : "scope", text: scopeLabel(r) }),
        r.shelf ? el("span", { class: "shelf", text: ` · on “${r.shelf}”` }) : null,
      ]),
      r.note ? el("span", { class: "artifact-note", text: r.note }) : null,
    ]),
    el("div", { class: "artifact-actions" }, [
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
            mine ? { label: "Rename or re-shelve", onClick: () => edit(r) } : null,
            mine || isHostOf(r) ? { label: mine ? "Delete" : "Remove from circle", danger: true, onClick: () => remove(r) } : null,
            !mine ? { label: "Report", onClick: () => import("./signals.js").then((m) => m.openReport({ userId: r.owner_id, username: store.owners[r.owner_id], conversationId: r.conversation_id, evidence: `Archive file: ${r.title} (${r.file_name})` })) } : null,
          ]),
      }),
    ]),
  ]);
}

function isHostOf(r) {
  const conv = r.conversation_id && store.conversations.find((c) => c.id === r.conversation_id);
  return !!conv?.isHost;
}

function render() {
  if (!bodyEl) return;
  const all = store.resources;
  if (all === null) {
    bodyEl.replaceChildren(el("div", { class: "loading-line" }));
    return;
  }
  const used = A.usedBytes();
  headSub.textContent = `Private unless you share a file with a conversation. You're using ${bytes(used)} of ${bytes(A.ARCHIVE_QUOTA)}.`;
  const q = filter.text.trim().toLowerCase();
  const me = state.currentUser.id;
  const shelves = [...new Set(all.map((r) => r.shelf).filter(Boolean))].sort();
  const items = all.filter(
    (r) =>
      (filter.scope === "all" || (filter.scope === "mine" ? !r.conversation_id && r.owner_id === me : !!r.conversation_id)) &&
      (!filter.shelf || r.shelf === filter.shelf) &&
      (!q || `${r.title} ${r.file_name} ${r.shelf || ""} ${r.note || ""}`.toLowerCase().includes(q))
  );

  const toolbar = el("div", { class: "arch-tools" }, [
    chipGroup({
      label: "Show",
      value: filter.scope,
      options: [
        { id: "all", label: "Everything" },
        { id: "mine", label: "Private" },
        { id: "shared", label: "From conversations" },
      ],
      toneOf: () => "tone-archive",
      onChange: (v) => {
        filter.scope = v;
        render();
      },
    }).node,
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
              el("p", { text: "Notes, past papers, slides, recordings, sketches. Drop a file anywhere on this page, or upload one. Everything is private until you share it with a circle." }),
              el("button", { type: "button", class: "btn btn-primary", text: "Upload your first file", onClick: () => openUpload() }),
            ]),
          ])
    );
    return;
  }

  // Strata: one layer per month, newest on top.
  const layers = new Map();
  for (const r of items) {
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
  bodyEl.replaceChildren(toolbar, ...strata);
}

async function preview(r) {
  const kind = previewKind(r);
  const slot = el("div", { class: "preview-slot" }, [el("div", { class: "loading-line" })]);
  const sheet = openSheet({
    title: r.title,
    lead: `${r.file_name} · ${prettyBytes(Number(r.size_bytes))} · ${scopeLabel(r)}`,
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
  const scope = el("select", {}, [
    el("option", { value: "", text: "Private — only me" }),
    ...store.conversations.map((c) => el("option", { value: c.id, text: `Share with: ${titleOf(c)}` })),
  ]);
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
  const fields = [file, title, shelf, scope, note];
  const sheet = openSheet({
    title: "Add to the archive",
    lead: "Up to 50 MB per file. Shared files can be opened by everyone in that conversation; nobody else. Archive files are protected by access rules on the server, not end-to-end encrypted like messages.",
    body: [
      el("label", { class: "field" }, [el("span", { text: "File" }), file, chosenLabel]),
      el("label", { class: "field" }, [el("span", { text: "Title" }), title]),
      el("label", { class: "field" }, [el("span", { text: "Shelf" }), shelf, shelfList]),
      el("label", { class: "field" }, [el("span", { text: "Who can see it" }), scope]),
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
          const r = await A.uploadResource(chosen, { title: title.value, shelf: shelf.value, conversationId: scope.value || null, note: note.value, onProgress, signal: controller.signal });
          controller = null;
          b.disabled = false;
          b.textContent = "Upload";
          fields.forEach((f) => (f.disabled = false));
          if (r.error) {
            progress.hidden = true;
            if (!r.error.cancelled) showToast(r.error.message);
            return false;
          }
          showToast(scope.value ? "Shared." : "Saved to your archive.", "success");
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
  const mine = r.owner_id === state.currentUser.id;
  const ok = await confirmSheet({
    title: mine ? `Delete “${r.title}”?` : `Remove “${r.title}” from the circle?`,
    lead: mine ? "The file is deleted for you and for anyone you shared it with." : "As a host you can take a file down from this circle.",
    confirm: mine ? "Delete" : "Remove",
    danger: true,
  });
  if (!ok) return;
  const { error } = await A.deleteResource(r);
  showToast(error ? "Couldn't remove it." : "Removed.", error ? "error" : "success");
}

export function mount(section) {
  root = el("div", { class: "archive" });
  headSub = el("p", { class: "s-sub" });
  const search = el("input", { type: "search", class: "input arch-search", placeholder: "Search titles, files, shelves, notes", "aria-label": "Search the archive" });
  search.addEventListener("input", () => {
    filter.text = search.value;
    render();
  });
  bodyEl = el("div", { class: "arch-body" });
  root.append(
    el("div", { class: "s-head" }, [
      el("div", {}, [el("p", { class: "kicker toned tone-archive", text: "Archive" }), el("h1", { text: "Catalogued artifacts" }), headSub]),
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

  unsubs.push(on("resources", render), on("signals", render));
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
