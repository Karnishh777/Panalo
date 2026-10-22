// Friends on the globe, on the World page: the cities your friends chose to
// show you, as lights on your globe and as a list; and your own city --
// off until you choose it, a city you pick by hand (never your device's
// location), shown only to the people you pick, for as long as you pick.
import { el, openSheet, confirmSheet, showToast, chipGroup, reportError } from "./ui.js";
import { beaconLayer } from "./beacons.js";
import { loadPlaces, loadCities, directFriends, savePlace, turnOffPlace } from "./places.js";
import { searchCities, SHARE_FOR, untilText, shareChoiceOf, placeLabel } from "./model/places.js";
import { distanceKm } from "./globe-math.js";

const km = (n) => (n < 10 ? "nearby" : `${Math.round(n).toLocaleString()} km away`);

export function friendsOnGlobe({ globe, canvas }) {
  const listEl = el("ul", { class: "fg-list" });
  const meEl = el("div", { class: "fg-me" });
  const panel = el("section", { class: "panel tone-signal fg", id: "friends-globe", "aria-labelledby": "fg-h", hidden: "" }, [
    el("div", { class: "panel-head" }, [el("h2", { id: "fg-h", text: "Friends on your globe" })]),
    meEl,
    listEl,
  ]);
  let data = { mine: null, viewers: [], friends: [], available: false };
  let destroyed = false;
  const layer = globe && canvas && globe.project ? beaconLayer(globe, canvas, { onPick: find }) : null;

  function find(id) {
    const p = id === "me" ? data.mine : data.friends.find((f) => f.id === id);
    if (!p) return;
    globe?.faceTo?.(p.lat, p.lon);
    layer?.focus(id);
    listEl.querySelectorAll(".fg-item").forEach((li) => li.classList.toggle("on", li.dataset.id === id));
  }

  function render() {
    panel.hidden = !data.available;
    if (!data.available) return;
    const { mine, viewers, friends } = data;
    const names = new Map(directFriends().map((f) => [f.id, f.name]));
    if (mine) {
      const who = viewers.map((id) => names.get(id)).filter(Boolean);
      meEl.replaceChildren(
        el("div", { class: "fg-me-row" }, [
          el("span", { class: "fg-pin self", "aria-hidden": "true" }),
          el("div", {}, [
            el("b", { text: placeLabel(mine) }),
            el("small", { class: "faint", text: who.length ? `Shown to ${who.join(", ")}, ${untilText(mine.expires_at)}.` : "Shown to nobody yet — choose who can see it." }),
          ]),
        ]),
        el("div", { class: "fg-me-actions" }, [
          el("button", { type: "button", class: "btn btn-ghost btn-sm", id: "fg-edit", text: "Change", onClick: () => openShare() }),
          el("button", { type: "button", class: "btn btn-quiet btn-sm", id: "fg-off", text: "Turn off", onClick: turnOff }),
        ])
      );
    } else {
      meEl.replaceChildren(
        el("p", { class: "fg-lead", text: "Show your city to friends you choose — a city you pick, never your exact location. Off until you turn it on." }),
        el("button", { type: "button", class: "btn btn-ghost btn-sm", id: "fg-share", text: "Show my city", onClick: () => openShare() })
      );
    }
    listEl.replaceChildren(
      ...(friends.length
        ? friends.map((f) =>
            el("li", { class: "fg-item", "data-id": f.id }, [
              el("span", { class: "fg-pin", "aria-hidden": "true" }),
              el("div", { class: "fg-who" }, [
                el("b", { text: f.name }),
                el("small", { class: "faint", text: [placeLabel(f), mine ? km(distanceKm(mine, f)) : null, f.expires_at ? untilText(f.expires_at).replace("for ", "") : null].filter(Boolean).join(" · ") }),
              ]),
              el("button", { type: "button", class: "link-btn fg-find", text: "Find", "aria-label": `Find ${f.name} on your globe`, onClick: () => find(f.id) }),
            ])
          )
        : [el("li", { class: "fg-empty faint", text: "When friends show you their city, it lights up here and on your globe." })])
    );
    layer?.set([
      ...(mine ? [{ id: "me", lat: mine.lat, lon: mine.lon, name: "You", where: mine.city, self: true }] : []),
      ...friends.map((f) => ({ id: f.id, lat: f.lat, lon: f.lon, name: f.name, where: f.city })),
    ]);
  }

  async function refresh() {
    try {
      data = await loadPlaces();
    } catch (e) {
      console.error(e);
      data = { ...data, available: false };
    }
    if (!destroyed) render();
  }

  async function turnOff() {
    const ok = await confirmSheet({ title: "Turn off your city?", lead: "It disappears from every friend's globe now, and the list of who could see it is cleared.", confirm: "Turn off" });
    if (!ok) return;
    try {
      await turnOffPlace();
      showToast("Your city is off. Nobody can see it.", "success");
      await refresh();
    } catch (e) {
      reportError(e);
    }
  }

  function openShare() {
    const mine = data.mine;
    let picked = mine ? { city: mine.city, region: mine.region, country: mine.country, lat: mine.lat, lon: mine.lon } : null;
    const friends = directFriends();
    const chosen = new Set(mine ? data.viewers : []);

    const search = el("input", { type: "search", id: "fg-city", class: "input", placeholder: "Type your city — e.g. Chennai", autocomplete: "off", "aria-label": "Your city", "aria-controls": "fg-results" });
    const results = el("ul", { class: "fg-results", id: "fg-results", role: "listbox", "aria-label": "Cities" });
    const pickedEl = el("p", { class: "fg-picked", "aria-live": "polite" });
    const showPicked = () => {
      pickedEl.replaceChildren(picked ? el("span", {}, [el("span", { class: "fg-pin self", "aria-hidden": "true" }), el("b", { text: placeLabel(picked) })]) : el("span", { class: "faint", text: "No city chosen yet." }));
    };
    showPicked();
    let rows = null;
    let seq = 0;
    const runSearch = async () => {
      const n = ++seq;
      const q = search.value;
      if (!q.trim()) return results.replaceChildren();
      try {
        rows ||= await loadCities();
      } catch (e) {
        return results.replaceChildren(el("li", { class: "faint", text: e.message }));
      }
      if (n !== seq) return;
      const found = searchCities(rows, q, 7);
      results.replaceChildren(
        ...(found.length
          ? found.map((c) =>
              el("li", { role: "option", "aria-selected": "false" }, [
                el("button", {
                  type: "button",
                  class: "fg-city",
                  onClick: () => {
                    picked = c;
                    search.value = "";
                    results.replaceChildren();
                    showPicked();
                  },
                }, [el("b", { text: c.city }), el("small", { class: "faint", text: [c.region, c.country].filter(Boolean).filter((x) => x !== c.city).join(", ") })]),
              ])
            )
          : [el("li", { class: "faint", text: "No city by that name. Try the nearest bigger city." })])
      );
    };
    search.addEventListener("input", runSearch);

    const people = friends.length
      ? el("ul", { class: "fg-people", "aria-label": "Who can see it" }, friends.map((f) =>
          el("li", {}, [
            el("label", { class: "check" }, [
              el("input", { type: "checkbox", value: f.id, checked: chosen.has(f.id) ? "" : null, onChange: (e) => (e.target.checked ? chosen.add(f.id) : chosen.delete(f.id)) }),
              el("span", { text: f.name }),
            ]),
          ])
        ))
      : el("p", { class: "faint", text: "Start a one-to-one chat in Signals first — only people you talk to directly can be chosen." });

    const howLong = chipGroup({ label: "For how long", options: SHARE_FOR, value: mine ? shareChoiceOf(mine.expires_at) : "off" });

    openSheet({
      title: mine ? "Your city" : "Show my city",
      lead: "Friends you choose see your city as a light on their globe. Just the city — never where you are in it.",
      body: [
        el("div", { class: "field" }, [el("span", { text: "City" }), search, results, pickedEl]),
        el("div", { class: "field" }, [el("span", { text: "Who can see it" }), people]),
        el("div", { class: "field" }, [el("span", { text: "For how long" }), howLong.node]),
        el("small", { class: "field-hint", text: "You can change this or turn it off any time. When it ends, it's erased." }),
      ],
      actions: [
        { label: "Cancel", kind: "btn-quiet" },
        {
          label: mine ? "Save" : "Show my city",
          kind: "btn-primary",
          id: "fg-save",
          submit: true,
          onClick: async () => {
            const missing = !picked ? "Choose your city first." : !chosen.size ? "Choose at least one person who can see it." : null;
            if (missing) {
              showToast(missing);
              return false;
            }
            try {
              await savePlace(picked, [...chosen], howLong.value);
            } catch (e) {
              showToast(e.message || "That didn't save. Try again.");
              return false;
            }
            showToast(`${picked.city} is on ${chosen.size === 1 ? "1 friend's globe" : `${chosen.size} friends' globes`}.`, "success");
            refresh();
          },
        },
      ],
    });
  }

  return {
    node: panel,
    refresh,
    destroy() {
      destroyed = true;
      layer?.destroy();
    },
  };
}
