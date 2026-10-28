// Other subjects (v0.2): a subject Panalo doesn't list, added by name and
// syllabus code ("Further Mathematics 9231"). Pan works out its syllabus
// (functions/api/pan-subject.js); the student checks it; it is kept in
// student_profiles.custom_syllabi (phase 35) and planned topic by topic
// like the built-in subjects, just without a question bank. Pure
// (tests/custom.test.mjs).

export const MAX_CUSTOM = 6;
export const MAX_TOPICS = 40;
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** A new subject's id: "x" and letters of its name, unique among `taken`. */
export function customId(name, taken = []) {
  const base = `x${clip(name, 60).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 9) || "subject"}`.slice(0, 10);
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
  return null;
}

export const isCustomId = (id) => /^x[a-z0-9]{1,11}$/.test(String(id || ""));

/** A custom subject as the profile keeps it, or null if it isn't one. */
export function cleanCustomSubject(s) {
  const name = clip(s?.name, 40);
  if (!s?.custom || !isCustomId(s.id) || !name) return null;
  const code = clip(s.code, 12).replace(/[^A-Za-z0-9/ -]/g, "");
  return { id: s.id, custom: true, name, ...(code ? { code } : {}) };
}

/** A syllabus from Pan (or edited by the student), cleaned and capped. */
export function cleanSyllabus(raw) {
  if (!raw || typeof raw !== "object") return null;
  const seen = new Set();
  const kept = (Array.isArray(raw.topics) ? raw.topics : [])
    .map((t) => ({ id: /^c\d{1,3}$/.test(t?.id || "") ? t.id : null, name: clip(typeof t === "string" ? t : t?.name, 80), stage: ["as", "a2"].includes(t?.stage) ? t.stage : null }))
    .filter((t) => t.name && !seen.has(t.name.toLowerCase()) && seen.add(t.name.toLowerCase()))
    .slice(0, MAX_TOPICS);
  // A topic keeps its id when the list is edited, so its progress stays
  // with it; new topics get the next free ids.
  const ids = new Set();
  for (const t of kept) if (t.id && !ids.has(t.id)) ids.add(t.id);
  else t.id = null;
  let next = 1;
  const topics = kept.map((t) => {
    if (!t.id) {
      while (ids.has(`c${next}`)) next++;
      t.id = `c${next}`;
      ids.add(t.id);
    }
    return { id: t.id, name: t.name, ...(t.stage ? { stage: t.stage } : {}) };
  });
  if (!topics.length) return null;
  return {
    name: clip(raw.name, 60),
    code: clip(raw.code, 12),
    board: clip(raw.board, 60),
    known: raw.known === true,
    topics,
  };
}

/** Only the syllabi of subjects still chosen. */
export function cleanCustomSyllabi(obj, ids) {
  const out = {};
  for (const id of ids) {
    const s = cleanSyllabus(obj?.[id]);
    if (s) out[id] = s;
  }
  return out;
}

/** A stored syllabus as a question bank the planner reads (no questions). */
export function asBank(id, syl) {
  if (!syl?.topics?.length) return null;
  return { subject: id, name: syl.name, code: syl.code || null, board: syl.board, custom: true, topics: syl.topics.map((t) => ({ ...t, questions: [] })) };
}
