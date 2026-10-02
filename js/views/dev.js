// dev.js: #/dev validator, pitch test, privacy scan (DESIGN §21.1)
import { h, richText } from "../dom.js";
import { DB, KNOWN_TYPES } from "../data.js";
import * as T from "../theory.js";
import * as audio from "../audio.js";

// DESIGN §4 generic patterns, written with escapes so this file does not match itself
export const PRIVACY_RE = /\u20aa|\u05e9"\u05d7|\u05e9\u05e7\u05dc|\u05de\u05d6\u05d5\u05de\u05df|\u05d0\u05e9\u05e8\u05d0\u05d9|\u05ea\u05e9\u05dc\u05d5\u05dd|\u05db\u05ea\u05d5\u05d1\u05ea|\u05e8\u05d7\u05d5\u05d1|0\d{1,2}-?\d{7}|\+97\x32|[\w.+-]+@[\w-]+\.[a-z]{2,}/i;
const CHOICE = ["mcq", "degree_to_chord", "chord_to_degree", "relative_minor", "interval_inversion", "fill_blank", "ear_degree", "ear_quality"];
const TS = /^\d{1,2}:\d{2}(:\d{2})?$/;

export function validate() {
  const errors = [];
  const warn = [];
  const counts = {};
  const err = (id, msg) => errors.push(`${id}: ${msg}`);
  for (const lesson of DB.lessons) {
    const ids = new Set();
    for (const u of lesson.units || []) {
      for (const e of u.exercises || []) {
        const id = `${lesson.id}/${e.id}`;
        counts[e.type] = (counts[e.type] || 0) + 1;
        if (ids.has(e.id)) err(id, "duplicate id");
        ids.add(e.id);
        if (!KNOWN_TYPES.includes(e.type)) { err(id, `unknown type ${e.type}`); continue; }
        if (!DB.skillById[e.skill]) err(id, `unknown skill ${e.skill}`);
        if (!(e.bonus === true || (e.source_ts && TS.test(e.source_ts)))) err(id, `bad source_ts ${e.source_ts}`);
        if (CHOICE.includes(e.type) && !(e.options || []).map(String).includes(String(e.answer))) err(id, "answer not in options");
        if (!e.question_he) err(id, "missing question_he");
        try {
          if (e.type === "degree_to_chord" && T.normChord(T.chordOn(e.key, e.degree)) !== T.normChord(e.answer)) err(id, `theory: ${e.key} deg ${e.degree} = ${T.chordOn(e.key, e.degree)}, not ${e.answer}`);
          if (e.type === "chord_to_degree" && T.degreeOf(e.key, e.chord) !== Number(e.answer)) err(id, `theory: ${e.chord} in ${e.key} is ${T.degreeOf(e.key, e.chord)}`);
          if (e.type === "relative_minor") {
            const want = e.direction === "minor_to_major" ? T.relativeMajor(e.given) : T.relativeMinor(e.given);
            if (T.normChord(want) !== T.normChord(e.answer)) err(id, `theory: relative of ${e.given} = ${want}`);
          }
          if (e.type === "progression_build") {
            e.pattern.forEach((d, i) => { if (T.normChord(T.chordOn(e.key, d)) !== T.normChord(e.answer[i])) err(id, `theory: slot ${i + 1} ${e.answer[i]} ≠ ${T.chordOn(e.key, d)}`); });
            e.answer.forEach((c) => { if (!e.pool.includes(c)) err(id, `answer ${c} not in pool`); });
          }
          if (e.type === "family_sort") {
            e.items.forEach((it) => {
              if (T.normChord(T.chordOn(e.key, it.degree)) !== T.normChord(it.chord)) err(id, `theory: ${it.chord} is not degree ${it.degree} of ${e.key}`);
              if (!e.buckets.some((b) => b.id === it.family)) err(id, `bucket ${it.family} missing`);
            });
          }
          if (e.type === "fretboard_find") {
            const [fa, fb] = e.frets || [0, 12];
            (e.answers || []).forEach((a) => {
              if (!e.strings.includes(a.string)) err(id, `answer on string ${a.string} not allowed`);
              if (a.fret < fa || a.fret > fb) err(id, `answer fret ${a.fret} outside window`);
              const pc = T.midiAt(a.string, a.fret) % 12;
              if (e.target.note && T.parseNote(e.target.note).pc !== pc) err(id, `answer pitch is not ${e.target.note}`);
              if (e.target.key && T.degreeOfPc(e.target.key, pc) !== e.target.degree) err(id, `answer is not degree ${e.target.degree} of ${e.target.key}`);
            });
            if (!(e.answers || []).length) err(id, "no answers");
          }
          if (e.clips) e.clips.forEach((c) => { if (!c.bpm || !c.events || !c.events.length) err(id, "bad clip"); });
        } catch (x) { err(id, "check crashed: " + x.message); }
      }
    }
  }
  // privacy over all loaded strings
  const privacy = [];
  const scan = (obj, path) => {
    if (typeof obj === "string") { const m = obj.match(PRIVACY_RE); if (m) privacy.push(`${path}: "${m[0]}"`); }
    else if (Array.isArray(obj)) obj.forEach((v, i) => scan(v, `${path}[${i}]`));
    else if (obj && typeof obj === "object") Object.entries(obj).forEach(([k, v]) => { if (!["lessonId", "uid", "unitId"].includes(k)) scan(v, `${path}.${k}`); });
  };
  DB.lessons.forEach((l) => scan(stripRuntime(l), l.id));
  scan(DB.config, "config");
  privacy.forEach((p) => errors.push("privacy: " + p));
  if (DB.loadErrors.length) DB.loadErrors.forEach((x) => errors.push("load: " + x));
  if (DB.config.recording) warn.push("config.recording is set: private build");
  bidiTest().forEach((f) => errors.push(f));
  return { errors, warn, counts, exercises: DB.exercises.length, unknown: DB.unknown.map((e) => e.uid || e.id), lessons: DB.lessons.map((l) => l.id), privacyHits: privacy.length };
}

