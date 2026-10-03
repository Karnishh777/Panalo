// For moderators only: a "Moderation" entry in the account menu with the
// number of reports that need attention. Everyone else never sees it -- the
// database answers "not a moderator" and nothing is shown.
import { supabaseClient } from "../../src/client.js";

let timer = null;

export async function refreshModeration() {
  const link = document.getElementById("mod-link");
  if (!link) return;
  try {
    const { data, error } = await supabaseClient.rpc("moderation_status");
    if (error || !data?.[0]?.is_moderator) {
      link.hidden = true;
      return;
    }
    const { data: reports } = await supabaseClient.rpc("moderation_reports", { p_status: null });
    const waiting = (reports || []).filter((r) => r.status !== "closed").length;
    link.hidden = false;
    const count = link.querySelector("[data-mod-count]");
    count.textContent = waiting ? String(waiting) : "";
    count.hidden = !waiting;
    const dot = document.getElementById("me-mod-dot");
    if (dot) dot.hidden = !waiting;
  } catch {
    link.hidden = true;
  }
}

export function startModeration() {
  refreshModeration();
  clearInterval(timer);
  timer = setInterval(refreshModeration, 120_000);
}

export function stopModeration() {
  clearInterval(timer);
  timer = null;
  const link = document.getElementById("mod-link");
  if (link) link.hidden = true;
  const dot = document.getElementById("me-mod-dot");
  if (dot) dot.hidden = true;
}
