// A small emoji picker for the composer.
//
// Phones have an emoji keyboard, so this is hidden there (chat.css); on a
// computer it's the difference between "🔥" and typing ":fire:" into nothing.
// A curated set rather than all ~3,700: this ships as code on every page load,
// and the everyday ones are what people reach for. Recently used float to the
// front.
import { el } from "./util.js";

const RECENT_KEY = "panalo.recentEmoji";
const RECENT_MAX = 24;

const SETS = [
  ["😀", "Smileys", "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 🤑 🤗 🤭 🤫 🤔 🫡 🤐 🤨 😐 😑 😶 🙄 😏 😬 😮‍💨 😌 😔 😪 😴 😷 🤒 🥵 🥶 🥴 😵‍💫 🤯 🥳 🥸 😎 🤓 🧐 😕 🫤 😟 🙁 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 💀 🤡 👻 👽 🤖 💩 😺 😹 😻 🙈 🙉 🙊"],
  ["👍", "People", "👋 🤚 ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💅 💪 🧠 👀 👁️ 👅 👄 🫦 👶 🧒 👦 👧 🧑 👩 👨 🧓 🙋 🙆 🙅 🤷 🤦 💁 🙇 🧑‍💻 🧑‍🎓 🧑‍🎤 🧑‍🍳 🕺 💃 🏃 🚶 🧘"],
  ["❤️", "Hearts", "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 🩷 🩵 💔 ❤️‍🔥 💕 💞 💓 💗 💖 💘 💝 💟 ✨ ⭐ 🌟 💫 🔥 💥 💯 ✅ ❌ ❗ ❓ ‼️ ⁉️ 💤 💬 💭 🗯️ ♻️ 🆗 🆒 🆕 🔝 🎵 🎶 ➕ ➖ ✖️ 🟢 🟡 🔴 🔵 🟣"],
  ["🐶", "Nature", "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦉 🦄 🐝 🦋 🐌 🐞 🐢 🐍 🐙 🦈 🐬 🐳 🦖 🌵 🌲 🌴 🌱 🍀 🍁 🍂 🌷 🌹 🌻 🌸 🌼 🌈 ☀️ 🌤️ ⛅ 🌧️ ⛈️ ❄️ ☃️ 🌊 🌙 🌍 🌋"],
  ["🍕", "Food", "🍎 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🥑 🍅 🌶️ 🌽 🥕 🥐 🍞 🧀 🥚 🍳 🥞 🧇 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🥗 🍝 🍜 🍣 🍱 🥟 🍦 🍩 🍪 🎂 🍰 🧁 🍫 🍬 🍭 🍿 🧋 ☕ 🍵 🥤 🧃 🍺 🥂"],
  ["⚽", "Activity", "⚽ 🏀 🏈 ⚾ 🎾 🏐 🏓 🏸 🥊 🛹 🏊 🚴 🏆 🥇 🎮 🕹️ 🎲 🧩 🎯 🎳 🎸 🎹 🥁 🎤 🎧 🎬 🎨 📷 📚 📖 ✏️ 📝 📐 🧪 🔬 🔭 💻 📱 ⌚ 💡 🔑 🎁 🎈 🎉 🎊 🎓 🏫 🚗 🚌 ✈️ 🚀 🏠 🗺️ ⏰ 📌 📎"],
];

function readRecent() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY));
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}
function remember(emoji) {
  const list = [emoji, ...readRecent().filter((e) => e !== emoji)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* quota — recents are a nicety */
  }
}

export function initEmojiPicker({ panel, button, onPick }) {
  if (!panel || !button) return;
  let active = null;

  const tabs = el("div", { class: "emoji-tabs", role: "tablist", "aria-label": "Emoji categories" });
  const grid = el("div", { class: "emoji-grid", role: "group" });
  panel.append(tabs, grid);

  function categories() {
    const recent = readRecent();
    return recent.length ? [["🕘", "Recent", recent.join(" ")], ...SETS] : SETS;
  }

  function draw() {
    const cats = categories();
    if (!cats.some(([, name]) => name === active)) active = cats[0][1];
    tabs.replaceChildren(
      ...cats.map(([face, name]) =>
        el("button", {
          class: "emoji-tab",
          type: "button",
          role: "tab",
          title: name,
          "aria-label": name,
          "aria-selected": String(name === active),
          text: face,
          onClick: () => {
            active = name;
            draw();
          },
        })
      )
    );
    const list = cats.find(([, name]) => name === active)[2].split(" ").filter(Boolean);
    grid.setAttribute("aria-label", active);
    grid.replaceChildren(
      ...list.map((emoji) =>
        el("button", {
          class: "emoji-cell",
          type: "button",
          text: emoji,
          "aria-label": emoji,
          onClick: () => {
            remember(emoji);
            onPick(emoji);
          },
        })
      )
    );
  }

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = panel.classList.contains("hidden");
    // One panel above the composer at a time.
    document.getElementById("sticker-panel")?.classList.add("hidden");
    if (opening) draw();
    panel.classList.toggle("hidden", !opening);
  });
  panel.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => panel.classList.add("hidden"));
}
