// The planner in the app (v0.2): loads each subject's question bank, turns
// what is stored into the plan (model/plan.js), and saves what a block
// changed. The plan itself is never stored: it is rebuilt from the
// student's state whenever it is shown.
import { store, api, on, emit } from "./store.js";
import { fromRow, toRow } from "./model/profile.js";
import * as L from "./model/learner.js";
import * as P from "./model/plan.js";
import * as R from "./model/rules.js";
import { startOfDay, DAY } from "./model/time.js";
import { stageOf, subjectName } from "./model/subjects.js";
import { GUARDIANS, guardianOf } from "./art.js";
import * as PP from "./model/papers.js";
import { asBank } from "./model/custom.js";

const banks = new Map(); // path -> syllabus json, or null when there is none
const loading = new Map();

// Each subject keeps one colour everywhere: its guardian's (art.js), or,
// when an earlier subject already has that guardian, the next free one.
const COLOURS = Object.values(GUARDIANS);
export function colourOf(subjectId) {
  const used = new Set();
  for (const s of profile().subjects || []) {
    let c = GUARDIANS[guardianOf(s.id)];
    if (used.has(c)) c = COLOURS.find((x) => !used.has(x)) || c;
    if (s.id === subjectId) return c;
    used.add(c);
  }
  return GUARDIANS[guardianOf(subjectId)];
}

export function profile() {
  return fromRow(store.student);
}

/** Whether there is anything to plan: a finished setup with subjects. */
export function hasPlan() {
  const p = profile();
  return !!store.student?.setup_at && p.subjects.length > 0;
}

async function fetchBank(path) {
  if (banks.has(path)) return banks.get(path);
  if (!loading.has(path)) {
    loading.set(
      path,
      fetch(path)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((j) => {
          banks.set(path, j);
          loading.delete(path);
          return j;
        })
    );
  }
  return loading.get(path);
}

// A subject's bank: the listed one's file, or an other subject's syllabus
// as Pan found it (phase 35, model/custom.js).
const pathOf = (p, s) => (s.custom ? null : P.syllabusPath(p.stage, s.id));

/** Load every chosen subject's bank; resolves when all are in. */
export async function loadBanks() {
  const p = profile();
  const paths = p.subjects.map((s) => pathOf(p, s)).filter(Boolean);
  const fresh = paths.some((x) => !banks.has(x));
  await Promise.all(paths.map(fetchBank));
  if (fresh) emit("plan");
}

/** The banks already loaded, by subject id. */
export function syllabi() {
  const p = profile();
  const out = {};
  for (const s of p.subjects) {
    if (s.custom) {
      out[s.id] = asBank(s.id, p.customSyllabi?.[s.id]);
      continue;
    }
    const path = P.syllabusPath(p.stage, s.id);
    out[s.id] = path ? banks.get(path) || null : null;
  }
  return out;
}

export function banksReady() {
  const p = profile();
  return p.subjects.every((s) => {
    const path = pathOf(p, s);
    return !path || banks.has(path);
  });
}

/** Stored topic states, { subject: { topic: state } }. */
export function topicStates() {
  const out = {};
  for (const r of store.topics) (out[r.subject] ||= {})[r.topic] = L.fromTopicRow(r);
  return out;
}

export function paceOf() {
  const p = store.student?.pace;
  return p && typeof p === "object" ? p : {};
}

export function focusedToday(now = Date.now()) {
  const from = startOfDay(new Date(now)).getTime();
  return store.sessions.filter((s) => Date.parse(s.started_at) >= from).reduce((n, s) => n + (s.focused_minutes || 0), 0);
}

/**
 * Whether yesterday went by with no study logged when the plan had some
 * (and the student had a plan by then, and hadn't taken it off). The plan
 * re-plans by itself either way; this only lets it say so.
 */
