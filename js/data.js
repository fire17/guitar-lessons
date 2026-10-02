// data.js: loads index.json + config + lesson files, normalizes, builds maps (DESIGN §3)
export const KNOWN_TYPES = ["mcq", "degree_to_chord", "chord_to_degree", "relative_minor", "interval_inversion", "fill_blank", "ear_degree", "ear_quality", "progression_build", "family_sort", "fretboard_find"];

export const RENDERER = {
  mcq: "choice", degree_to_chord: "choice", chord_to_degree: "choice", relative_minor: "choice",
  interval_inversion: "choice", fill_blank: "choice", ear_degree: "choice", ear_quality: "choice",
  progression_build: "order", family_sort: "buckets", fretboard_find: "fret",
};

export const DB = {
  config: { schema: 1, teacher: { mode: "canned", url: null }, recording: null, app_name_he: "מספרים על הצוואר" },
  lessons: [],
  lessonById: {},
  units: [],          // all units, path order across lessons
  unitByKey: {},      // "<lessonId>/<unitId>" (uid; `key` is a musical field in exercises)
  exercises: [],      // all exercises
  exByKey: {},        // "<lessonId>/<exerciseId>"
  skills: [],         // global, first-seen order
  skillById: {},
  unknown: [],        // exercises with unknown types
  loadErrors: [],
};

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

export async function loadAll() {
  // config and index in parallel (index.json is also preloaded from index.html)
  const [cfg, index] = await Promise.all([
    getJSON("data/config.json").catch((e) => { DB.loadErrors.push(String(e)); return {}; }),
    getJSON("data/lessons/index.json"),
  ]);
  DB.config = Object.assign(DB.config, cfg);
  const files = await Promise.all(index.lessons.map(async (l) => {
    try { return await getJSON("data/lessons/" + l.file); } catch (e) { DB.loadErrors.push(String(e)); return null; }
  }));
  files.forEach((lesson, i) => { if (lesson) addLesson(lesson, index.lessons[i]); });
  return DB;
}

function addLesson(lesson, entry) {
  const id = lesson.id || entry.id;
  lesson.id = id;
  DB.lessons.push(lesson);
  DB.lessonById[id] = lesson;
  for (const s of lesson.skills || []) {
    if (!DB.skillById[s.id]) {
      const sk = { ...s, lessonId: id, exercises: [] };
      DB.skills.push(sk);
      DB.skillById[s.id] = sk;
    }
  }
  (lesson.units || []).forEach((u, ui) => {
    u.lessonId = id;
    u.uid = `${id}/${u.id}`;
    u.index = ui;
    u.skills = [];
    DB.units.push(u);
    DB.unitByKey[u.uid] = u;
    (u.exercises || []).forEach((e, ei) => {
      e.lessonId = id;
      e.unitId = u.id;
      e.uid = `${id}/${e.id}`;
      e.order = ei;
      e.difficulty = Math.max(1, Math.min(3, Number(e.difficulty) || 1));
      if (!KNOWN_TYPES.includes(e.type)) { DB.unknown.push(e); return; }
      DB.exercises.push(e);
      DB.exByKey[e.uid] = e;
      const sk = DB.skillById[e.skill];
      if (sk) sk.exercises.push(e);
      if (e.skill && !u.skills.includes(e.skill)) u.skills.push(e.skill);
    });
  });
}

export function unitExercises(unit) {
  return (unit.exercises || []).filter((e) => KNOWN_TYPES.includes(e.type));
}

export function lessonTitle(lesson) {
  return String(lesson.title_he || "").replace(/^שיעור\s*\d+\s*·\s*/, "");
}

// concept lookup for the ask panel (§3.4 fallback chain)
export function conceptFor(unit, ex) {
  const ask = unit.ask || [];
  if (ex && ex.concept) {
    const c = ask.find((a) => a.id === ex.concept);
    if (c) return c;
  }
  if (ex) {
    const c = ask.find((a) => a.skill === ex.skill);
    if (c) return c;
  }
  if (!ex && ask.length) return ask[0];
  return {
    id: "_unit",
    skill: ex ? ex.skill : unit.skills[0],
    title_he: unit.title_he,
    concept_he: unit.concept_he,
    deeper_he: ex ? ex.explain_he : "",
    source_ts: ex && ex.source_ts ? ex.source_ts : unit.source_ts,
    faq: [],
    _fallback: true,
  };
}
