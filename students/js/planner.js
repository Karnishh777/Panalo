// The planner in the app (v0.2): loads each subject's question bank, turns
// what is stored into the plan (model/plan.js), and saves what a block
// changed. The plan itself is never stored: it is rebuilt from the
// student's state whenever it is shown.
import { store, api, on, emit } from "./store.js";
import { fromRow } from "./model/profile.js";
import * as L from "./model/learner.js";
import * as P from "./model/plan.js";
import * as R from "./model/rules.js";
import { startOfDay } from "./model/time.js";
import { stageOf, subjectName } from "./model/subjects.js";
import { GUARDIANS, guardianOf } from "./art.js";

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

/** Load every chosen subject's bank; resolves when all are in. */
export async function loadBanks() {
  const p = profile();
  const paths = p.subjects.map((s) => P.syllabusPath(p.stage, s.id)).filter(Boolean);
  const fresh = paths.some((x) => !banks.has(x));
  await Promise.all(paths.map(fetchBank));
  if (fresh) emit("plan");
}

/** The banks already loaded, by subject id. */
export function syllabi() {
  const p = profile();
  const out = {};
  for (const s of p.subjects) {
    const path = P.syllabusPath(p.stage, s.id);
    out[s.id] = path ? banks.get(path) || null : null;
  }
  return out;
}

export function banksReady() {
  const p = profile();
  return p.subjects.every((s) => {
    const path = P.syllabusPath(p.stage, s.id);
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

/** The plan for the next `days` days, from now. */
export function currentPlan({ now = Date.now(), days = 7 } = {}) {
  if (!hasPlan()) return [];
  return P.buildPlan({ profile: profile(), syllabi: syllabi(), topics: topicStates(), pace: paceOf(), events: store.events, doneToday: focusedToday(now), now, days, rules: planRules(now) });
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
  const list = P.topicsInScope(bank, p.stage);
  const states = topicStates()[s.id] || {};
  const examAt = P.nextExam({ id: s.id, name: nameOf(s.id), code: bank?.code }, store.events, now);
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
  };
}

export function nameOf(subjectId) {
  return subjectName(profile().stage, subjectId) || syllabi()[subjectId]?.name || subjectId;
}

export function topicName(subjectId, topicId) {
  if (topicId === "*") return "Your own work";
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

/** Update a subject's pace after a learn block. */
export async function savePace(subjectId, { minutes, covered }) {
  const p = profile();
  const bank = syllabi()[subjectId];
  const n = P.topicsInScope(bank, p.stage).length;
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
  const p = profile();
  const list = P.topicsInScope(syllabi()[subject], p.stage);
  const ids = topics.length ? topics : list.map((t) => t.id);
  const weight = topics.length ? 1 / 3 : 1 / 6;
  for (const id of ids) {
    const t = stateOf(subject, id);
    const next = L.applyMark(t, score / outOf, weight);
    const s = await saveTopic(subject, id, next);
    if (s.error) return s;
  }
  return r;
}

// Re-plan whenever something the plan depends on changes.
let wired = false;
export function wirePlanner() {
  if (wired) return;
  wired = true;
  on("student", () => loadBanks());
}