export function missedYesterday(now = Date.now()) {
  const today = startOfDay(new Date(now)).getTime();
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  const from = y.getTime();
  const since = Date.parse(store.student?.setup_at || "");
  if (!hasPlan() || !(since < from)) return false;
  if (R.dayRule(planRules(now), from).off) return false;
  return !store.sessions.some((s) => {
    const t = Date.parse(s.started_at);
    return t >= from && t < today;
  });
}

/** The plan for the next `days` days, from now. */
export function currentPlan({ now = Date.now(), days = 7 } = {}) {
  if (!hasPlan()) return [];
  return P.buildPlan({ profile: profile(), syllabi: syllabi(), topics: topicStates(), pace: paceOf(), events: store.events, doneToday: focusedToday(now), now, days, rules: planRules(now), papersDone: papersDone() });
}

/** A past paper's result is titled "Paper 5 · …" (past-paper.js). */
export const PAPER_TITLE = /^Paper (\d{1,2}) · /;

/** When each paper was last done as a past paper: { subject: { paperId: ms } }. */
export function papersDone() {
  const out = {};
  for (const r of store.results) {
    const m = PAPER_TITLE.exec(r.title || "");
    if (!m) continue;
    const at = Date.parse(r.taken_on || r.created_at || "");
    const s = (out[r.subject] ||= {});
    if (Number.isFinite(at) && !(s[m[1]] > at)) s[m[1]] = at;
  }
  return out;
}

/** The topics a subject studies: its chosen papers', or its stage's. */
export function scopeOf(subjectId) {
  const p = profile();
  const s = p.subjects.find((x) => x.id === subjectId);
  return P.topicsInScope(syllabi()[subjectId], p.stage, s?.papers);
}

/** A subject's chosen papers, each with its date (ms or null). */
export function papersOfSubject(subjectId) {
  const s = profile().subjects.find((x) => x.id === subjectId);
  const code = syllabi()[subjectId]?.code;
  return (s?.papers || []).map((id) => PP.paperOf(code, id)).filter(Boolean).map((p) => ({ ...p, at: PP.paperDate(s, p.id) }));
}

/** Change one subject's papers, series or dates (and nothing else). */
export function savePapers(subjectId, patch) {
  const p = profile();
  const subjects = p.subjects.map((s) => (s.id === subjectId ? { ...s, ...patch } : s));
  const row = toRow({ ...p, subjects });
  return api.saveStudent({ subjects: row.subjects });
}

/** The student's own changes to the plan (phase 32), cleaned. */
export function planRules(now = Date.now()) {
  return R.normalize(store.student?.plan_rules, { subjects: profile().subjects.map((s) => s.id), now });
}

/** Apply changes (from the editor or Pan) and save them. */
export async function changePlan(changes, now = Date.now()) {
  const next = R.applyChanges(planRules(now), changes, { subjects: profile().subjects.map((s) => s.id), now });
  return saveRules(next);
}

export function saveRules(rules) {
  return api.saveStudent({ plan_rules: rules });
}

/** Everything about one subject the plan page shows. */
export function subjectView(s, now = Date.now()) {
  const p = profile();
  const bank = syllabi()[s.id];
  const list = P.topicsInScope(bank, p.stage, s.papers);
  const states = topicStates()[s.id] || {};
  // The next exam: one on the calendar, or the first of the chosen papers.
  const papers = papersOfSubject(s.id);
  const dates = [P.nextExam({ id: s.id, name: nameOf(s.id), code: bank?.code }, store.events, now), ...papers.map((x) => x.at).filter((at) => at != null && at >= now - DAY / 2)].filter((x) => x != null);
  const examAt = dates.length ? Math.min(...dates) : null;
  return {
    id: s.id,
    name: nameOf(s.id),
    code: bank?.code || null,
    level: s.level ?? 2,
    own: list[0]?.id === "*",
    list,
    states,
    readiness: P.readiness(list, states, s.level ?? 2),
    target: P.TARGET[p.aim] || P.TARGET.good,
    examAt,
    pace: paceOf()[s.id] || null,
    papers,
  };
}

