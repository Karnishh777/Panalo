// Settings: motion, the Study Room, your interests, your password.
import { el, showToast, getPrefs, setPrefs, reportError } from "../ui.js";
import { withBusy } from "../../../src/util.js";
import { store, api } from "../store.js";
import { INTERESTS } from "../model/drift-library.js";
import { supabaseClient } from "../../../src/client.js";
import { rewrapPrivateKey } from "../../../src/encryption.js";
import { validatePassword, describePasswordPolicy } from "../../../src/password.js";
import { state } from "../../../src/state.js";

let root;
let ctx;

function toggle(label, hint, checked, onChange) {
  const box = el("input", { type: "checkbox", role: "switch" });
  box.checked = checked;
  box.addEventListener("change", () => onChange(box.checked, box));
  return el("label", { class: "setting" }, [el("span", {}, [el("b", { text: label }), el("small", { text: hint })]), box]);
}

function interestsBlock() {
  const chosen = new Set(store.student?.interests || []);
  const wrap = el("div", { class: "chips" });
  const draw = () =>
    wrap.replaceChildren(
      ...INTERESTS.map((it) =>
        el("button", {
          type: "button",
          class: "chip tone-drift",
          "aria-pressed": String(chosen.has(it.id)),
          text: it.label,
          onClick: async () => {
            if (chosen.has(it.id)) chosen.delete(it.id);
            else if (chosen.size < 5) chosen.add(it.id);
            else return showToast("Up to five.", "");
            draw();
            const { error } = await api.saveStudent({ interests: [...chosen] });
            if (error) reportError(error);
          },
        })
      )
    );
  draw();
  return wrap;
}

function passwordBlock() {
  const next = el("input", { type: "password", autocomplete: "new-password" });
  const again = el("input", { type: "password", autocomplete: "new-password" });
  const btn = el("button", { type: "submit", class: "btn btn-ghost btn-sm", text: "Change password" });
  const form = el("form", { class: "pw-form", novalidate: "" }, [
    el("label", { class: "field" }, [el("span", { text: "New password" }), next, el("small", { class: "field-hint", text: `${describePasswordPolicy()} Your encryption key moves to the new password automatically — stay online until it's done.` })]),
    el("label", { class: "field" }, [el("span", { text: "Again" }), again]),
    btn,
  ]);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    withBusy(btn, "Changing…", async () => {
      const weak = validatePassword(next.value);
      if (weak) return showToast(weak);
      if (next.value !== again.value) return showToast("The passwords don't match.");
      const { error } = await supabaseClient.auth.updateUser({ password: next.value });
      if (error) return showToast(error.message);
      // The private key is protected by the password; without this, a new
      // device could never open your messages again.
      const r = await rewrapPrivateKey(next.value);
      showToast(r === "ready" || r === "no-key" ? "Password changed." : "Password changed, but your key didn't move. Try again before signing out.", r === "failed" ? "error" : "success");
      next.value = again.value = "";
    });
  });
  return form;
}

export function mount(section, c) {
  ctx = c;
  root = el("div", { class: "settings-page" });
  section.append(root);
}

export function show() {
  const p = getPrefs();
  const notifySupported = "Notification" in window;
  root.replaceChildren(
    el("div", { class: "s-head" }, [el("div", {}, [el("p", { class: "kicker toned tone-focus", text: "Settings" }), el("h1", { text: "How Panalo behaves for you" }), el("p", { class: "s-sub", text: `Signed in as @${state.currentUsername}${state.currentUser?.email ? ` · ${state.currentUser.email}` : ""}. Settings on this page are saved on this device unless they say otherwise.` })])]),
    el("div", { class: "settings-cols" }, [
      el("section", { class: "panel tone-focus" }, [
        el("div", { class: "panel-head" }, [el("h2", { text: "Motion and sound" })]),
        toggle("Reduce motion", "Stills the stars, the worlds and the transitions. Your device's own setting is always respected too.", !!p.reduceMotion, (on) => {
          setPrefs({ reduceMotion: on });
          if (on) document.documentElement.setAttribute("data-motion", "reduce");
          else document.documentElement.removeAttribute("data-motion");
          showToast(on ? "Motion reduced. Reload to still everything." : "Motion back on.", "success");
        }),
        notifySupported
          ? toggle("Tell me when a focus block ends", "A quiet system notification if the Study Room is in the background.", !!p.studyNotify && Notification.permission === "granted", async (on, box) => {
              if (on && Notification.permission !== "granted") {
                const r = await Notification.requestPermission();
                if (r !== "granted") {
                  box.checked = false;
                  return showToast("Notifications are blocked for this site in your browser settings.");
                }
              }
              setPrefs({ studyNotify: on });
            })
          : null,
        el("button", { type: "button", class: "btn btn-quiet btn-sm", text: "Watch your universe begin again", onClick: () => ctx.replayBirth() }),
      ]),
      el("section", { class: "panel tone-drift" }, [el("div", { class: "panel-head" }, [el("h2", { text: "What pulls you in" })]), el("p", { class: "muted", text: "Drift picks its facts and prompts from these. Saved to your account." }), interestsBlock()]),
      el("section", { class: "panel tone-signal" }, [el("div", { class: "panel-head" }, [el("h2", { text: "Password" })]), passwordBlock()]),
      el("section", { class: "panel tone-time" }, [
        el("div", { class: "panel-head" }, [el("h2", { text: "Session" })]),
        el("p", { class: "muted", text: "Signing out locks your messages on this device and clears decrypted files from memory." }),
        el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "Sign out", onClick: () => ctx.signOut() }),
      ]),
    ])
  );
}
