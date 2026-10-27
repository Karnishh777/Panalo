// The papers each syllabus is examined by (v0.2), and the exam series.
// Pure (tests/papers.test.mjs).
//
// A student sits some of a syllabus's papers (9709 AS: Paper 1 and one of
// 2, 4 or 5), in one series (February/March, May/June, October/November).
// The plan studies only the topics those papers examine, counts down to
// each paper's own date, and fits in timed past papers as the date nears.
//
// Durations and marks are from the current Cambridge syllabuses; where one
// isn't certain it is left null, and the app says to check the syllabus.
//
// A paper's `topics`: "as" (every AS topic), "a2" (A Level only), "all",
// or a list of topic ids, where an id ending in "." means every topic
// whose id starts with it ("P1." is P1.1, P1.2, ...).
//
// kind: "mcq" (multiple choice), "written" (structured / essay), or
// "practical" (a practical test, or its written alternative).

const sci = (practical) => [
  { id: "1", name: "Multiple Choice", kind: "mcq", minutes: 75, marks: 40, level: "as", topics: "as" },
  { id: "2", name: "AS Level Structured Questions", kind: "written", minutes: 75, marks: 60, level: "as", topics: "as" },
  { id: "3", name: practical, kind: "practical", minutes: 120, marks: 40, level: "as", topics: "as" },
  { id: "4", name: "A Level Structured Questions", kind: "written", minutes: 120, marks: 100, level: "a2", topics: "all" },
  { id: "5", name: "Planning, Analysis and Evaluation", kind: "practical", minutes: 75, marks: 30, level: "a2", topics: "all" },
];
const igcseSci = [
  { id: "1", name: "Multiple Choice (Core)", kind: "mcq", minutes: 45, marks: 40, level: "core", topics: "all" },
  { id: "2", name: "Multiple Choice (Extended)", kind: "mcq", minutes: 45, marks: 40, level: "extended", topics: "all" },
  { id: "3", name: "Theory (Core)", kind: "written", minutes: 75, marks: 80, level: "core", topics: "all" },
  { id: "4", name: "Theory (Extended)", kind: "written", minutes: 75, marks: 80, level: "extended", topics: "all" },
  { id: "5", name: "Practical Test", kind: "practical", minutes: 75, marks: 40, level: "any", topics: "all" },
  { id: "6", name: "Alternative to Practical", kind: "practical", minutes: 60, marks: 40, level: "any", topics: "all" },
];

