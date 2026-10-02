// theory.js: letter-based spelling, scales, chords, relative minor, voicings (DESIGN §11.6)
export const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
export const SEMIS = [0, 2, 4, 5, 7, 9, 11];
export const MAJOR = [0, 2, 4, 5, 7, 9, 11];
export const QUAL = ["", "m", "m", "", "", "m", "ø"];
export const KEYS12 = ["C", "C#", "D", "E♭", "E", "F", "F#", "G", "A♭", "A", "B♭", "B"];
export const STRING_OPEN = { 6: 40, 5: 45, 4: 50, 3: 55, 2: 59, 1: 64 };
export const DEG_WORDS = ["", "ראשונה", "שנייה", "שלישית", "רביעית", "חמישית", "שישית", "שביעית"];

const mod = (n, m) => ((n % m) + m) % m;

export function parseNote(s) {
  const m = String(s).trim().match(/^([A-Ga-g])((?:#|♯|b|♭|𝄪|𝄫|x)*)/u);
  if (!m) return null;
  const l = LETTERS.indexOf(m[1].toUpperCase());
  let acc = 0;
  for (const ch of Array.from(m[2])) {
    if (ch === "#" || ch === "♯") acc += 1;
    else if (ch === "b" || ch === "♭") acc -= 1;
    else if (ch === "𝄪" || ch === "x") acc += 2;
    else if (ch === "𝄫") acc -= 2;
  }
  return { l, acc, pc: mod(SEMIS[l] + acc, 12), name: noteStr(l, acc), len: m[0].length };
}

export function accStr(acc) {
  return { "-2": "𝄫", "-1": "♭", 0: "", 1: "#", 2: "𝄪" }[acc] ?? (acc > 0 ? "#".repeat(acc) : "♭".repeat(-acc));
}
export function noteStr(l, acc) { return LETTERS[mod(l, 7)] + accStr(acc); }

function spellAt(l, pc) {
  let acc = mod(pc - SEMIS[mod(l, 7)], 12);
  if (acc > 6) acc -= 12;
  return { l: mod(l, 7), acc, pc: mod(pc, 12), name: noteStr(l, acc) };
}

export function majorScale(key) {
  const r = parseNote(key);
  if (!r) return [];
  return MAJOR.map((st, i) => spellAt(r.l + i, r.pc + st));
}

export function chordOn(key, d) {
  const sc = majorScale(key);
  return sc[d - 1].name + QUAL[d - 1];
}
export function scaleChords(key) { return [1, 2, 3, 4, 5, 6, 7].map((d) => chordOn(key, d)); }

const SUFFIX = {
  "": [0, 4, 7], m: [0, 3, 7], "ø": [0, 3, 6, 10], m7b5: [0, 3, 6, 10], "m7♭5": [0, 3, 6, 10],
  7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], "°7": [0, 3, 6, 9], "°": [0, 3, 6], dim: [0, 3, 6],
  5: [0, 7, 12], m7: [0, 3, 7, 10], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14],
};

export function parseChord(name) {
  const r = parseNote(name);
  if (!r) return null;
  const suffix = String(name).trim().slice(r.len);
  return { root: r, suffix, tones: SUFFIX[suffix] || null };
}

export function normChord(name) {
  return String(name).replace(/♯/g, "#").replace(/b(?=\d|$|m)/g, "♭").trim();
}

// voicing: root in MIDI 48-59, chord tones stacked close above, root an octave up
export function voicing(name) {
  const c = parseChord(name);
  if (!c) return [];
  const tones = c.tones || SUFFIX[""];
  const root = 48 + c.root.pc;
  const notes = tones.map((t) => root + t);
  if (!tones.includes(12)) notes.push(root + 12);
  return notes;
}

export function relativeMinor(major) {
  const r = parseNote(major);
  return spellAt(r.l - 2, r.pc - 3).name + "m";
}
export function relativeMajor(minor) {
  const r = parseNote(String(minor).replace(/m$/, ""));
  return spellAt(r.l + 2, r.pc + 3).name;
}

export function degreeOf(key, chord) {
  const chords = scaleChords(key).map(normChord);
  const i = chords.indexOf(normChord(chord));
  if (i >= 0) return i + 1;
  const c = parseChord(chord);
  if (!c) return 0;
  const sc = majorScale(key);
  const j = sc.findIndex((n) => n.pc === c.root.pc && n.l === c.root.l);
  return j >= 0 ? j + 1 : 0;
}

export function degreeOfPc(key, pc) {
  const sc = majorScale(key);
  const i = sc.findIndex((n) => n.pc === mod(pc, 12));
  return i >= 0 ? i + 1 : 0;
}

export function minorDegree(d) { return mod(d - 6 + 7, 7) + 1; }

export function noteMidi(s) {
  const r = parseNote(s);
  const oct = Number(String(s).slice(r.len));
  return 12 * (oct + 1) + SEMIS[r.l] + r.acc;
}

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
export function noteName(midiOrPc, key) {
  const pc = mod(midiOrPc, 12);
  if (key) {
    const sc = majorScale(key);
    const n = sc.find((x) => x.pc === pc);
    if (n) return n.name;
    const flats = sc.some((x) => x.acc < 0);
    return (flats ? FLAT_NAMES : SHARP_NAMES)[pc];
  }
  return SHARP_NAMES[pc];
}

export function midiAt(string, fret) { return STRING_OPEN[string] + fret; }

export function semisWords(n) {
  return ["אותו צליל", "חצי טון", "טון", "טון וחצי", "שני טונים", "שני טונים וחצי", "שלושה טונים", "שלושה טונים וחצי"][n] || `${n} חצאי טונים`;
}

// letter ladder for relative_minor feedback (§9.2)
// dir -1 = stepping letters down (major→minor), +1 = up (minor→major)
export function letterLadder(fromNote, toNote, dir, scaleKey) {
  const a = parseNote(fromNote);
  const b = parseNote(toNote);
  if (!a || !b) return null;
  const sc = scaleKey ? majorScale(scaleKey) : null;
  let letters = mod((b.l - a.l) * dir, 7);
  const steps = [];
  let cur = a;
  let total = 0;
  for (let i = 1; i <= letters; i++) {
    const l = mod(a.l + dir * i, 7);
    let next;
    if (i === letters) next = b;
    else if (sc) next = sc.find((n) => n.l === l) || spellAt(l, SEMIS[l]);
    else next = spellAt(l, SEMIS[l]);
    const semis = mod((next.pc - cur.pc) * dir, 12);
    steps.push({ from: cur.name, to: next.name, semis });
    total += semis;
    cur = next;
  }
  return { steps, total, notes: [a.name, ...steps.map((s) => s.to)] };
}

// interval names (Hebrew) → number + quality (for interval_inversion feedback)
const INT_NUM = { "פרימה": 1, "סקונדה": 2, "טרצה": 3, "קוורטה": 4, "קווינטה": 5, "סקסטה": 6, "ספטימה": 7, "אוקטבה": 8 };
export function parseInterval(s) {
  const str = String(s);
  let num = 0;
  for (const [k, v] of Object.entries(INT_NUM)) if (str.includes(k)) num = v;
  const q = str.includes("גדולה") ? "גדול" : str.includes("קטנה") ? "קטן" : null;
  return { num, q };
}

export const FAMILY = { 1: "tonic", 6: "tonic", 3: "tonic", 4: "subdominant", 2: "subdominant", 5: "dominant", 7: "dominant" };
