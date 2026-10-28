// Your journey (phase 36): everything done in Panalo Students -- the study
// profile, progress, results, sessions, the journal, and so the world --
// downloaded as one file, started again from nothing, or brought back from
// a download. A download is sealed to its account by the database
// (journey_export), so it can only be brought back into the same account,
// and only as it was downloaded.
import { el, openSheet, showToast, reportError } from "./ui.js";
import { supabaseClient } from "../../src/client.js";
import { state } from "../../src/state.js";

const FILE_KIND = "panalo-journey";

function save(name, text) {
  const blob = new Blob([text], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** The sealed journey, as the database gives it: { account, journey, seal }. */
export async function sealedJourney() {
  const { data, error } = await supabaseClient.rpc("journey_export");
  if (error) throw error;
  return data;
}

/** Download the journey as a file. Returns true once it's saved. */
export async function downloadJourney() {
  try {
    const sealed = await sealedJourney();
    const file = { kind: FILE_KIND, version: 1, username: state.currentUsername || null, made_at: new Date().toISOString(), ...sealed };
    save(`panalo-journey-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(file));
    showToast("Your journey is downloading. Keep the file: it can be brought back into this account.", "success");
    return true;
  } catch (e) {
    reportError(e, "Couldn't gather your journey. Try again.");
    return false;
  }
}

/** A file's journey and seal, or a reason it isn't one (pure; tested). */
export function readJourneyFile(text, me) {
  let f;
  try {
    f = JSON.parse(text);
  } catch {
    return { error: "That file isn't a Panalo journey." };
  }
  // A journey file, or the full "Download my data" file (it carries one).
  const journey = f?.journey;
  const seal = f?.seal;
  if (typeof journey !== "string" || typeof seal !== "string") return { error: f?.kind === FILE_KIND ? "That journey file is damaged." : "That file isn't a Panalo journey. Use one downloaded from Settings → Your journey." };
  const owner = typeof f.account === "string" ? f.account : f.account?.id;
  if (owner && me && owner !== me) return { error: "That journey belongs to another account. A journey can only come back into the account it was downloaded from." };
  let made = null;
  try {
    made = JSON.parse(journey).made_at || null;
  } catch {
    return { error: "That journey file is damaged." };
  }
  return { journey, seal, made };
}

const when = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "an earlier date");

/** Start again from nothing, after a last chance to download. */
export function openReset() {
  const typed = el("input", { type: "text", class: "input", id: "journey-reset-word", autocomplete: "off", placeholder: "start again", "aria-label": "Type start again" });
  openSheet({
    title: "Start again from nothing",
    lead: "Your plan, progress, results, sessions, tasks, calendar, goals and journal are removed, and your world starts again as a small island. Your account and how Panalo looks stay. You'll answer the setup again.",
    form: false,
    body: [
      el("p", { class: "small" }, [el("b", { text: "Download your journey first" }), " if you might want it back: it can be brought back into this account any time."]),
      el("button", { type: "button", class: "btn btn-ghost btn-sm", id: "journey-reset-download", text: "Download my journey", onClick: (e) => withBusy(e.currentTarget, downloadJourney) }),
      el("label", { class: "field" }, [el("span", { text: "Type “start again” to confirm" }), typed]),
    ],
    actions: [
      { label: "Cancel", kind: "btn-quiet" },
      {
        label: "Start again",
        kind: "btn-danger",
        id: "journey-reset-go",
        onClick: async (btn) => {
          if (typed.value.trim().toLowerCase() !== "start again") return showToast("Type “start again” to confirm."), typed.focus(), false;
          btn.disabled = true;
          const { error } = await supabaseClient.rpc("journey_reset");
          btn.disabled = false;
          if (error) return reportError(error, "Couldn't start again. Nothing was changed."), false;
          showToast("A fresh start. Let's set up your plan.", "success");
          setTimeout(() => ((location.hash = "#/plan"), location.reload()), 600);
        },
      },
    ],
  });
}

/** Bring a downloaded journey back into this account. */
export function openImport() {
  const input = el("input", { type: "file", accept: "application/json,.json", id: "journey-file", class: "input" });
  const status = el("p", { class: "small", "aria-live": "polite" });
  let picked = null;
  input.addEventListener("change", async () => {
    picked = null;
    const file = input.files?.[0];
    if (!file) return (status.textContent = "");
    if (file.size > 25_000_000) return (status.textContent = "That file is too big to be a Panalo journey.");
    const out = readJourneyFile(await file.text(), state.currentUser?.id);
    if (out.error) return (status.textContent = out.error);
    picked = out;
    status.textContent = `A journey from ${when(out.made)}. Bringing it back replaces what's here now.`;
  });
  openSheet({
    title: "Bring back a journey",
    lead: "Choose a journey you downloaded from this account. It replaces the journey here now: download that first if you want to keep it.",
    form: false,
    body: [input, status, el("button", { type: "button", class: "link-btn", text: "Download the journey here now first", onClick: (e) => withBusy(e.currentTarget, downloadJourney) })],
    actions: [
      { label: "Cancel", kind: "btn-quiet" },
      {
        label: "Bring it back",
        kind: "btn-primary",
        id: "journey-import-go",
        onClick: async (btn) => {
          if (!picked) return showToast(status.textContent || "Choose a journey file first."), false;
          btn.disabled = true;
          const { data, error } = await supabaseClient.rpc("journey_import", { journey: picked.journey, seal: picked.seal });
          btn.disabled = false;
          if (error) return (status.textContent = /another account|changed/.test(error.message) ? error.message : "Couldn't bring it back. Nothing was changed."), false;
          showToast(`Your journey from ${when(data?.made_at)} is back.`, "success");
          setTimeout(() => location.reload(), 600);
        },
      },
    ],
  });
}

async function withBusy(btn, fn) {
  btn.disabled = true;
  try {
    await fn();
  } finally {
    btn.disabled = false;
  }
}

/** The Settings panel. */
export function journeyPanel() {
  return el("section", { class: "panel tone-world", id: "journey-panel" }, [
    el("div", { class: "panel-head" }, [el("h2", { text: "Your journey" })]),
    el("p", { class: "muted", text: "Everything you've done here, as one file you can keep; a fresh start; or a downloaded journey brought back. A journey can only come back into the account it was downloaded from." }),
    el("div", { class: "journey-acts" }, [
      el("button", { type: "button", class: "btn btn-ghost btn-sm", id: "journey-download", text: "Download my journey", onClick: (e) => withBusy(e.currentTarget, downloadJourney) }),
      el("button", { type: "button", class: "btn btn-ghost btn-sm", id: "journey-import", text: "Bring back a journey", onClick: openImport }),
      el("button", { type: "button", class: "btn btn-quiet btn-sm", id: "journey-reset", text: "Start again from nothing", onClick: openReset }),
    ]),
  ]);
}