/** By syllabus code: the papers, and the usual route for each stage. */
export const SYLLABUS_PAPERS = {
  // ---- AS & A Level ----
  9709: {
    papers: [
      { id: "1", name: "Pure Mathematics 1", kind: "written", minutes: 110, marks: 75, level: "as", topics: ["P1."] },
      // Pure 2 is the first part of Pure 3's content, at AS.
      { id: "2", name: "Pure Mathematics 2", kind: "written", minutes: 75, marks: 50, level: "as", topics: ["P3.1", "P3.2", "P3.3", "P3.4", "P3.5", "P3.6"] },
      { id: "3", name: "Pure Mathematics 3", kind: "written", minutes: 110, marks: 75, level: "a2", topics: ["P3."] },
      { id: "4", name: "Mechanics", kind: "written", minutes: 75, marks: 50, level: "as", topics: ["M1."] },
      { id: "5", name: "Probability & Statistics 1", kind: "written", minutes: 75, marks: 50, level: "as", topics: ["S1."] },
      { id: "6", name: "Probability & Statistics 2", kind: "written", minutes: 75, marks: 50, level: "a2", topics: ["S2"] },
    ],
    routes: { as: ["1", "5"], a2: ["1", "3", "4", "5"] },
    note: "AS Mathematics is Paper 1 and one of Papers 2, 4 or 5.",
  },
  9702: { papers: sci("Advanced Practical Skills"), routes: { as: ["1", "2", "3"], a2: ["1", "2", "3", "4", "5"] } },
  9701: { papers: sci("Advanced Practical Skills"), routes: { as: ["1", "2", "3"], a2: ["1", "2", "3", "4", "5"] } },
  9700: { papers: sci("Advanced Practical Skills"), routes: { as: ["1", "2", "3"], a2: ["1", "2", "3", "4", "5"] } },
  9708: {
    papers: [
      { id: "1", name: "AS Level Multiple Choice", kind: "mcq", minutes: 75, marks: 30, level: "as", topics: "as" },
      { id: "2", name: "AS Level Data Response and Essays", kind: "written", minutes: null, marks: 40, level: "as", topics: "as" },
      { id: "3", name: "A Level Multiple Choice", kind: "mcq", minutes: 75, marks: 30, level: "a2", topics: "all" },
      { id: "4", name: "A Level Data Response and Essays", kind: "written", minutes: 120, marks: 60, level: "a2", topics: "all" },
    ],
    routes: { as: ["1", "2"], a2: ["1", "2", "3", "4"] },
  },
  9609: {
    papers: [
      { id: "1", name: "Business Concepts 1", kind: "written", minutes: 75, marks: 40, level: "as", topics: "as" },
      { id: "2", name: "Business Concepts 2", kind: "written", minutes: 90, marks: 60, level: "as", topics: "as" },
      { id: "3", name: "Business Decision-Making", kind: "written", minutes: 105, marks: 60, level: "a2", topics: "all" },
      { id: "4", name: "Business Strategy", kind: "written", minutes: 75, marks: 40, level: "a2", topics: "all" },
    ],
    routes: { as: ["1", "2"], a2: ["1", "2", "3", "4"] },
  },
  9618: {
    papers: [
      { id: "1", name: "Theory Fundamentals", kind: "written", minutes: 90, marks: 75, level: "as", topics: ["1", "2", "3", "4", "5", "6", "7", "8"] },
      { id: "2", name: "Fundamental Problem-solving and Programming Skills", kind: "written", minutes: 120, marks: 75, level: "as", topics: ["9", "10", "11", "12"] },
      { id: "3", name: "Advanced Theory", kind: "written", minutes: 90, marks: 75, level: "a2", topics: ["13", "14", "15", "16", "17", "18"] },
      { id: "4", name: "Practical", kind: "practical", minutes: 150, marks: 75, level: "a2", topics: ["19", "20"] },
    ],
    routes: { as: ["1", "2"], a2: ["1", "2", "3", "4"] },
  },
  9706: {
    papers: [
      { id: "1", name: "AS Level Multiple Choice", kind: "mcq", minutes: 60, marks: 30, level: "as", topics: "as" },
      { id: "2", name: "AS Level Structured Questions", kind: "written", minutes: 105, marks: 90, level: "as", topics: "as" },
      { id: "3", name: "A Level Multiple Choice", kind: "mcq", minutes: 75, marks: 30, level: "a2", topics: "all" },
      { id: "4", name: "A Level Structured Questions", kind: "written", minutes: null, marks: null, level: "a2", topics: "all" },
    ],
    routes: { as: ["1", "2"], a2: ["1", "2", "3", "4"] },
  },
  9990: {
    papers: [
      { id: "1", name: "Approaches, Issues and Debates", kind: "written", minutes: 90, marks: 60, level: "as", topics: ["2", "3", "4", "5"] },
      { id: "2", name: "Research Methods", kind: "written", minutes: 90, marks: 60, level: "as", topics: ["1"] },
      { id: "3", name: "Specialist Options: Theory", kind: "written", minutes: 90, marks: 60, level: "a2", topics: ["6", "7", "8", "9"] },
      { id: "4", name: "Specialist Options: Application", kind: "written", minutes: 90, marks: 60, level: "a2", topics: ["6", "7", "8", "9"] },
    ],
    routes: { as: ["1", "2"], a2: ["1", "2", "3", "4"] },
  },
  9699: {
    papers: [
      { id: "1", name: "Socialisation, Identity and Methods of Research", kind: "written", minutes: null, marks: null, level: "as", topics: ["1", "2"] },
      { id: "2", name: "The Family", kind: "written", minutes: null, marks: null, level: "as", topics: ["3"] },
      { id: "3", name: "Education", kind: "written", minutes: null, marks: null, level: "a2", topics: ["4"] },
      { id: "4", name: "Globalisation, Media and Religion", kind: "written", minutes: null, marks: null, level: "a2", topics: ["5", "6", "7"] },
    ],
    routes: { as: ["1", "2"], a2: ["1", "2", "3", "4"] },
  },

  // ---- IGCSE ----
  "0625": { papers: igcseSci, routes: { igcse: ["2", "4", "6"] } },
  "0620": { papers: igcseSci, routes: { igcse: ["2", "4", "6"] } },
  "0610": { papers: igcseSci, routes: { igcse: ["2", "4", "6"] } },
  "0580": {
    papers: [
      { id: "1", name: "Non-calculator (Core)", kind: "written", minutes: 90, marks: 80, level: "core", topics: "all" },
      { id: "2", name: "Non-calculator (Extended)", kind: "written", minutes: 120, marks: 100, level: "extended", topics: "all" },
      { id: "3", name: "Calculator (Core)", kind: "written", minutes: 90, marks: 80, level: "core", topics: "all" },
      { id: "4", name: "Calculator (Extended)", kind: "written", minutes: 120, marks: 100, level: "extended", topics: "all" },
    ],
    routes: { igcse: ["2", "4"] },
  },
  "0478": {
    papers: [
      { id: "1", name: "Computer Systems", kind: "written", minutes: 105, marks: 75, level: "any", topics: ["1", "2", "3", "4", "5", "6"] },
      { id: "2", name: "Algorithms, Programming and Logic", kind: "written", minutes: 105, marks: 75, level: "any", topics: ["7", "8", "9", "10"] },
    ],
    routes: { igcse: ["1", "2"] },
  },
  "0455": {
    papers: [
      { id: "1", name: "Multiple Choice", kind: "mcq", minutes: 45, marks: 30, level: "any", topics: "all" },
      { id: "2", name: "Structured Questions", kind: "written", minutes: 135, marks: 90, level: "any", topics: "all" },
    ],
    routes: { igcse: ["1", "2"] },
  },
  "0450": {
    papers: [
      { id: "1", name: "Short Answer and Data Response", kind: "written", minutes: 90, marks: 80, level: "any", topics: "all" },
      { id: "2", name: "Case Study", kind: "written", minutes: 90, marks: 80, level: "any", topics: "all" },
    ],
    routes: { igcse: ["1", "2"] },
  },
  "0452": {
    papers: [
      { id: "1", name: "Multiple Choice", kind: "mcq", minutes: null, marks: null, level: "any", topics: "all" },
      { id: "2", name: "Structured Written Paper", kind: "written", minutes: null, marks: null, level: "any", topics: "all" },
    ],
    routes: { igcse: ["1", "2"] },
  },
};