export function nameOf(subjectId) {
  const own = profile().subjects.find((s) => s.id === subjectId && s.custom);
  if (own) return own.name;
  return subjectName(profile().stage, subjectId) || syllabi()[subjectId]?.name || subjectId;
}

export function topicName(subjectId, topicId) {
  if (topicId === "*") return "Your own work";
  if (/^paper-\d{1,2}$/.test(topicId)) return PP.paperLabel(PP.paperOf(syllabi()[subjectId]?.code, topicId.slice(6))) || topicId;
  return syllabi()[subjectId]?.topics.find((t) => t.id === topicId)?.name || topicId;
}

export function questionsFor(subjectId, topicId) {
  return syllabi()[subjectId]?.topics.find((t) => t.id === topicId)?.questions || [];
}

export function stateOf(subjectId, topicId) {
  const r = store.topics.find((t) => t.subject === subjectId && t.topic === topicId);
  const level = profile().subjects.find((s) => s.id === subjectId)?.level ?? 2;
  return r ? L.fromTopicRow(r) : L.newTopic(level);
}

/** Save a topic's new state. */
export function saveTopic(subjectId, topicId, t) {
  return api.saveTopic(L.toTopicRow(subjectId, topicId, t));
}

/** Save many topics of one subject at once: { topicId: state }. */
export function saveTopics(subjectId, states) {
  return api.saveTopics(Object.entries(states).map(([id, t]) => L.toTopicRow(subjectId, id, t)));
}

/** Update a subject's pace after a learn block. */
export async function savePace(subjectId, { minutes, covered }) {
  const p = profile();
  const n = scopeOf(subjectId).length;
  const typical = L.typicalMinutes(stageOf(p.stage)?.level || "other", n);
  const cur = paceOf()[subjectId] || L.newPace();
  const next = L.updatePace(cur, { minutes, typical, covered });
  if (next === cur) return {};
  return api.saveStudent({ pace: { ...paceOf(), [subjectId]: { pace: Math.round(next.pace * 1000) / 1000, n: next.n } } });
}

/** A result: saved, and applied to the topics it covered (all, lightly, if none named). */
export async function addResult({ subject, title, takenOn, score, outOf, topics }) {
  const r = await api.addResult({ subject, title, taken_on: takenOn, score, out_of: outOf, topics });
  if (r.error) return r;
  const ids = topics.length ? topics : scopeOf(subject).map((t) => t.id);
  const weight = topics.length ? 1 / 3 : 1 / 6;
  const s = await saveTopics(subject, Object.fromEntries(ids.map((id) => [id, L.applyMark(stateOf(subject, id), score / outOf, weight)])));
  return s.error ? s : r;
}

// Re-plan whenever something the plan depends on changes.
let wired = false;
export function wirePlanner() {
  if (wired) return;
  wired = true;
  on("student", () => loadBanks());
}

/**
 * The chapters in the student's syllabus scope, for the world (phase 37):
 * how many, covered, known to the aim, and due for review. Null until the
 * question banks have loaded (they're asked for here).
 */
export function knowledge(now = Date.now()) {
  if (!hasPlan()) return null;
  if (!banksReady()) {
    loadBanks();
    return null;
  }
  const out = { total: 0, covered: 0, known: 0, due: 0 };
  for (const s of profile().subjects) {
    const v = subjectView(s, now);
    if (v.own) continue;
    for (const tp of v.list) {
      const t = v.states[tp.id];
      out.total++;
      if (!t) continue;
      if (t.covered >= 1) out.covered++;
      if (t.covered >= 1 && L.mastery(t) >= v.target) out.known++;
      const due = t.covered >= 1 && L.dueAt(t, { examAt: v.examAt, now });
      if (due && due <= now) out.due++;
    }
  }
  return out;
}

/** Everything the world grows from (model/world-model.js buildWorld). */
export function worldInput(now = Date.now()) {
  return { sessions: store.sessions, tasks: store.tasks, logs: store.logs, goals: store.goals, entries: store.entries, results: store.results, knowledge: knowledge(now), bornAt: store.student?.born_at, now };
}