// bidi: each musical run must be ONE LTR island, so RTL never reverses a list ("1, 4, 5" → "5 ,4 ,1")
export const BIDI_CASES = [
  ["1, 4, 5", ["1, 4, 5"]],
  ["'ראשונה, רביעית, חמישית'. 2, 3 ו-6 מינוריות", ["2, 3", "6"]],
  ["ב-G: 1=G, 5=D, 6=Em, 4=C", ["G: 1=G, 5=D, 6=Em, 4=C"]],
  ["טוניקה: C, Am · דומיננטה: G", ["C, Am", "G"]],
  ["60 · 70 · 80 · 160, ומקצב הרמוני", ["60 · 70 · 80 · 160"]],
  ["60 • 70 • 80", ["60 • 70 • 80"]],
  ["מהלכים 1-4-5 · 1-5-6-4 · 6-4-1-5", ["1-4-5 · 1-5-6-4 · 6-4-1-5"]],
  ["C, F, Am (דרגות 1, 4, 6)", ["C, F, Am", "1, 4, 6"]],
];
export function bidiTest() {
  const fails = [];
  const box = document.createElement("div");
  for (const [src, want] of BIDI_CASES) {
    box.innerHTML = richText(src);
    const got = Array.from(box.querySelectorAll("bdi")).map((b) => b.textContent);
    const ltr = Array.from(box.querySelectorAll("bdi")).every((b) => b.getAttribute("dir") === "ltr");
    if (JSON.stringify(got) !== JSON.stringify(want) || !ltr) fails.push(`bidi: ${JSON.stringify(src)} → ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
  // degree runs inside a wrapping island must not break ("6-4-" / "1-5")
  box.innerHTML = richText("מהלכים 1-4-5 · 1-5-6-4 · 6-4-1-5");
  if (box.querySelectorAll("bdi .nb").length !== 3) fails.push("bidi: degree runs are not nowrap");
  return fails;
}

function stripRuntime(l) {
  return JSON.parse(JSON.stringify(l, (k, v) => (["lessonId", "uid", "unitId", "order", "index"].includes(k) ? undefined : v)));
}

export function renderDev(main) {
  const rep = validate();
  const out = h("div", { class: "page dev" }, h("h1", { class: "page-title" }, "#/dev"));
  out.appendChild(h("pre", { class: "dev-pre", id: "dev-summary" }, `errors: ${rep.errors.length}\nwarnings: ${rep.warn.length}\nlessons: ${rep.lessons.join(", ")}\nexercises: ${rep.exercises}\nunknown types: ${rep.unknown.length}\nprivacy hits: ${rep.privacyHits}\ntypes: ${JSON.stringify(rep.counts)}`));
  if (rep.errors.length) out.appendChild(h("pre", { class: "dev-pre bad" }, rep.errors.join("\n")));
  const pitchOut = h("pre", { class: "dev-pre", id: "dev-pitch" }, "pitch test: running…");
  out.appendChild(h("h2", null, "Pitch test (KS, MIDI 40-76)"));
  out.appendChild(pitchOut);
  main.appendChild(out);
  window.__devReport = rep;
  setTimeout(() => {
    const p = audio.pitchTest(48000);
    rep.pitch = { maxAbsCents: Number(p.maxAbsCents.toFixed(3)), sr: p.sr, pass: p.maxAbsCents <= 3 };
    pitchOut.textContent = `max |error|: ${p.maxAbsCents.toFixed(3)} cents (${p.maxAbsCents <= 3 ? "PASS ≤ 3" : "FAIL"})\n` + p.rows.map((r) => `${r.midi}  ${r.f.toFixed(2)} Hz → ${r.est.toFixed(2)} Hz  ${r.cents >= 0 ? "+" : ""}${r.cents.toFixed(2)}¢`).join("\n");
    window.__devReport = rep;
  }, 50);
}
