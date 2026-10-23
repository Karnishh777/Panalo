// What a student can study, by board and stage (v0.2). Pure (tested in
// Node): the setup offers these, and the planner reads them.
//
// Cambridge first (IGCSE, then AS and A Level), with each syllabus's own
// code, then CBSE. Topic lists for each syllabus live in model/syllabus.js.

export const BOARDS = [
  { id: "cambridge", label: "Cambridge", sub: "IGCSE, AS and A Level" },
  { id: "cbse", label: "CBSE", sub: "Classes 9 to 12" },
  { id: "other", label: "Something else", sub: "Another board or none" },
];

export const STAGES = {
  cambridge: [
    { id: "igcse1", label: "Grade 9", sub: "IGCSE, first year", grade: 9, level: "igcse" },
    { id: "igcse2", label: "Grade 10", sub: "IGCSE, exam year", grade: 10, level: "igcse" },
    { id: "as", label: "AS", sub: "Grade 11", grade: 11, level: "as" },
    { id: "a2", label: "A2", sub: "Grade 12, A Level", grade: 12, level: "a2" },
  ],
  cbse: [
    { id: "cbse9", label: "Class 9", grade: 9, level: "cbse-secondary" },
    { id: "cbse10", label: "Class 10", sub: "Board exam year", grade: 10, level: "cbse-secondary" },
    { id: "cbse11", label: "Class 11", grade: 11, level: "cbse-senior" },
    { id: "cbse12", label: "Class 12", sub: "Board exam year", grade: 12, level: "cbse-senior" },
  ],
  other: [{ id: "other", label: "My own grade", level: "other" }],
};

// One list per level. `id` is stable (saved in the profile); `code` is the
// board's own syllabus number.
const IGCSE = [
  ["eng1", "English First Language", "0500"],
  ["eng2", "English as a Second Language", "0510"],
  ["math", "Mathematics", "0580"],
  ["amath", "Additional Mathematics", "0606"],
  ["phy", "Physics", "0625"],
  ["chem", "Chemistry", "0620"],
  ["bio", "Biology", "0610"],
  ["cs", "Computer Science", "0478"],
  ["ict", "ICT", "0417"],
  ["acc", "Accounting", "0452"],
  ["bus", "Business Studies", "0450"],
  ["eco", "Economics", "0455"],
  ["soc", "Sociology", "0495"],
  ["gp", "Global Perspectives", "0457"],
  ["art", "Art and Design", "0400"],
  ["dt", "Design and Technology", "0445"],
  ["hindi", "Hindi as a Second Language", "0549"],
  ["french", "French", "0520"],
];

const ALEVEL = [
  ["eng", "English Language", "9093"],
  ["gpaper", "English General Paper", "8021"],
  ["math", "Mathematics", "9709"],
  ["fmath", "Further Mathematics", "9231"],
  ["phy", "Physics", "9702"],
  ["chem", "Chemistry", "9701"],
  ["bio", "Biology", "9700"],
  ["cs", "Computer Science", "9618"],
  ["it", "Information Technology", "9626"],
  ["acc", "Accounting", "9706"],
  ["bus", "Business", "9609"],
  ["eco", "Economics", "9708"],
  ["psy", "Psychology", "9990"],
  ["soc", "Sociology", "9699"],
  ["gpr", "Global Perspectives and Research", "9239"],
  ["art", "Art and Design", "9479"],
  ["dt", "Design and Technology", "9705"],
];

const CBSE_SECONDARY = [
  ["eng", "English"],
  ["hindi", "Hindi"],
  ["math", "Mathematics"],
  ["sci", "Science"],
  ["sst", "Social Science"],
  ["it", "Information Technology"],
  ["ai", "Artificial Intelligence"],
];

const CBSE_SENIOR = [
  ["eng", "English Core"],
  ["math", "Mathematics"],
  ["amath", "Applied Mathematics"],
  ["phy", "Physics"],
  ["chem", "Chemistry"],
  ["bio", "Biology"],
  ["cs", "Computer Science"],
  ["ip", "Informatics Practices"],
  ["acc", "Accountancy"],
  ["bst", "Business Studies"],
  ["eco", "Economics"],
  ["psy", "Psychology"],
  ["soc", "Sociology"],
  ["hist", "History"],
  ["geo", "Geography"],
  ["pol", "Political Science"],
  ["pe", "Physical Education"],
];

const OTHER = [
  ["eng", "English"],
  ["math", "Mathematics"],
  ["phy", "Physics"],
  ["chem", "Chemistry"],
  ["bio", "Biology"],
  ["sci", "Science"],
  ["cs", "Computer Science"],
  ["eco", "Economics"],
  ["bus", "Business"],
  ["acc", "Accounting"],
  ["hist", "History"],
  ["geo", "Geography"],
  ["lang", "A second language"],
  ["art", "Art"],
];

const BY_LEVEL = {
  igcse: IGCSE,
  as: ALEVEL,
  a2: ALEVEL,
  "cbse-secondary": CBSE_SECONDARY,
  "cbse-senior": CBSE_SENIOR,
  other: OTHER,
};

/** The stage record for a stage id, or null. */
export function stageOf(stageId) {
  for (const list of Object.values(STAGES)) {
    const s = list.find((x) => x.id === stageId);
    if (s) return s;
  }
  return null;
}

/** The subjects offered at a stage: [{ id, name, code }]. */
export function subjectsFor(stageId) {
  const s = stageOf(stageId);
  return (BY_LEVEL[s?.level] || []).map(([id, name, code]) => ({ id, name, code: code || null }));
}

/** The display name of a subject at a stage (falls back to its id). */
export function subjectName(stageId, id) {
  return subjectsFor(stageId).find((x) => x.id === id)?.name || id;
}

// How a subject is going, as the setup asks it.
export const LEVELS = [
  { id: 1, label: "Struggling" },
  { id: 2, label: "Okay" },
  { id: 3, label: "Good" },
  { id: 4, label: "Strong" },
];

/** The grades a stage is marked in, best first (for "my last grade"). */
export function gradesFor(stageId) {
  const level = stageOf(stageId)?.level;
  if (level === "igcse") return ["A*", "A", "B", "C", "D", "E", "F", "G", "U"];
  if (level === "as") return ["a", "b", "c", "d", "e", "u"];
  if (level === "a2") return ["A*", "A", "B", "C", "D", "E", "U"];
  return ["90+", "80s", "70s", "60s", "50s", "40s", "Below 40"];
}

export const AIMS = [
  { id: "pass", label: "Pass everything", sub: "Steady, no subject left behind" },
  { id: "good", label: "Good grades", sub: "Above average across the board" },
  { id: "top", label: "Top grades", sub: "A*/A or 90%+, university-level ambition" },
];
