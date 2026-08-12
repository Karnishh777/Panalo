// "On this day" — surface messages you exchanged on this calendar date in past
// months or years, so a chat that's been running for a while quietly reminds
// you what you were talking about back then. Free win: no schema, no server
// logic; just a range query per horizon on the existing messages table.
import { supabaseClient } from "./client.js";
import { messagePlaintext, getConversationKey } from "./encryption.js";

// Horizons we probe, newest first. Fresh accounts see nothing; the feature
// silently switches on once a chat has any history from these anniversaries.
const HORIZONS = [
  { months: 1, label: "a month ago" },
  { months: 3, label: "3 months ago" },
  { months: 6, label: "6 months ago" },
  { years: 1, label: "a year ago" },
  { years: 2, label: "2 years ago" },
  { years: 3, label: "3 years ago" },
  { years: 4, label: "4 years ago" },
  { years: 5, label: "5 years ago" },
];

// A dismissed banner never comes back for the same (chat, day) pair — otherwise
// closing it and reopening the chat would just show it again. Persists across
// reloads, cleared on log-out with the rest of localStorage.
const DISMISS_KEY = "panalo.memoriesDismissed";

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function readDismissed() {
  try {
    return JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function isDismissed(convId) {
  return readDismissed()[convId] === todayStamp();
}

export function dismiss(convId) {
  const map = readDismissed();
  map[convId] = todayStamp();
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

// The day-window for a horizon: local-midnight-to-midnight on that anniversary.
// Local, not UTC, because "on this day" is a human calendar concept.
function windowFor({ years = 0, months = 0 }) {
  const now = new Date();
  const start = new Date(now.getFullYear() - years, now.getMonth() - months, now.getDate(), 0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

// Returns memory groups oldest-first, at most one per horizon. Each group:
// { label, when, count, samples: [{ mine, username, text }] }
export async function getMemories(convId, userId, { maxSamples = 2 } = {}) {
  if (!convId) return [];

  // Prime the conversation key first. Memories decrypt sample text, and without
  // this call an unloaded key produces "🔒 Encrypted — unlock to read" instead
  // of the actual message — technically correct, useless to the reader.
  await getConversationKey(convId).catch(() => null);

  const groups = [];
  for (const h of HORIZONS) {
    const { start, end } = windowFor(h);
    // Nonsensical windows (before the app existed) — skip quietly.
    if (start.getFullYear() < 2024) continue;

    // conversation_id must come back on the row: messagePlaintext looks it up
    // to find the AES key. Without it the memory shows as "🔒 Encrypted".
    const { data, error } = await supabaseClient
      .from("messages")
      .select("id, conversation_id, user_id, username, content, iv, file_url, created_at")
      .eq("conversation_id", convId)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .order("created_at", { ascending: true });
    if (error || !data || !data.length) continue;

    const picked = data.slice(0, maxSamples);
    const samples = [];
    for (const msg of picked) {
      let text;
      if (msg.file_url && !msg.content) text = "📎 Attachment";
      else text = await messagePlaintext(msg);
      samples.push({
        id: msg.id,
        mine: msg.user_id === userId,
        username: msg.username,
        text: (text || "").slice(0, 140),
      });
    }
    groups.push({ label: h.label, when: start, count: data.length, samples });
  }

  // Oldest anniversary first — reads like a timeline.
  return groups.reverse();
}
