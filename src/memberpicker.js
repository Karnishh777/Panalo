// Choosing people for a new group, one name at a time.
//
// The group modal used to take "Member Usernames (comma separated)" in one
// text box and resolve them only when you pressed Create -- so a typo
// surfaced as a "Not found: ..." toast after the group already existed
// without that person. Each name is now looked up the moment it is entered
// and shown as a chip, so you see exactly who you are adding before anything
// is created. Pasting a comma- or space-separated list still works.
import { findProfileByUsername } from "./client.js";
import { el, setAvatar, cleanUsername } from "./util.js";
import { icon } from "./icons.js";
import { state } from "./state.js";

const DEFAULT_HINT = "Type a username and press Enter. You can add more after.";

/**
 * @param {{ root: HTMLElement, input: HTMLInputElement, hint: HTMLElement }} parts
 * @returns {{ finish: () => Promise<Array<{id: string, username: string, public_key: string}> | null>, reset: () => void }}
 */
export function createMemberPicker({ root, input, hint }) {
  const chipsEl = root.querySelector(".member-chips");
  let chosen = [];

  function setHint(text, isError = false) {
    hint.textContent = text;
    hint.classList.toggle("error", isError);
  }

  function remove(id) {
    chosen = chosen.filter((p) => p.id !== id);
    render();
    input.focus();
  }

  function render() {
    chipsEl.replaceChildren(
      ...chosen.map((p) => {
        const avatar = el("span", { class: "avatar member-chip-avatar", "aria-hidden": "true" });
        setAvatar(avatar, p.username, null);
        return el("span", { class: "member-chip" }, [
          avatar,
          el("span", { class: "member-chip-name", text: p.username }),
          el("button", {
            type: "button",
            class: "member-chip-remove",
            "aria-label": `Remove ${p.username}`,
            onClick: () => remove(p.id),
          }, [icon("close", 12)]),
        ]);
      })
    );
    input.placeholder = chosen.length ? "Add another" : "Add people by username";
  }

  // Resolve one typed name into a chip. Returns false if it could not be
  // added, so finish() knows not to create the group without them.
  async function add(raw) {
    const name = cleanUsername(raw);
    if (!name) return true;
    if (name.toLowerCase() === String(state.currentUsername || "").toLowerCase()) {
      setHint("That's you. You're in every group you create.", true);
      return false;
    }
    if (chosen.some((p) => p.username.toLowerCase() === name.toLowerCase())) return true;

    setHint(`Looking up ${name}…`);
    let found;
    try {
      found = await findProfileByUsername(name);
    } catch {
      setHint("Couldn't look that up. Check your connection and try again.", true);
      return false;
    }
    if (!found) {
      setHint(`No one is called "${name}". Check the spelling.`, true);
      return false;
    }
    if (!chosen.some((p) => p.id === found.id)) chosen = [...chosen, found];
    setHint(DEFAULT_HINT);
    render();
    return true;
  }

  async function commitTyped() {
    const typed = input.value.replace(/,+$/, "");
    if (!cleanUsername(typed)) {
      input.value = "";
      return true;
    }
    const ok = await add(typed);
    if (ok) input.value = "";
    return ok;
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitTyped();
    } else if (e.key === "Backspace" && !input.value && chosen.length) {
      chosen = chosen.slice(0, -1);
      render();
    }
  });

  // A pasted list ("ada, sam @kiran") becomes one chip per name.
  input.addEventListener("paste", async (e) => {
    const text = e.clipboardData?.getData("text") || "";
    if (!/[\s,]/.test(text.trim())) return; // a single name pastes normally
    e.preventDefault();
    const failed = [];
    for (const n of text.split(/[\s,]+/).filter(Boolean)) {
      if (!(await add(n))) failed.push(n);
    }
    input.value = failed.join(", ");
  });

  input.addEventListener("input", () => {
    if (hint.classList.contains("error")) setHint(DEFAULT_HINT);
  });

  // Clicking the empty part of the box puts the cursor in it.
  root.addEventListener("click", (e) => {
    if (e.target === root || e.target === chipsEl) input.focus();
  });

  return {
    // Anything still typed in the box counts: resolve it before creating, and
    // return null (create nothing) if it can't be resolved.
    async finish() {
      const ok = await commitTyped();
      return ok ? chosen.slice() : null;
    },
    reset() {
      chosen = [];
      input.value = "";
      setHint(DEFAULT_HINT);
      render();
    },
  };
}
