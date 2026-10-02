// store.js: progress state in localStorage (try/catch), memory fallback (DESIGN §15.3, §8.6, §8.7)
const KEY = "gl.v1";
export const INTERVALS = [0, 1, 2, 4, 7, 15];

const DEFAULT_SETTINGS = { theme: "system", sound: true, volume: 0.8, sfx: true, haptics: true, noAudio: false, bonus: true, lefty: false, fbLabels: "degrees" };

function defaults() {
  return {
    v: 1,
    xp: { total: 0, byDay: {} },
    streak: { count: 0, best: 0, lastGoalDay: null, freezes: 0 },
    goal: 30,
    items: {},
    units: {},
    homework: {},
    questions: [],
    songs: [],
    drill: {},
    settings: { ...DEFAULT_SETTINGS },
  };
}

let state = defaults();
export let storageOk = true;
let timer = null;
const subs = new Set();

export function pad(n) { return String(n).padStart(2, "0"); }
export function dayStr(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function today() { return dayStr(new Date()); }
export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n, 12);
  return dayStr(dt);
}
export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((new Date(y2, m2 - 1, d2, 12) - new Date(y1, m1 - 1, d1, 12)) / 86400000);
}

export function load() {
  const forceFail = /[?&]nostorage=1/.test(location.search) || /[?&]nostorage=1/.test(location.hash);
  try {
    if (forceFail) throw new Error("nostorage");
    const raw = localStorage.getItem(KEY);
    const probe = "__gl_probe";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== 1) throw new Error("bad version");
      const d = defaults();
      state = Object.assign(d, parsed);
      state.settings = Object.assign({ ...DEFAULT_SETTINGS }, parsed.settings || {});
      state.xp = Object.assign({ total: 0, byDay: {} }, parsed.xp || {});
      state.streak = Object.assign(d.streak, parsed.streak || {});
    }
    storageOk = true;
  } catch (e) {
    storageOk = false;
    state = defaults();
  }
  checkStreakOnOpen();
  return state;
}

export function get() { return state; }
export function settings() { return state.settings; }

export function save(now = false) {
  emit();
  if (!storageOk) return;
  clearTimeout(timer);
  const write = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* quota or blocked: keep memory */ }
  };
  if (now) write(); else timer = setTimeout(write, 300);
}
export function flush() { if (timer) { clearTimeout(timer); timer = null; save(true); } }
window.addEventListener("pagehide", () => flush());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });

export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function emit() { subs.forEach((fn) => { try { fn(state); } catch (e) { console.error(e); if (window.__errors) window.__errors.push("store subscriber: " + String((e && e.message) || e)); } }); }

export function setSetting(k, v) { state.settings[k] = v; save(); }

// ---- XP, goal, streak ----
export function xpToday() { return state.xp.byDay[today()] || 0; }

export function addXP(n) {
  if (!n) return { streakGrew: false };
  const t = today();
  const before = state.xp.byDay[t] || 0;
  state.xp.byDay[t] = before + n;
  state.xp.total += n;
  let streakGrew = false;
  const goalMet = before < state.goal && state.xp.byDay[t] >= state.goal;
  if (goalMet && state.streak.lastGoalDay !== t) {
    state.streak.count += 1;
    state.streak.lastGoalDay = t;
    state.streak.best = Math.max(state.streak.best, state.streak.count);
    if (state.streak.count % 7 === 0) state.streak.freezes = Math.min(2, (state.streak.freezes || 0) + 1);
    streakGrew = true;
  }
  save();
  return { streakGrew, goalMet };
}

export function checkStreakOnOpen() {
  const s = state.streak;
  if (!s.lastGoalDay || !s.count) return;
  const gap = daysBetween(s.lastGoalDay, today());
  if (gap <= 1) return;
  if (gap === 2 && s.freezes > 0) {
    s.freezes -= 1;
    s.lastGoalDay = addDays(today(), -1);
  } else {
    s.count = 0;
  }
  save();
}

export function goalDays() {
  return Object.entries(state.xp.byDay).filter(([, v]) => v >= state.goal).map(([d]) => d);
}

// ---- items (SRS) ----
export function item(key) { return state.items[key]; }
export function recordAnswer(key, firstTry, correct) {
  const t = today();
  const it = state.items[key] || { box: 0, due: t, seen: 0, wrong: 0, last: null };
  it.seen += 1;
  it.last = t;
  if (firstTry && correct) {
    it.box = Math.min(5, it.box + 1);
    it.due = addDays(t, INTERVALS[it.box]);
  } else if (!correct && firstTry) {
    it.box = 1;
    it.due = addDays(t, 1);
    it.wrong += 1;
  } else if (!correct) {
    it.box = 1;
    it.due = addDays(t, 1);
  }
  state.items[key] = it;
  save();
  return it;
}
export function isDue(key) {
  const it = state.items[key];
  return !!(it && it.seen && it.due <= today());
}

// ---- units ----
export function unitState(key) {
  if (!state.units[key]) state.units[key] = { levels: [false, false, false], read: false };
  return state.units[key];
}
export function peekUnit(key) { return state.units[key] || { levels: [false, false, false], read: false }; }
export function levelsDone(key) { return peekUnit(key).levels.filter(Boolean).length; }
export function markLevel(key, level) {
  const u = unitState(key);
  if (level >= 1 && level <= 3) u.levels[level - 1] = true;
  save();
}
export function markRead(key) {
  const u = unitState(key);
  if (u.read) return false;
  u.read = true;
  save();
  return true;
}

// ---- homework ----
export function homeworkDays(key) { return state.homework[key] || []; }
export function toggleHomework(key) {
  const t = today();
  const days = state.homework[key] || [];
  const i = days.indexOf(t);
  let added = false;
  if (i >= 0) days.splice(i, 1); else { days.push(t); added = true; }
  state.homework[key] = days;
  save();
  return added;
}

// ---- questions ----
export function addQuestion(q) {
  const id = "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const d = new Date();
  const at = `${dayStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  state.questions.push(Object.assign({ id, at, asked: false }, q));
  save();
  return id;
}
export function updateQuestion(id, patch) {
  const q = state.questions.find((x) => x.id === id);
  if (q) Object.assign(q, patch);
  save();
}
export function deleteQuestion(id) {
  state.questions = state.questions.filter((x) => x.id !== id);
  save();
}

// ---- songs ----
export function saveSong(song) {
  const i = state.songs.findIndex((s) => s.id === song.id);
  if (i >= 0) state.songs[i] = song; else state.songs.push(song);
  save();
}
export function deleteSong(id) { state.songs = state.songs.filter((s) => s.id !== id); save(); }

// ---- drill ----
export function drillResult(key, avgMs) {
  const d = state.drill[key] || {};
  const best = !d.bestAvgMs || avgMs < d.bestAvgMs;
  if (best) d.bestAvgMs = Math.round(avgMs);
  state.drill[key] = d;
  save();
  return best;
}

// ---- backup ----
export function exportJSON() { return JSON.stringify(state, null, 1); }
export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || parsed.v !== 1) throw new Error("קובץ גיבוי לא תקין (חסר v: 1)");
  const d = defaults();
  state = Object.assign(d, parsed);
  state.settings = Object.assign({ ...DEFAULT_SETTINGS }, parsed.settings || {});
  save(true);
}
export function reset() {
  const keepSettings = { ...state.settings };
  state = defaults();
  state.settings = keepSettings;
  save(true);
}
