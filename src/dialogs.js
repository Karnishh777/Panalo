// A proper dialog for typing a secret: a new PIN, or your password to prove
// it's you.
//
// This replaces window.prompt(), which showed PINs and passwords in plain
// text, couldn't be styled, couldn't say what went wrong, and on some mobile
// browsers is suppressed entirely -- making "set a chat-lock PIN" silently
// do nothing.
//
// Resolves with the entered value, or null if cancelled.
const $ = (id) => document.getElementById(id);

export function promptSecret({
  title,
  subtitle = "",
  placeholder = "",
  confirmPlaceholder = null,
  numeric = false,
  autocomplete = "off",
  submitLabel = "Save",
  validate = null,
} = {}) {
  return new Promise((resolve) => {
    const modal = $("prompt-modal");
    const form = $("prompt-form");
    const input = $("prompt-input");
    const confirm = $("prompt-input-2");
    const error = $("prompt-error");
    const cancel = $("prompt-cancel");
    const submit = $("prompt-submit");

    $("prompt-title").textContent = title;
    $("prompt-subtitle").textContent = subtitle;
    submit.textContent = submitLabel;
    for (const field of [input, confirm]) {
      field.value = "";
      field.inputMode = numeric ? "numeric" : "text";
      field.autocomplete = autocomplete;
      field.removeAttribute("aria-invalid");
      if (numeric) field.setAttribute("maxlength", "8");
      else field.removeAttribute("maxlength");
    }
    input.placeholder = placeholder;
    input.setAttribute("aria-label", placeholder || title);
    confirm.placeholder = confirmPlaceholder || "";
    confirm.setAttribute("aria-label", confirmPlaceholder || "Repeat");
    confirm.classList.toggle("hidden", !confirmPlaceholder);
    error.classList.add("hidden");
    error.textContent = "";

    modal.classList.remove("hidden");
    setTimeout(() => input.focus(), 30);

    const fail = (message) => {
      error.textContent = message;
      error.classList.remove("hidden");
      input.setAttribute("aria-invalid", "true");
      input.classList.remove("shake");
      void input.offsetWidth;
      input.classList.add("shake");
      input.focus();
    };

    const onSubmit = (e) => {
      e.preventDefault();
      const value = input.value;
      if (!value) return fail("This can't be empty.");
      if (confirmPlaceholder && value !== confirm.value) return fail("Those don't match.");
      const problem = validate?.(value);
      if (problem) return fail(problem);
      done(value);
    };
    const onCancel = () => done(null);

    function done(value) {
      form.removeEventListener("submit", onSubmit);
      cancel.removeEventListener("click", onCancel);
      input.value = "";
      confirm.value = "";
      modal.classList.add("hidden");
      resolve(value);
    }

    form.addEventListener("submit", onSubmit);
    cancel.addEventListener("click", onCancel);
  });
}

// PIN rule, shared by every place that sets one. Must match lock.js setPin().
export function pinProblem(pin) {
  return /^\d{4,8}$/.test(pin) ? null : "Use 4 to 8 digits.";
}