export const KIND_LABEL = { mcq: "Multiple choice", written: "Written", practical: "Practical" };

/** The papers of a syllabus (by its code), or []. */
export function papersOf(code) {
  return SYLLABUS_PAPERS[code]?.papers || [];
}

export function paperOf(code, id) {
  return papersOf(code).find((p) => p.id === String(id)) || null;
}

/** "Paper 5 · Probability & Statistics 1" */
export const paperLabel = (p) => (p ? `Paper ${p.id} · ${p.name}` : "");

/** The usual papers for a stage ("as", "a2", "igcse" levels), when none are chosen. */
export function defaultPapers(code, level) {
  const r = SYLLABUS_PAPERS[code]?.routes;
  if (!r) return [];
  return (r[level] || r.as || r.igcse || []).slice();
}

/** The papers a stage can sit: AS students only AS papers. */
export function papersForLevel(code, level) {
  return papersOf(code).filter((p) => level !== "as" || p.level === "as");
}

function matches(spec, topic) {
  if (spec === "all") return true;
  if (spec === "as") return topic.stage !== "a2";
  if (spec === "a2") return topic.stage === "a2";
  if (!Array.isArray(spec)) return false;
  return spec.some((s) => (s.endsWith(".") ? topic.id.startsWith(s) : topic.id === s));
}

/** The topics one paper examines, in syllabus order. */
export function paperTopics(syllabus, paper) {
  return (syllabus?.topics || []).filter((t) => matches(paper.topics, t));
}

/** The topics a set of papers examine together (syllabus order), or null if none apply. */
export function topicsForPapers(syllabus, ids) {
  const chosen = papersOf(syllabus?.code).filter((p) => ids.includes(p.id));
  if (!chosen.length) return null;
  return (syllabus.topics || []).filter((t) => chosen.some((p) => matches(p.topics, t)));
}

/** Which of the chosen papers examine a topic. */
export function papersForTopic(code, ids, topic) {
  return papersOf(code).filter((p) => ids.includes(p.id) && matches(p.topics, topic));
}

// ---- Exam series ----------------------------------------------------------------------------
// When each series usually starts (month 0-based, day). The exact dates come
// from the timetable; until the student adds them, the plan aims for the
// start of the series, so it is never late.
export const SERIES = {
  fm: { name: "February/March", month: 1, day: 23 },
  mj: { name: "May/June", month: 3, day: 24 },
  on: { name: "October/November", month: 9, day: 1 },
};

/** "2027-fm" -> its first day (local midnight), or null. */
export function seriesStart(key) {
  const m = /^(\d{4})-(fm|mj|on)$/.exec(String(key || ""));
  if (!m) return null;
  const s = SERIES[m[2]];
  return new Date(Number(m[1]), s.month, s.day).getTime();
}

export function seriesLabel(key) {
  const m = /^(\d{4})-(fm|mj|on)$/.exec(String(key || ""));
  return m ? `${SERIES[m[2]].name} ${m[1]}` : "";
}

/** The next `n` series that haven't started yet. */
export function upcomingSeries(now = Date.now(), n = 4) {
  const out = [];
  const year = new Date(now).getFullYear();
  for (let y = year; out.length < n && y < year + 4; y++) {
    for (const k of ["fm", "mj", "on"]) {
      const key = `${y}-${k}`;
      // A series counts until a few weeks in: it may already be under way.
      if (seriesStart(key) + 28 * 86400000 > now && out.length < n) out.push(key);
    }
  }
  return out;
}

/**
 * When a paper is sat: its own date if the student gave one, else the
 * start of their series, else null.
 */
export function paperDate(subject, paperId) {
  const own = subject?.dates?.[paperId];
  if (own && /^\d{4}-\d{2}-\d{2}$/.test(own)) {
    const [y, m, d] = own.split("-").map(Number);
    return new Date(y, m - 1, d, 9).getTime();
  }
  const s = seriesStart(subject?.series);
  return s == null ? null : s + 9 * 3600000;
}
